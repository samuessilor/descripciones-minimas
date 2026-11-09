/**
 * Usuarios (M1, 10.4, 13.1): invitar, desactivar con revocacion inmediata de sesiones, cambiar rol
 * u organizacion. SIN registro abierto: entra quien un admin creo. La regla rol x tipo de
 * organizacion (D-28) se valida aqui (politicas) ademas de la interfaz y de la base (CHECK + FK).
 *
 * El envio del correo de bienvenida (con enlace) lo hace la Server Action que envuelve a
 * `invitarUsuario`, porque necesita Better Auth y el entorno de Next.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, organizacion, usuario } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { ROLES, puede, validarRolOrganizacion, type Rol, type TipoOrganizacion } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { avisarAsignacionExistente } from './asignaciones';
import { revocarSesionesDeUsuario } from '../sesiones';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { areaUsuario, parsear, textoLimpio } from './validacion';

function exigirAdmin(ctx: Contexto): void {
  if (!puede(ctx.actor, 'administrar')) {
    throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador puede gestionar usuarios.');
  }
}

/** Clave del candado de la guarda «no dejar la plataforma sin administrador activo». */
const CANDADO_ULTIMO_ADMIN = 7_301_001;

/**
 * Serializa toda operacion que pueda REDUCIR el numero de administradores activos (desactivar, cambiar rol).
 * Sin esto, con READ COMMITTED dos administradores que se desactivan a la vez ven cada uno al otro todavia
 * activo, ambos pasan la guarda y la plataforma queda sin nadie que la administre. El candado es de
 * transaccion (se libera solo al confirmar o revertir) y se toma ANTES de leer al usuario o contar: asi no hay
 * orden de bloqueo cruzado entre filas y no puede haber interbloqueo.
 */
async function serializarGuardaUltimoAdmin(tx: Pick<Contexto['db'], 'execute'>): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${CANDADO_ULTIMO_ADMIN})`);
}

type FilaUsuario = typeof usuario.$inferSelect;

/**
 * Reasigna las asignaciones activas (pendiente / en curso) de `u`: EXIGE un destino por ficha. Cierra la vieja
 * como `reasignada` y abre otra al destino, todo dentro de la transaccion de quien llama. Con
 * `mismaOrganizacion` el destino debe ser de la misma organizacion que `u` (la agencia conserva su ficha).
 * Cada asignacion nueva avisa a su responsable (bandeja + correo en el outbox, en la misma transaccion).
 * Devuelve cuantas reasigno y los correos encolados (para el envio inmediato tras confirmar).
 */
async function reasignarPendientes(
  tx: Tx,
  u: FilaUsuario,
  mapa: Record<string, string>,
  ahora: Date,
  quien: string,
  opciones: { mismaOrganizacion?: boolean } = {},
): Promise<{ n: number; correoIds: string[]; movidas: Array<{ referenciaId: string; aUsuarioId: string }> }> {
  const pendientes = await tx
    .select()
    .from(asignacion)
    .where(and(eq(asignacion.aUsuarioId, u.id), inArray(asignacion.estado, ['pendiente', 'en_curso'])));

  const sinDestino = pendientes.filter((p) => !mapa[p.referenciaId]);
  if (sinDestino.length > 0) {
    throw new ErrorAccion(
      'VALIDACION',
      `${u.nombre} tiene ${sinDestino.length} ${sinDestino.length === 1 ? 'referencia pendiente' : 'referencias pendientes'}. ¿A quién las reasignas?`,
      { pendientes: sinDestino.map((p) => p.referenciaId) },
    );
  }

  const correoIds: string[] = [];
  const movidas: Array<{ referenciaId: string; aUsuarioId: string }> = [];
  for (const p of pendientes) {
    const destinoId = mapa[p.referenciaId] as string;
    const [destino] = await tx
      .select({ id: usuario.id, activo: usuario.activo, rol: usuario.rol, organizacionId: usuario.organizacionId })
      .from(usuario)
      .where(eq(usuario.id, destinoId))
      .limit(1);
    if (!destino || !destino.activo || destino.id === u.id || destino.rol === 'lector') {
      throw new ErrorAccion('VALIDACION', 'El destino de una reasignación debe ser un usuario activo que no sea lector.');
    }
    if (opciones.mismaOrganizacion && destino.organizacionId !== u.organizacionId) {
      throw new ErrorAccion('VALIDACION', 'La referencia sigue en su agencia: el destino debe ser de la misma organización de quien se mueve.');
    }
    await tx.update(asignacion).set({ estado: 'reasignada', completadaEn: ahora }).where(eq(asignacion.id, p.id));
    movidas.push({ referenciaId: p.referenciaId, aUsuarioId: destino.id });
    const [nueva] = await tx
      .insert(asignacion)
      .values({
        referenciaId: p.referenciaId,
        deUsuarioId: p.deUsuarioId,
        aUsuarioId: destino.id,
        pedido: p.pedido,
        mensaje: p.mensaje,
        estado: 'pendiente',
        creadaEn: ahora,
      })
      .onConflictDoNothing() // si el destino ya tenia una activa en esa ficha, basta con cerrar la vieja
      .returning({ id: asignacion.id });
    if (nueva) {
      const aviso = await avisarAsignacionExistente(tx, { asignacionId: nueva.id, quien, ahora });
      if (aviso?.correoId) correoIds.push(aviso.correoId);
    }
  }
  return { n: pendientes.length, correoIds, movidas };
}

async function cargarOrganizacion(ctx: Pick<Contexto, 'db'>, id: string) {
  const [o] = await ctx.db.select().from(organizacion).where(eq(organizacion.id, id)).limit(1);
  if (!o || !o.activa) throw new ErrorAccion('NO_ENCONTRADO', 'La organización no existe o está inactiva.');
  return o;
}

export const entradaInvitarUsuario = z.object({
  nombre: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el nombre.').max(200)),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Escribe un correo válido.')),
  organizacionId: z.uuid(),
  rol: z.enum(ROLES),
  area: areaUsuario(),
});

export interface ResultadoInvitar {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  organizacionTipo: TipoOrganizacion;
}

export async function invitarUsuario(ctx: Contexto, entrada: unknown): Promise<ResultadoInvitar> {
  exigirAdmin(ctx);
  const e = parsear(entradaInvitarUsuario, entrada);
  const ahora = ahoraDe(ctx);
  const org = await cargarOrganizacion(ctx, e.organizacionId);
  const tipo = org.tipo as TipoOrganizacion;

  const regla = validarRolOrganizacion(e.rol, tipo);
  if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);

  try {
    return await ctx.db.transaction(async (tx) => {
      const [u] = await tx
        .insert(usuario)
        .values({
          nombre: e.nombre,
          email: e.email,
          organizacionId: org.id,
          organizacionTipo: tipo,
          rol: e.rol,
          // Una cuenta de agencia es de una empresa de aduana, no de un area interna (C3).
          area: tipo === 'agencia' ? null : e.area,
          creadoPor: ctx.actor.usuarioId,
          creadoEn: ahora,
          actualizadoEn: ahora,
        })
        .returning({ id: usuario.id });
      if (!u) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear el usuario.');
      await auditar(tx, {
        usuarioId: ctx.actor.usuarioId,
        accion: 'invitar',
        entidad: 'usuario',
        entidadId: u.id,
        detalle: { email: e.email, rol: e.rol, organizacionId: org.id },
        ip: ctx.ip,
        creadoEn: ahora,
      });
      return { id: u.id, email: e.email, nombre: e.nombre, rol: e.rol, organizacionTipo: tipo };
    });
  } catch (err) {
    if (esViolacionUnica(err, 'usuario_email_unico')) {
      throw new ErrorAccion('DUPLICADO', 'Ya existe un usuario con ese correo.');
    }
    throw err;
  }
}

export const entradaDesactivarUsuario = z.object({
  usuarioId: z.uuid(),
  /** Para cada referencia con pendiente de este usuario: a quien se la reasigna. */
  reasignaciones: z.record(z.uuid(), z.uuid()).optional(),
});

export interface ResultadoDesactivar {
  sesionesCerradas: number;
  reasignadas: number;
  /** Correos de aviso encolados al reasignar: la Server Action los envia al confirmar (`programarEnvioInmediato`). */
  correoIds: string[];
}

/**
 * Desactiva (nunca elimina). Si tiene pendientes, EXIGE reasignarlos; la reasignacion y el cierre
 * de sesiones ocurren en la MISMA transaccion (10.6, CA-29, RV-16). Lo que ya lleno se conserva.
 */
export async function desactivarUsuario(ctx: Contexto, entrada: unknown): Promise<ResultadoDesactivar> {
  exigirAdmin(ctx);
  const e = parsear(entradaDesactivarUsuario, entrada);
  const ahora = ahoraDe(ctx);

  return ctx.db.transaction(async (tx) => {
    await serializarGuardaUltimoAdmin(tx);
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');

    if (u.rol === 'admin' && u.activo) {
      const otros = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(usuario)
        .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true), sql`${usuario.id} <> ${u.id}`));
      if ((otros[0]?.n ?? 0) === 0) {
        throw new ErrorAccion('VALIDACION', 'No puedes desactivar al único administrador activo.');
      }
    }

    const { n: reasignadas, correoIds, movidas } = await reasignarPendientes(tx, u, e.reasignaciones ?? {}, ahora, ctx.actor.nombre);

    await tx.update(usuario).set({ activo: false, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    const sesionesCerradas = await revocarSesionesDeUsuario(tx, u.id);

    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'desactivar',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { reasignadas, movidas, sesionesCerradas },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { sesionesCerradas, reasignadas, correoIds };
  });
}

export async function reactivarUsuario(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const r = await tx
      .update(usuario)
      .set({ activo: true, actualizadoEn: ahora })
      .where(eq(usuario.id, usuarioId))
      .returning({ id: usuario.id });
    if (r.length === 0) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'reactivar',
      entidad: 'usuario',
      entidadId: usuarioId,
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

export async function cambiarRol(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const e = parsear(z.object({ usuarioId: z.uuid(), rol: z.enum(ROLES) }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    await serializarGuardaUltimoAdmin(tx);
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    const regla = validarRolOrganizacion(e.rol, u.organizacionTipo as TipoOrganizacion);
    if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);
    if (u.rol === e.rol) return; // sin cambio: no se escribe ni se audita
    if (u.rol === 'admin' && e.rol !== 'admin' && u.activo) {
      const otros = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(usuario)
        .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true), sql`${usuario.id} <> ${u.id}`));
      if ((otros[0]?.n ?? 0) === 0) throw new ErrorAccion('VALIDACION', 'No puedes quitarle el rol al único administrador activo.');
    }
    await tx.update(usuario).set({ rol: e.rol, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cambiar_rol',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { de: u.rol, a: e.rol },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

export const entradaCambiarOrganizacion = z.object({
  usuarioId: z.uuid(),
  organizacionId: z.uuid(),
  /** Para cada referencia con pendiente de este usuario: a quien se la reasigna (alguien de su agencia actual). */
  reasignaciones: z.record(z.uuid(), z.uuid()).optional(),
});

/**
 * Cambia a una persona de organizacion. La visibilidad de una agencia sigue a la organizacion ACTUAL de quien
 * recibio la asignacion, asi que mover a alguien con fichas pendientes se las entregaria a la agencia nueva y
 * se las quitaria a la vieja. Por eso, cuando alguna de las dos organizaciones es una agencia:
 *  - sus pendientes (pendiente / en curso) se reasignan a alguien de la agencia que las recibio (mismo flujo
 *    que `desactivarUsuario`; sin destino, VALIDACION);
 *  - el acceso temporal vigente de sus asignaciones ya terminadas (S-22, 30 dias) se cierra: no se transfiere.
 */
export async function cambiarOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true; correoIds: string[] }> {
  exigirAdmin(ctx);
  const e = parsear(entradaCambiarOrganizacion, entrada);
  const ahora = ahoraDe(ctx);
  const org = await cargarOrganizacion(ctx, e.organizacionId);
  const correoIds = await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    if (u.organizacionId === org.id) return [] as string[]; // sin cambio
    const regla = validarRolOrganizacion(u.rol as Rol, org.tipo as TipoOrganizacion);
    if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);

    let reasignadas = 0;
    let movidas: Array<{ referenciaId: string; aUsuarioId: string }> = [];
    let correos: string[] = [];
    let accesosCerrados = 0;
    if (u.organizacionId !== org.id && (u.organizacionTipo === 'agencia' || org.tipo === 'agencia')) {
      const r = await reasignarPendientes(tx, u, e.reasignaciones ?? {}, ahora, ctx.actor.nombre, {
        mismaOrganizacion: u.organizacionTipo === 'agencia',
      });
      reasignadas = r.n;
      movidas = r.movidas;
      correos = r.correoIds;
      const cerradas = await tx
        .update(asignacion)
        .set({ accesoHasta: ahora })
        .where(
          and(
            eq(asignacion.aUsuarioId, u.id),
            inArray(asignacion.estado, ['hecha', 'reasignada']),
            sql`${asignacion.accesoHasta} > ${ahora.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: asignacion.id });
      accesosCerrados = cerradas.length;
    }

    await tx
      .update(usuario)
      // Al pasar a una agencia deja de responder por un area interna (C1, C3).
      .set({ organizacionId: org.id, organizacionTipo: org.tipo, ...(org.tipo === 'agencia' ? { area: null } : {}), actualizadoEn: ahora })
      .where(eq(usuario.id, u.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cambiar_organizacion',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { de: u.organizacionId, a: org.id, reasignadas, movidas, accesosCerrados },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return correos;
  });
  return { ok: true, correoIds };
}
