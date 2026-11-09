/**
 * Mi cuenta (10.1): preferencias propias y sesiones propias. Cualquier rol puede tocar lo SUYO y nada mas:
 * el usuario sale siempre del `Actor`, nunca de la entrada.
 */
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { session, usuario } from '@/db/esquema';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion } from './resultado';
import { parsear } from './validacion';

export const PREFERENCIAS_AVISO = ['inmediato', 'solo_bandeja'] as const;

export async function actualizarPreferencias(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const e = parsear(
    z.object({ preferenciaAviso: z.enum(PREFERENCIAS_AVISO).optional(), atajosTeclado: z.boolean().optional() }).refine((x) => x.preferenciaAviso !== undefined || x.atajosTeclado !== undefined, 'Nada que guardar.'),
    entrada,
  );
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, ctx.actor.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos tu usuario.');
    const cambios = {
      ...(e.preferenciaAviso !== undefined && e.preferenciaAviso !== u.preferenciaAviso ? { preferenciaAviso: e.preferenciaAviso } : {}),
      ...(e.atajosTeclado !== undefined && e.atajosTeclado !== u.atajosTeclado ? { atajosTeclado: e.atajosTeclado } : {}),
    };
    if (Object.keys(cambios).length === 0) return;
    await tx.update(usuario).set({ ...cambios, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: u.id,
      accion: 'actualizar_preferencias',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { de: { preferenciaAviso: u.preferenciaAviso, atajosTeclado: u.atajosTeclado }, a: cambios },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

/** Cierra todas mis sesiones MENOS la actual (la que esta usando quien pide). */
export async function cerrarOtrasSesiones(ctx: Contexto): Promise<{ cerradas: number }> {
  if (!ctx.actor.sesionId) throw new ErrorAccion('VALIDACION', 'No pudimos identificar tu sesión actual. Cierra sesión y vuelve a entrar.');
  const sesionActual = ctx.actor.sesionId;
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const borradas = await tx
      .delete(session)
      .where(and(eq(session.userId, ctx.actor.usuarioId), ne(session.id, sesionActual)))
      .returning({ id: session.id });
    if (borradas.length > 0) {
      await auditar(tx, {
        usuarioId: ctx.actor.usuarioId,
        accion: 'cerrar_sesion',
        entidad: 'usuario',
        entidadId: ctx.actor.usuarioId,
        detalle: { otras: true, cerradas: borradas.length },
        ip: ctx.ip,
        creadoEn: ahora,
      });
    }
    return { cerradas: borradas.length };
  });
}

/** Cierra UNA de mis otras sesiones. La actual se cierra con «Cerrar sesión». */
export async function cerrarSesionPropia(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const { sesionId } = parsear(z.object({ sesionId: z.uuid() }), entrada);
  if (sesionId === ctx.actor.sesionId) {
    throw new ErrorAccion('VALIDACION', 'Esa es la sesión que estás usando. Para salir, usa «Cerrar sesión».');
  }
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const r = await tx
      .delete(session)
      .where(and(eq(session.id, sesionId), eq(session.userId, ctx.actor.usuarioId)))
      .returning({ id: session.id });
    if (r.length === 0) throw new ErrorAccion('NO_ENCONTRADO', 'Esa sesión ya no está abierta.');
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cerrar_sesion',
      entidad: 'usuario',
      entidadId: ctx.actor.usuarioId,
      detalle: { sesionId },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}
