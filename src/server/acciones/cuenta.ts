/**
 * Mi cuenta (10.1): preferencias, contrasena y sesiones propias. Cualquier rol puede tocar lo SUYO y nada mas:
 * el usuario sale siempre del `Actor`, nunca de la entrada.
 */
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { account, session, usuario } from '@/db/esquema';
import { CLAVE_MAX, validarClaveNueva } from '@/dominio/credenciales';
import { auditar } from '../auditoria';
import { hashearClave, verificarClave } from '../claves';
import { guardarClaveEntrega } from '../clave-entrega';
import { limitarTasa, REGLAS_TASA } from '../limite-tasa';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion } from './resultado';
import { parsear } from './validacion';

export async function actualizarPreferencias(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const e = parsear(
    z.object({ atajosTeclado: z.boolean() }),
    entrada,
  );
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, ctx.actor.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos tu usuario.');
    const cambios = {
      ...(e.atajosTeclado !== u.atajosTeclado ? { atajosTeclado: e.atajosTeclado } : {}),
    };
    if (Object.keys(cambios).length === 0) return;
    await tx.update(usuario).set({ ...cambios, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: u.id,
      accion: 'actualizar_preferencias',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { de: { atajosTeclado: u.atajosTeclado }, a: cambios },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

// ---- Contrasena ---------------------------------------------------------------------------------

const entradaCambiarClave = z
  .object({
    actual: z.string().min(1, 'Escribe tu contraseña actual.').max(CLAVE_MAX),
    nueva: z.string().superRefine((v, c) => {
      const m = validarClaveNueva(v);
      if (m) c.addIssue({ code: 'custom', message: m });
    }),
    repetir: z.string(),
  })
  .refine((x) => x.nueva === x.repetir, { path: ['repetir'], message: 'Las dos contraseñas nuevas no coinciden.' })
  .refine((x) => x.nueva !== x.actual, { path: ['nueva'], message: 'La nueva contraseña debe ser distinta de la actual.' });

/**
 * Cambia MI contrasena (exige la actual). Cierra mis otras sesiones: si alguien mas la tenia, queda fuera. Limite de
 * intentos propio: una sesion robada no sirve para adivinar la contrasena actual.
 */
export async function cambiarMiClave(ctx: Contexto, entrada: unknown): Promise<{ otrasSesionesCerradas: number; eraInicial: boolean }> {
  const e = parsear(entradaCambiarClave, entrada);
  const ahora = ahoraDe(ctx);
  const r = await limitarTasa(ctx.db, `cambiar-clave:${ctx.actor.usuarioId}`, REGLAS_TASA.cambiarClave, ahora);
  if (!r.permitido) {
    const minutos = Math.max(1, Math.ceil(r.reintentarEnMs / 60_000));
    throw new ErrorAccion('LIMITE_TASA', `Demasiados intentos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`, {
      reintentarEnMs: r.reintentarEnMs,
    });
  }
  const nuevoHash = await hashearClave(e.nueva);

  return ctx.db.transaction(async (tx) => {
    const [cred] = await tx
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, ctx.actor.usuarioId), eq(account.providerId, 'credential')))
      .for('update')
      .limit(1);
    if (!cred?.password || !(await verificarClave(cred.password, e.actual))) {
      throw new ErrorAccion('VALIDACION', 'Revisa los datos marcados.', {
        problemas: [{ ruta: 'actual', mensaje: 'La contraseña actual no es correcta.' }],
      });
    }
    await tx.update(account).set({ password: nuevoHash, updatedAt: ahora }).where(eq(account.id, cred.id));
    // Decision del administrador (2026-11-12): tambien la que la persona elige queda guardada (cifrada) y el administrador la ve en la ficha.
    await guardarClaveEntrega(tx, ctx.actor.usuarioId, e.nueva, ahora);
    const [antes] = await tx.select({ inicial: usuario.debeCambiarClave }).from(usuario).where(eq(usuario.id, ctx.actor.usuarioId)).limit(1);
    await tx.update(usuario).set({ debeCambiarClave: false, actualizadoEn: ahora }).where(eq(usuario.id, ctx.actor.usuarioId));
    const otras = ctx.actor.sesionId
      ? await tx.delete(session).where(and(eq(session.userId, ctx.actor.usuarioId), ne(session.id, ctx.actor.sesionId))).returning({ id: session.id })
      : [];
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cambiar_clave',
      entidad: 'usuario',
      entidadId: ctx.actor.usuarioId,
      detalle: { otrasSesionesCerradas: otras.length },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { otrasSesionesCerradas: otras.length, eraInicial: antes?.inicial ?? false };
  });
}
