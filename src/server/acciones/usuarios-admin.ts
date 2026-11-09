/**
 * Administracion de personas, segunda parte (H5): editar datos y cerrar sesiones de otra persona (10.4, 13.1).
 * Crear cuenta, restablecer contrasena, desactivar, reactivar y cambiar rol u organizacion viven en `usuarios.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { session, usuario } from '@/db/esquema';
import { exigeArea, MENSAJE_AREA_OBLIGATORIA } from '@/dominio/areas';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { exigir, exigirCuentaTocable } from '../politicas/exigir';
import { ErrorAccion } from './resultado';
import { areaUsuario, parsear, textoLimpio } from './validacion';

// ---- Editar -------------------------------------------------------------------------------------

export const entradaEditarUsuario = z.object({
  usuarioId: z.uuid(),
  nombre: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el nombre.').max(200)),
  area: areaUsuario(),
  encargado: textoLimpio().pipe(z.string().trim().max(80)).nullish(),
});

export async function editarUsuario(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigir(ctx.actor, 'administrar');
  const e = parsear(entradaEditarUsuario, entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    // Una cuenta de agencia no tiene area interna (C3).
    const area = u.organizacionTipo === 'agencia' ? null : e.area;
    if (exigeArea(u.rol, u.organizacionTipo) && !area) {
      throw new ErrorAccion('VALIDACION', 'Revisa los datos marcados.', { problemas: [{ ruta: 'area', mensaje: MENSAJE_AREA_OBLIGATORIA }] });
    }
    const encargado = e.encargado || null;
    if (u.nombre === e.nombre && (u.area ?? null) === area && (u.encargado ?? null) === encargado) return;
    await tx.update(usuario).set({ nombre: e.nombre, area, encargado, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'editar_usuario',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { nombre: { de: u.nombre, a: e.nombre }, area: { de: u.area, a: area }, encargado: { de: u.encargado, a: encargado } },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

// ---- Sesiones -----------------------------------------------------------------------------------

/**
 * Cierra las sesiones de OTRA persona (todas, o una sola con `sesionId`). Es inmediato: la siguiente
 * peticion de esa persona vuelve a /entrar (13.1). Queda en auditoria con quien lo hizo.
 */
export async function cerrarSesionesDeUsuario(ctx: Contexto, entrada: unknown): Promise<{ cerradas: number }> {
  exigir(ctx.actor, 'administrar');
  const e = parsear(z.object({ usuarioId: z.uuid(), sesionId: z.uuid().optional() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [u] = await tx.select({ id: usuario.id, rol: usuario.rol }).from(usuario).where(eq(usuario.id, e.usuarioId)).limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    const borradas = await tx
      .delete(session)
      .where(e.sesionId ? and(eq(session.userId, u.id), eq(session.id, e.sesionId)) : eq(session.userId, u.id))
      .returning({ id: session.id });
    if (e.sesionId && borradas.length === 0) {
      throw new ErrorAccion('NO_ENCONTRADO', 'Esa sesión ya no está abierta.');
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cerrar_sesion',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { porAdmin: true, cerradas: borradas.length, ...(e.sesionId ? { sesionId: e.sesionId } : { todas: true }) },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { cerradas: borradas.length };
  });
}
