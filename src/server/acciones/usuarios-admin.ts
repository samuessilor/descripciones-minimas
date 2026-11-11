/**
 * Administracion de personas, segunda parte (H5): editar datos de otra persona (10.4). Ya no hay lista de sesiones abiertas (2026-11-10).
 * Crear cuenta, restablecer contrasena, desactivar, reactivar y cambiar rol u organizacion viven en `usuarios.ts`.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { usuario } from '@/db/esquema';
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
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaEditarUsuario, entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
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
