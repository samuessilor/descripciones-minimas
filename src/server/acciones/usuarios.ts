/**
 * Usuarios (M1, 10.4, 13.1): crear cuenta (usuario + contrasena temporal), restablecer contrasena, desactivar con
 * revocacion inmediata de sesiones, cambiar rol u organizacion. SIN registro abierto: entra quien el administrador o la
 * supervisora general creo. Todo es de `supervisar` salvo las claves (restablecer y la que se genera al crear), que son
 * solo del administrador (`administrar`). La regla rol x tipo de organizacion (D-28) se valida aqui (politicas) ademas
 * de la interfaz y de la base (CHECK + FK).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { account, asignacion, claveEntrega, notificacion, organizacion, usuario } from '@/db/esquema';
import type { Ejecutor, Tx } from '@/db/tipos';
import { exigeArea, MENSAJE_AREA_OBLIGATORIA } from '@/dominio/areas';
import { correoSinCorreo, normalizarUsuario, USUARIO_AYUDA, validarUsuario } from '@/dominio/credenciales';
import { ROLES, puede, validarRolOrganizacion, type Rol, type TipoOrganizacion } from '@/dominio/permisos';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { auditar } from '../auditoria';
import { crearNotificacion } from '../notificaciones/crear';
import { generarClave, hashearClave } from '../claves';
import { descifrarClave, guardarClaveEntrega } from '../clave-entrega';
import { avisarAsignacionExistente } from './asignaciones';
import { revocarSesionesDeUsuario } from '../sesiones';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { exigir, exigirCuentaTocable, exigirRolAsignable } from '../politicas/exigir';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { filasDe, llamarBorrado } from '../sql';
import { areaUsuario, parsear, textoLimpio } from './validacion';

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
 * Cada asignacion nueva avisa a su responsable en la bandeja, en la misma transaccion. Devuelve cuantas reasigno.
 */
async function reasignarPendientes(
  tx: Tx,
  u: FilaUsuario,
  mapa: Record<string, string>,
  ahora: Date,
  quien: string,
  opciones: { mismaOrganizacion?: boolean } = {},
): Promise<{ n: number; movidas: Array<{ referenciaId: string; aUsuarioId: string }> }> {
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
    if (nueva) await avisarAsignacionExistente(tx, { asignacionId: nueva.id, quien, ahora });
  }
  return { n: pendientes.length, movidas };
}

async function cargarOrganizacion(ctx: Pick<Contexto, 'db'>, id: string) {
  const [o] = await ctx.db.select().from(organizacion).where(eq(organizacion.id, id)).limit(1);
  if (!o || !o.activa) throw new ErrorAccion('NO_ENCONTRADO', 'La organización no existe o está inactiva.');
  return o;
}

export const entradaCrearCuenta = z.object({
  nombre: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el nombre.').max(200)),
  usuario: z
    .string()
    .transform(normalizarUsuario)
    .refine((v) => validarUsuario(v) === null, { message: USUARIO_AYUDA }),
  /** Opcional: las cuentas de area no tienen correo propio. Solo es de contacto; no se usa para entrar. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => v === '' || z.email().safeParse(v).success, { message: 'Escribe un correo válido o déjalo vacío.' })
    .nullish(),
  organizacionId: z.uuid(),
  rol: z.enum(ROLES),
  area: areaUsuario(),
  /** Opcional: nombre de quien lleva la cuenta del area hoy. La cuenta sigue siendo del area. */
  encargado: textoLimpio().pipe(z.string().trim().max(80)).nullish(),
});

export interface ResultadoCrearCuenta {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  organizacionTipo: TipoOrganizacion;
  /**
   * Se muestra UNA vez a quien crea la cuenta. En la base queda su hash y una copia CIFRADA que solo el administrador puede volver
   * a ver (`verClaveEntrega`). Solo el administrador la recibe en pantalla: si crea la supervisora (`null`), la cuenta nace igual con
   * su contrasena y el administrador la ve y la entrega desde la ficha de la cuenta.
   */
  claveTemporal: string | null;
}

interface CuentaNueva {
  nombre: string;
  usuario: string;
  email?: string | null | undefined;
  organizacion: { id: string; nombre: string; tipo: TipoOrganizacion };
  rol: Rol;
  area?: string | null | undefined;
  encargado?: string | null | undefined;
}

/**
 * Inserta la cuenta dentro de la transaccion de quien llama: usuario, su credencial (`hash`), la copia cifrada de la clave de
 * entrega (`claveEntregada`, solo la ve el administrador), auditoria y, si quien la crea no es administrador, el aviso
 * `cuenta_creada` a todos los administradores activos para que revisen la clave y la entreguen. No devuelve ninguna clave.
 */
export async function insertarCuenta(
  ctx: Contexto,
  tx: Tx,
  c: CuentaNueva,
  hash: string | null,
  ahora: Date,
  claveEntregada: string | null = null,
): Promise<string> {
  // El usuario se revisa primero: sin correo propio el correo reservado `usuario@sin-correo.invalid` choca igual y el
  // mensaje diria «correo» cuando lo repetido es el usuario.
  const [yaUsuario] = await tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.username, c.usuario)).limit(1);
  if (yaUsuario) throw CHOQUE_USUARIO;
  const [u] = await tx
    .insert(usuario)
    .values({
      nombre: c.nombre,
      username: c.usuario,
      email: c.email ? c.email : correoSinCorreo(c.usuario),
      organizacionId: c.organizacion.id,
      organizacionTipo: c.organizacion.tipo,
      rol: c.rol,
      // Una cuenta de agencia es de una empresa de aduana, no de un area interna (C3).
      area: c.organizacion.tipo === 'agencia' ? null : (c.area ?? null),
      encargado: c.encargado || null,
      // Cambiar la contrasena de entrega ya no es obligatorio: la cuenta entra y usa la app de una vez.
      debeCambiarClave: false,
      creadoPor: ctx.actor.usuarioId,
      creadoEn: ahora,
      actualizadoEn: ahora,
    })
    .returning({ id: usuario.id });
  if (!u) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear la cuenta.');
  if (hash) await tx.insert(account).values({ accountId: u.id, providerId: 'credential', userId: u.id, password: hash, createdAt: ahora, updatedAt: ahora });
  if (hash && claveEntregada) await guardarClaveEntrega(tx, u.id, claveEntregada, ahora);
  await auditar(tx, {
    usuarioId: ctx.actor.usuarioId,
    accion: 'crear_cuenta',
    entidad: 'usuario',
    entidadId: u.id,
    detalle: { usuario: c.usuario, rol: c.rol, organizacionId: c.organizacion.id, conClave: hash !== null },
    ip: ctx.ip,
    creadoEn: ahora,
  });
  if (ctx.actor.rol !== 'admin') {
    const admins = await tx.select({ id: usuario.id }).from(usuario).where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true)));
    for (const a of admins) {
      await crearNotificacion(tx, {
        usuarioId: a.id,
        tipo: 'cuenta_creada',
        referenciaId: null,
        cuentaId: u.id,
        titulo: `${nombreSinMarca(ctx.actor.nombre)} creó la cuenta ${c.usuario} de ${c.organizacion.nombre}: revisa su clave y entrégala`,
        creadaEn: ahora,
      });
    }
  }
  return u.id;
}

const CHOQUE_USUARIO = new ErrorAccion('DUPLICADO', 'Ya existe una cuenta con ese usuario.');

/** Traduce el choque de unicidad de usuario o correo a un error de accion; deja pasar cualquier otro. */
export function traducirChoqueCuenta(err: unknown, conCorreoPropio: boolean): unknown {
  if (esViolacionUnica(err, 'usuario_username_unico')) return CHOQUE_USUARIO;
  // Con correo reservado (no escribio uno) lo repetido es el usuario; con correo propio, el correo.
  if (esViolacionUnica(err, 'usuario_email_unico')) return conCorreoPropio ? new ErrorAccion('DUPLICADO', 'Ya existe una cuenta con ese correo.') : CHOQUE_USUARIO;
  return err;
}

/**
 * Crea una cuenta. SIN registro abierto: la crea el administrador o la supervisora general. La contrasena temporal se genera
 * SIEMPRE aqui: se guarda su hash (la credencial) y una copia cifrada que solo el administrador puede volver a ver. Si la crea el
 * administrador, vuelve en la respuesta para mostrarla una vez; si la crea la supervisora no la recibe (`null`) y todos los
 * administradores activos reciben el aviso `cuenta_creada`: abren la cuenta, ven su usuario y contrasena y se la entregan.
 */
export async function crearCuenta(ctx: Contexto, entrada: unknown): Promise<ResultadoCrearCuenta> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaCrearCuenta, entrada);
  exigirRolAsignable(ctx.actor, e.rol);
  const ahora = ahoraDe(ctx);
  const org = await cargarOrganizacion(ctx, e.organizacionId);
  const tipo = org.tipo as TipoOrganizacion;

  const regla = validarRolOrganizacion(e.rol, tipo);
  if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);
  if (exigeArea(e.rol, tipo) && !e.area) {
    throw new ErrorAccion('VALIDACION', 'Revisa los datos marcados.', { problemas: [{ ruta: 'area', mensaje: MENSAJE_AREA_OBLIGATORIA }] });
  }

  const generada = generarClave();
  const hash = await hashearClave(generada);
  const claveTemporal = puede(ctx.actor, 'administrar') ? generada : null;
  try {
    return await ctx.db.transaction(async (tx) => {
      const id = await insertarCuenta(ctx, tx, { ...e, organizacion: { id: org.id, nombre: org.nombre, tipo } }, hash, ahora, generada);
      return { id, usuario: e.usuario, nombre: e.nombre, rol: e.rol, organizacionTipo: tipo, claveTemporal };
    });
  } catch (err) {
    throw traducirChoqueCuenta(err, !!e.email);
  }
}

/**
 * Restablece la contrasena de OTRA cuenta: genera una temporal, cierra todas sus sesiones, la devuelve para entregarla a mano y
 * deja su copia cifrada para que el administrador pueda volver a verla (`verClaveEntrega`). Solo el administrador.
 */
export async function restablecerClave(ctx: Contexto, entrada: unknown): Promise<{ usuario: string; nombre: string; claveTemporal: string; sesionesCerradas: number }> {
  exigir(ctx.actor, 'administrar');
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  const claveTemporal = generarClave();
  const hash = await hashearClave(claveTemporal);

  return ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    const [cred] = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')))
      .limit(1);
    if (cred) {
      await tx.update(account).set({ password: hash, updatedAt: ahora }).where(eq(account.id, cred.id));
    } else {
      await tx.insert(account).values({ accountId: u.id, providerId: 'credential', userId: u.id, password: hash, createdAt: ahora, updatedAt: ahora });
    }
    await guardarClaveEntrega(tx, u.id, claveTemporal, ahora);
    // Ya no se obliga a cambiarla; se apaga el indicador por si la cuenta lo traia activo de antes de esta politica.
    await tx.update(usuario).set({ debeCambiarClave: false, actualizadoEn: ahora }).where(eq(usuario.id, u.id));
    const sesionesCerradas = await revocarSesionesDeUsuario(tx, u.id);
    // Si la cuenta estaba pendiente de entrega, el aviso de «cuenta creada» queda resuelto para quien lo recibio.
    await tx
      .update(notificacion)
      .set({ leidaEn: ahora })
      .where(and(eq(notificacion.tipo, 'cuenta_creada'), eq(notificacion.cuentaId, u.id), isNull(notificacion.leidaEn)));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'restablecer_clave',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { sesionesCerradas },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { usuario: u.username ?? u.email, nombre: u.nombre, claveTemporal, sesionesCerradas };
  });
}

export interface ClaveEntregada {
  usuario: string;
  nombre: string;
  /** La contrasena que se le entrego, o `null` si ya no esta disponible (la cambio la persona, o la cuenta se creo fuera de la plataforma). */
  clave: string | null;
  /** Desde cuando es la de entrega. */
  desde: string | null;
}

/**
 * El administrador vuelve a ver la contrasena que se le entrego a una cuenta (usuario + contrasena). Solo la de entrega: si la
 * persona ya la cambio, o la cuenta se creo fuera de la plataforma, no hay copia y se restablece para generar una nueva. Cada vez que
 * se mira queda una fila en la auditoria, y el aviso de «cuenta creada» de esa cuenta se da por atendido.
 */
export async function verClaveEntrega(ctx: Contexto, entrada: unknown): Promise<ClaveEntregada> {
  exigir(ctx.actor, 'administrar');
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    const [fila] = await tx.select().from(claveEntrega).where(eq(claveEntrega.usuarioId, u.id)).limit(1);
    const clave = fila ? descifrarClave(fila.cifrada, u.id) : null;
    if (clave) {
      await tx
        .update(notificacion)
        .set({ leidaEn: ahora })
        .where(and(eq(notificacion.tipo, 'cuenta_creada'), eq(notificacion.cuentaId, u.id), isNull(notificacion.leidaEn)));
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'ver_clave',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: { disponible: clave !== null },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { usuario: u.username ?? u.email, nombre: u.nombre, clave, desde: clave && fila ? fila.creadaEn.toISOString() : null };
  });
}

export const entradaDesactivarUsuario = z.object({
  usuarioId: z.uuid(),
  /** Para cada referencia con pendiente de este usuario: a quien se la reasigna. */
  reasignaciones: z.record(z.uuid(), z.uuid()).optional(),
});

export interface ResultadoDesactivar {
  sesionesCerradas: number;
  reasignadas: number;
}

/**
 * Desactiva (nunca elimina). Si tiene pendientes, EXIGE reasignarlos; la reasignacion y el cierre
 * de sesiones ocurren en la MISMA transaccion (10.6, CA-29, RV-16). Lo que ya lleno se conserva.
 */
export async function desactivarUsuario(ctx: Contexto, entrada: unknown): Promise<ResultadoDesactivar> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaDesactivarUsuario, entrada);
  const ahora = ahoraDe(ctx);

  return ctx.db.transaction(async (tx) => {
    await serializarGuardaUltimoAdmin(tx);
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);

    if (u.rol === 'admin' && u.activo) {
      const otros = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(usuario)
        .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true), sql`${usuario.id} <> ${u.id}`));
      if ((otros[0]?.n ?? 0) === 0) {
        throw new ErrorAccion('VALIDACION', 'No puedes desactivar al único administrador activo.');
      }
    }

    const { n: reasignadas, movidas } = await reasignarPendientes(tx, u, e.reasignaciones ?? {}, ahora, ctx.actor.nombre);

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
    return { sesionesCerradas, reasignadas };
  });
}

export async function reactivarUsuario(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigir(ctx.actor, 'supervisar');
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [objetivo] = await tx.select({ rol: usuario.rol }).from(usuario).where(eq(usuario.id, usuarioId)).for('update').limit(1);
    if (objetivo) exigirCuentaTocable(ctx.actor, objetivo.rol);
    const r = await tx
      .update(usuario)
      .set({ activo: true, actualizadoEn: ahora })
      .where(and(eq(usuario.id, usuarioId), isNull(usuario.eliminadoEn)))
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
  exigir(ctx.actor, 'supervisar');
  const e = parsear(z.object({ usuarioId: z.uuid(), rol: z.enum(ROLES) }), entrada);
  exigirRolAsignable(ctx.actor, e.rol);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    await serializarGuardaUltimoAdmin(tx);
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    const regla = validarRolOrganizacion(e.rol, u.organizacionTipo as TipoOrganizacion);
    if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);
    if (u.rol === e.rol) return; // sin cambio: no se escribe ni se audita
    if (exigeArea(e.rol, u.organizacionTipo) && !u.area) {
      throw new ErrorAccion('VALIDACION', 'Para pasarla a solicitante, primero asígnale un área (en «Datos»).');
    }
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
export async function cambiarOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaCambiarOrganizacion, entrada);
  const ahora = ahoraDe(ctx);
  const org = await cargarOrganizacion(ctx, e.organizacionId);
  await ctx.db.transaction(async (tx) => {
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, e.usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    if (u.organizacionId === org.id) return; // sin cambio
    const regla = validarRolOrganizacion(u.rol as Rol, org.tipo as TipoOrganizacion);
    if (!regla.ok) throw new ErrorAccion('VALIDACION', regla.mensaje);

    let reasignadas = 0;
    let movidas: Array<{ referenciaId: string; aUsuarioId: string }> = [];
    let accesosCerrados = 0;
    if (u.organizacionId !== org.id && (u.organizacionTipo === 'agencia' || org.tipo === 'agencia')) {
      const r = await reasignarPendientes(tx, u, e.reasignaciones ?? {}, ahora, ctx.actor.nombre, {
        mismaOrganizacion: u.organizacionTipo === 'agencia',
      });
      reasignadas = r.n;
      movidas = r.movidas;
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
  });
  return { ok: true };
}

// ---- Eliminar una cuenta ----------------------------------------------------------------------------

/** Lo que se sabe de una cuenta antes de borrarla: lo que se llevaria y lo que lo impide. La usa la pagina de la cuenta y el nucleo. */
export interface DiagnosticoBorradoCuenta {
  /** Dejo trabajo propio (historial, comentarios, fotos, fichas creadas o cerradas): al eliminarla se RETIRA y su nombre sigue en el historial. */
  conTrabajo: boolean;
  /** Referencias que tiene pendientes ahora; al borrarla se le quitan. */
  pendientes: number;
  /** Es la unica cuenta de su agencia: borrarla borra tambien la agencia. */
  borraLaAgencia: boolean;
}

export async function diagnosticoBorradoCuenta(ej: Ejecutor, usuarioId: string): Promise<DiagnosticoBorradoCuenta> {
  const [f] = filasDe<{ con_trabajo: boolean; pendientes: number; otros: number; tipo: string }>(
    await ej.execute(sql`
      select public.usuario_tiene_trabajo(u.id) as con_trabajo,
             (select count(*)::int from asignacion a where a.a_usuario_id = u.id and a.estado in ('pendiente','en_curso')) as pendientes,
             (select count(*)::int from usuario o where o.organizacion_id = u.organizacion_id and o.id <> u.id and o.eliminado_en is null) as otros,
             u.organizacion_tipo as tipo
        from usuario u where u.id = ${usuarioId}::uuid`),
  );
  if (!f) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
  return { conTrabajo: f.con_trabajo, pendientes: Number(f.pendientes), borraLaAgencia: f.tipo === 'agencia' && Number(f.otros) === 0 };
}

/**
 * Elimina una cuenta (reunion 2026-11-10). Si NO dejo trabajo propio se borra del todo. Si ya trabajo (2026-11-11) se RETIRA: la fila
 * queda anonimizada («… (cuenta eliminada)», sin usuario ni clave, fuera de las listas) para que el historial, los comentarios y las
 * fichas cerradas sigan diciendo quien las hizo. Lo operativo (pendientes, avisos, sesiones, clave) se va siempre. Si es la unica
 * cuenta de una agencia, la agencia se elimina tambien (retirada si la agencia dejo trabajo). No se borra a uno mismo, ni al unico administrador activo, y la supervisora no toca cuentas de
 * administrador ni de supervisora.
 */
export async function eliminarCuenta(ctx: Contexto, entrada: unknown): Promise<{ ok: true; nombre: string; usuario: string; agenciaEliminada: boolean }> {
  exigir(ctx.actor, 'supervisar');
  const { usuarioId } = parsear(z.object({ usuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    await serializarGuardaUltimoAdmin(tx);
    const [u] = await tx.select().from(usuario).where(eq(usuario.id, usuarioId)).for('update').limit(1);
    if (!u || u.eliminadoEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese usuario.');
    exigirCuentaTocable(ctx.actor, u.rol);
    if (u.id === ctx.actor.usuarioId) throw new ErrorAccion('VALIDACION', 'No puedes eliminar tu propia cuenta. Pídele a otro administrador que lo haga.');
    if (u.rol === 'admin' && u.activo) {
      const otros = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(usuario)
        .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true), sql`${usuario.id} <> ${u.id}`));
      if ((otros[0]?.n ?? 0) === 0) throw new ErrorAccion('VALIDACION', 'No puedes eliminar al único administrador activo.');
    }
    const [org] = await tx.select().from(organizacion).where(eq(organizacion.id, u.organizacionId)).limit(1);
    const d = await diagnosticoBorradoCuenta(tx, u.id);
    const nombreCuenta = u.username ?? u.email;
    // La unica cuenta de una agencia se va con la agencia (la funcion de la organizacion borra o retira sus cuentas y la organizacion).
    if (d.borraLaAgencia && org) await llamarBorrado(tx, 'eliminar_organizacion', org.id);
    else await llamarBorrado(tx, 'eliminar_usuario', u.id);
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'eliminar_cuenta',
      entidad: 'usuario',
      entidadId: u.id,
      detalle: {
        usuario: nombreCuenta,
        nombre: u.nombre,
        rol: u.rol,
        organizacion: org?.nombre ?? null,
        agenciaEliminada: d.borraLaAgencia,
        conservadaEnHistorial: d.conTrabajo,
        pendientesQuitados: d.pendientes,
      },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, nombre: u.nombre, usuario: nombreCuenta, agenciaEliminada: d.borraLaAgencia };
  });
}
