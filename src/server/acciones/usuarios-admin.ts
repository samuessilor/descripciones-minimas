/**
 * Administracion de personas, segunda parte (H5): editar datos, REENVIAR la invitacion (con limite),
 * cerrar sesiones de otra persona y marcar un correo como invalido (10.4, 13.1, 14).
 * Invitar, desactivar, reactivar y cambiar rol u organizacion viven en `usuarios.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { organizacion, session, usuario } from '@/db/esquema';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { limitarTasa, type ReglaTasa } from '../limite-tasa';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion } from './resultado';
import { areaUsuario, parsear, textoLimpio } from './validacion';

function exigirAdmin(ctx: Contexto): void {
  if (!puede(ctx.actor, 'administrar')) {
    throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador puede gestionar usuarios.');
  }
}

/** Reenviar una invitacion: 3 por hora para la misma persona y 30 por hora por administrador. */
export const REGLAS_REENVIO = {
  porPersona: { max: 3, ventanaMs: 3_600_000 },
  porAdmin: { max: 30, ventanaMs: 3_600_000 },
} as const satisfies Record<string, ReglaTasa>;

async function cobrar(ctx: Contexto, clave: string, regla: ReglaTasa, ahora: Date, mensaje: (minutos: number) => string) {
  const r = await limitarTasa(ctx.db, clave, regla, ahora);
  if (!r.permitido) {
    const minutos = Math.max(1, Math.ceil(r.reintentarEnMs / 60_000));
    throw new ErrorAccion('LIMITE_TASA', mensaje(minutos), { reintentarEnMs: r.reintentarEnMs });
  }
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

// ---- Editar -------------------------------------------------------------------------------------

export const entradaEditarUsuario = z.object({
  usuarioId: z.uuid(),
  nombre: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el nombre.').max(200)),
  area: areaUsuario(),
});

export async function editarUsuario(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const e = parsear(entradaEditarUsuario, entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    // Una cuenta de agencia no tiene area interna (C3).
    const area = u.organizacionTipo === 'agencia' ? null : e.area;
    if (u.nombre === e.nombre && (u.area ?? null) === area) return;
    await tx.update(usuario).set({ nombre: e.nombre, area, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'editar_usuario',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { nombre: { de: u.nombre, a: e.nombre }, area: { de: u.area, a: area } },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

// ---- Reenviar invitacion ------------------------------------------------------------------------

export interface PersonaInvitada {
  id: string;
  nombre: string;
  email: string;
  /** Nunca ha entrado: la accion es una invitacion pendiente. */
  sinIngreso: boolean;
}

/**
 * Reenvia el correo con el enlace de acceso a una persona activa. `enviar` hace el envio real (necesita
 * Better Auth, por eso lo pone la Server Action); el limite se cobra ANTES, asi insistir no sirve para
 * llenar un buzon ajeno. Si el envio falla, el error sube con su mensaje y la auditoria dice que no salio.
 */
export async function reenviarInvitacion(
  ctx: Contexto,
  entrada: unknown,
  enviar: (persona: PersonaInvitada) => Promise<void>,
): Promise<PersonaInvitada> {
  exigirAdmin(ctx);
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);

  const [fila] = await ctx.db
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      activo: usuario.activo,
      correoInvalido: usuario.correoInvalido,
      ultimoIngreso: usuario.ultimoIngreso,
      orgActiva: organizacion.activa,
    })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(eq(usuario.id, usuarioId))
    .limit(1);
  if (!fila) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
  if (!fila.activo || !fila.orgActiva) {
    throw new ErrorAccion('VALIDACION', `${fila.nombre} está desactivado${fila.orgActiva ? '' : ' (su organización también)'}. Reactívalo antes de enviarle un enlace.`);
  }
  if (fila.correoInvalido) {
    throw new ErrorAccion('VALIDACION', `El correo de ${fila.nombre} está marcado como inválido. Quita la marca si ya lo confirmaste y vuelve a intentar.`);
  }

  await cobrar(ctx, `reenviar-invitacion:${fila.id}`, REGLAS_REENVIO.porPersona, ahora, (m) =>
    `Ya le enviaste varios enlaces a ${fila.nombre}. Espera ${plural(m, 'minuto', 'minutos')} antes de reenviar.`,
  );
  await cobrar(ctx, `reenviar-invitacion-admin:${ctx.actor.usuarioId}`, REGLAS_REENVIO.porAdmin, ahora, (m) =>
    `Hiciste muchos reenvíos seguidos. Espera ${plural(m, 'minuto', 'minutos')} y vuelve a intentar.`,
  );

  const persona: PersonaInvitada = { id: fila.id, nombre: fila.nombre, email: fila.email, sinIngreso: fila.ultimoIngreso === null };
  let enviado = true;
  let causa: unknown;
  try {
    await enviar(persona);
  } catch (err) {
    enviado = false;
    causa = err;
  }
  await auditar(ctx.db, {
    usuarioId: ctx.actor.usuarioId,
    accion: 'reenviar_invitacion',
    entidad: 'usuario',
    entidadId: fila.id,
    detalle: { enviado, sinIngreso: persona.sinIngreso },
    ip: ctx.ip,
    creadoEn: ahora,
  });
  if (!enviado) throw causa;
  return persona;
}

// ---- Sesiones -----------------------------------------------------------------------------------

/**
 * Cierra las sesiones de OTRA persona (todas, o una sola con `sesionId`). Es inmediato: la siguiente
 * peticion de esa persona vuelve a /entrar (13.1). Queda en auditoria con quien lo hizo.
 */
export async function cerrarSesionesDeUsuario(ctx: Contexto, entrada: unknown): Promise<{ cerradas: number }> {
  exigirAdmin(ctx);
  const e = parsear(z.object({ usuarioId: z.uuid(), sesionId: z.uuid().optional() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [u] = await tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.id, e.usuarioId)).limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
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

// ---- Correo invalido ----------------------------------------------------------------------------

/** MVP (14): el administrador marca a mano un correo que rebota; mientras este marcado, no se le envia nada. */
export async function marcarCorreoInvalido(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const e = parsear(z.object({ usuarioId: z.uuid(), invalido: z.boolean() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const r = await tx
      .update(usuario)
      .set({ correoInvalido: e.invalido, actualizadoEn: ahora })
      .where(eq(usuario.id, e.usuarioId))
      .returning({ id: usuario.id });
    if (r.length === 0) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'marcar_correo_invalido',
      entidad: 'usuario',
      entidadId: e.usuarioId,
      detalle: { invalido: e.invalido },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}
