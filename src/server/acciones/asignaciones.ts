/**
 * Asignaciones "Enviar a" (SPEC 8.3, 12.4, 14).
 *
 * Todo lo que cambia una asignacion ocurre en UNA transaccion junto con su notificacion y la auditoria: es
 * imposible un "enviado a Brian" sin pendiente para Brian. El aviso vive en la plataforma (campana y «Para mi»);
 * no hay correo.
 *
 *  - `enviarA` / `enviarALote`: upsert (nunca duplican un pendiente), reglas de visibilidad por
 *    organizacion y una sola agencia a la vez.
 *  - `marcarListo`, `cancelarAsignacion`, `recordar`, `reasignar`, `abrirFicha`.
 */
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, notificacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor, Tx } from '@/db/tipos';
import { esArea } from '@/dominio/areas';
import { SECCIONES, type Seccion } from '@/dominio/campos';
import {
  ETIQUETA_PARTE,
  ETIQUETA_PEDIDO,
  PEDIDOS,
  VERBO_PEDIDO,
  esAsignacionActiva,
  inicioDiaBogota,
  listaHumana,
  nombreSinMarca,
  parsearSecciones,
  pedidoCompatible,
  pedidoPorDefecto,
  pedidosPermitidos,
  plural,
  textoDeSecciones,
  transicionarAsignacion,
  type Pedido,
} from '@/dominio/colaboracion';
import { transicionar, type EstadoFicha } from '@/dominio/estado';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import {
  auditarColaboracion,
  cargarPerfiles,
  comoDestino,
  configAvisos,
  marcarLeidasDeFicha,
  type Perfil,
} from '../colaboracion/comun';
import { limitarTasa, REGLAS_TASA } from '../limite-tasa';
import { avisar } from '../notificaciones/avisar';
import { crearNotificacion } from '../notificaciones/crear';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import { cargarReferenciaBloqueada, cargarReferenciaVisible, type FilaReferencia } from '../politicas/referencias';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export type PedidoAsignacion = Pedido;

export interface DestinatarioEnvio {
  usuarioId: string;
  pedido?: PedidoAsignacion;
  /** Partes del area que se le dejan pendientes; vacio o ausente = toda su parte. */
  secciones?: Seccion[];
}

export interface EntradaEnviarA {
  referenciaId: string;
  destinatarios: DestinatarioEnvio[];
  mensaje?: string;
}

/** Que paso con una persona en un envio. */
export interface ResumenDestinatario {
  usuarioId: string;
  nombre: string;
  organizacion: string;
  creadas: number;
  actualizadas: number;
  /** Ya tenia esa referencia con el mismo pedido y mensaje: no se le avisa otra vez. */
  sinCambios: number;
  asignacionIds: string[];
}

export interface ResultadoEnviarA {
  creadas: number;
  actualizadas: number;
  /** Destinatarios (ids) que ya tenian la ficha pendiente ("ya tenian pendiente: N"). */
  yaTenianPendiente: string[];
  destinatarios: ResumenDestinatario[];
  /** Identificador del lote (solo `enviarALote`). */
  loteId?: string;
}

export interface EntradaEnviarALote {
  referenciaIds: string[];
  destinatarios: DestinatarioEnvio[];
  mensaje?: string;
}

// ---- Validacion de entrada ---------------------------------------------------------------------------

export const MAX_LOTE = 25;
const MAX_DESTINATARIOS = 25;

const esquemaDestinatario = z.object({ usuarioId: z.uuid(), pedido: z.enum(PEDIDOS).optional(), secciones: z.array(z.enum(SECCIONES)).max(SECCIONES.length).optional() });
const esquemaMensaje = textoLimpio().pipe(z.string().trim().max(500, 'El mensaje puede tener hasta 500 caracteres.')).optional();

export const entradaEnviarA = z.object({
  referenciaId: z.uuid(),
  destinatarios: z.array(esquemaDestinatario).min(1, 'Elige a quién se la envías.').max(MAX_DESTINATARIOS),
  mensaje: esquemaMensaje,
});

export const entradaEnviarALote = z.object({
  referenciaIds: z
    .array(z.uuid())
    .min(1, 'Selecciona al menos una referencia.')
    .max(MAX_LOTE, `Puedes enviar hasta ${MAX_LOTE} referencias a la vez.`),
  destinatarios: z.array(esquemaDestinatario).min(1, 'Elige a quién se las envías.').max(MAX_DESTINATARIOS),
  mensaje: esquemaMensaje,
});

function unicosDestinatarios(lista: readonly DestinatarioEnvio[]): DestinatarioEnvio[] {
  const mapa = new Map<string, DestinatarioEnvio>();
  for (const d of lista) mapa.set(d.usuarioId, d);
  return [...mapa.values()];
}

// ---- Reglas de visibilidad y de a quien se puede enviar ---------------------------------------------------

/** Agencias que HOY tienen acceso a la ficha: asignacion activa o terminada con `acceso_hasta` vigente (regla 10). */
export async function agenciasConAcceso(tx: Ejecutor, referenciaId: string, ahora: Date): Promise<Array<{ id: string; nombre: string }>> {
  return tx
    .selectDistinct({ id: organizacion.id, nombre: organizacion.nombre })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(
      and(
        eq(asignacion.referenciaId, referenciaId),
        eq(organizacion.tipo, 'agencia'),
        sql`(${asignacion.estado} in ('pendiente','en_curso')
              or (${asignacion.estado} in ('hecha','reasignada') and ${asignacion.accesoHasta} is not null
                  and ${asignacion.accesoHasta} > ${ahora.toISOString()}::timestamptz))`,
      ),
    );
}

/** Personas a las que una agencia puede enviar una ficha: quien la creo y quienes se la enviaron (mas su propia agencia). */
export async function idsPermitidosParaAduana(tx: Ejecutor, ficha: FilaReferencia): Promise<Set<string>> {
  const permitidos = new Set<string>([ficha.creadaPor]);
  const remitentes = await tx.select({ id: asignacion.deUsuarioId }).from(asignacion).where(eq(asignacion.referenciaId, ficha.id));
  for (const r of remitentes) permitidos.add(r.id);
  return permitidos;
}

interface DestinoValidado {
  perfil: Perfil;
  pedido: Pedido;
  /** Texto para `asignacion.secciones` (nulo = toda su parte). La aduana nunca lleva secciones. */
  secciones: string | null;
}

/**
 * Valida a cada destinatario contra el actor y la ficha. Lanza el primer problema con un mensaje que dice
 * que hacer. No escribe nada.
 */
async function validarDestinatarios(
  tx: Tx,
  actor: Actor,
  ficha: FilaReferencia,
  entradas: readonly DestinatarioEnvio[],
  ahora: Date,
): Promise<DestinoValidado[]> {
  const perfiles = await cargarPerfiles(
    tx,
    entradas.map((e) => e.usuarioId),
  );
  const agencias = await agenciasConAcceso(tx, ficha.id, ahora);
  const permitidosAduana = actor.rol === 'aduana' ? await idsPermitidosParaAduana(tx, ficha) : null;
  const cerrada = ficha.estado === 'CLASIFICADA';

  const validados: DestinoValidado[] = [];
  for (const e of entradas) {
    const p = perfiles.get(e.usuarioId);
    if (!p || !p.activo || !p.organizacionActiva) {
      throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos a esa persona o ya no tiene acceso a la plataforma. Elige a otra.');
    }
    const nombre = nombreSinMarca(p.nombre);
    if (p.rol === 'lector') {
      throw new ErrorAccion('VALIDACION', `${nombre} solo puede consultar la plataforma: no se le pueden enviar referencias. Elige a otra persona.`);
    }
    if (p.id === actor.usuarioId) {
      throw new ErrorAccion('VALIDACION', 'No puedes enviarte la referencia a ti. Elige a otra persona.');
    }
    const pedido = e.pedido ?? pedidoPorDefecto(p.rol);
    if (!pedidoCompatible(p.rol, pedido)) {
      const opcionesRol = pedidosPermitidos(p.rol)
        .map((x) => `«${ETIQUETA_PEDIDO[x]}»`)
        .join(' o ');
      throw new ErrorAccion('VALIDACION', `A ${nombre} no le corresponde «${ETIQUETA_PEDIDO[pedido]}». Puedes pedirle ${opcionesRol}.`);
    }
    if (cerrada && pedido !== 'revisar') {
      throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia ya está clasificada. Para enviarla de nuevo, pide «Revisar» o solicita su reapertura.');
    }
    if (permitidosAduana && !permitidosAduana.has(p.id) && p.organizacionId !== actor.organizacionId) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo puedes enviar esta referencia a quien te la envió o a alguien de tu agencia.');
    }
    // Una ficha tiene a lo sumo una agencia con acceso a la vez (D-29): una segunda solo la agrega un admin.
    if (
      p.organizacionTipo === 'agencia' &&
      agencias.length > 0 &&
      !agencias.some((a) => a.id === p.organizacionId) &&
      actor.rol !== 'admin'
    ) {
      const con = actor.organizacionTipo === 'agencia' ? null : agencias[0]?.nombre;
      throw new ErrorAccion(
        'SIN_PERMISO',
        con
          ? `Esta referencia ya está con ${nombreSinMarca(con)}. Pide a un administrador que la comparta con otra agencia.`
          : 'Esta referencia ya está con otra agencia. Pide a un administrador que la comparta.',
      );
    }
    validados.push({ perfil: p, pedido, secciones: p.rol === 'aduana' ? null : textoDeSecciones(e.secciones ?? []) });
  }
  return validados;
}

// ---- Poner una asignacion (crear o actualizar) ------------------------------------------------------------

interface ResultadoColocar {
  asignacionId: string;
  accion: 'creada' | 'actualizada' | 'sin_cambios';
  notificacionId: string | null;
}

/** «para completar: Detalle y Especificaciones» (sin partes si es toda su parte). */
function paraQue(pedido: Pedido, secciones: string | null): string {
  const partes = parsearSecciones(secciones).map((s) => ETIQUETA_PARTE[s]);
  return `para ${VERBO_PEDIDO[pedido]}${partes.length ? `: ${listaHumana(partes)}` : ''}`;
}

function tituloAsignacion(quien: string, codigo: string, pedido: Pedido, secciones: string | null = null): string {
  return `${nombreSinMarca(quien)} te envió ${codigo} ${paraQue(pedido, secciones)}`;
}

async function colocarAsignacion(
  tx: Tx,
  p: {
    actor: Actor;
    ficha: FilaReferencia;
    destino: DestinoValidado;
    mensaje: string | null;
    deUsuarioId: string;
    ahora: Date;
    /** Texto propio para la notificacion (reasignaciones). */
    titulo?: (pedido: Pedido) => string;
    /**
     * Si la asignacion ya existe y cambia, renueva su aviso SIN LEER en vez de crear otro. Lo usa la solicitud de la
     * aduana, que se reescribe varias veces; «Enviar a…» no lo usa: cada cambio que alguien envia se avisa aparte.
     */
    agruparAviso?: boolean;
  },
): Promise<ResultadoColocar> {
  const { actor, ficha, destino, ahora } = p;

  const [existente] = await tx
    .select()
    .from(asignacion)
    .where(
      and(
        eq(asignacion.referenciaId, ficha.id),
        eq(asignacion.aUsuarioId, destino.perfil.id),
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
      ),
    )
    .for('update')
    .limit(1);

  if (existente) {
    const igual =
      existente.pedido === destino.pedido &&
      (existente.mensaje ?? null) === (p.mensaje ?? null) &&
      (existente.secciones ?? null) === destino.secciones;
    if (igual) {
      return { asignacionId: existente.id, accion: 'sin_cambios', notificacionId: null };
    }
    await tx
      .update(asignacion)
      .set({ pedido: destino.pedido, mensaje: p.mensaje, secciones: destino.secciones })
      .where(eq(asignacion.id, existente.id));
    const notificacionId = await crearNotificacion(tx, {
      usuarioId: destino.perfil.id,
      tipo: 'asignacion',
      referenciaId: ficha.id,
      asignacionId: existente.id,
      titulo: p.titulo
        ? p.titulo(destino.pedido)
        : `${nombreSinMarca(actor.nombre)} actualizó lo que te pide en ${ficha.codigo}: ahora es ${paraQue(destino.pedido, destino.secciones)}`,
      creadaEn: ahora,
      agrupar: p.agruparAviso ?? false,
    });
    return { asignacionId: existente.id, accion: 'actualizada', notificacionId };
  }

  const [nueva] = await tx
    .insert(asignacion)
    .values({
      referenciaId: ficha.id,
      deUsuarioId: p.deUsuarioId,
      aUsuarioId: destino.perfil.id,
      pedido: destino.pedido,
      mensaje: p.mensaje,
      secciones: destino.secciones,
      estado: 'pendiente',
      creadaEn: ahora,
    })
    .returning({ id: asignacion.id });
  if (!nueva) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear la asignación.');

  const aviso = await avisar(tx, {
    destino: comoDestino(destino.perfil),
    tipo: 'asignacion',
    referenciaId: ficha.id,
    asignacionId: nueva.id,
    titulo: p.titulo ? p.titulo(destino.pedido) : tituloAsignacion(actor.nombre, ficha.codigo, destino.pedido, destino.secciones),
    ahora,
  });
  return { asignacionId: nueva.id, accion: 'creada', notificacionId: aviso.notificacionId };
}

function accesoTrasTerminar(actor: Pick<Actor, 'organizacionTipo'>, ahora: Date): Date | null {
  if (actor.organizacionTipo !== 'agencia') return null;
  return new Date(ahora.getTime() + configAvisos().diasAcceso * 86_400_000);
}

/** La asignacion de quien envia pasa a `hecha` (regla 5); una agencia conserva acceso de lectura unos dias. */
async function cerrarMisAsignaciones(tx: Tx, actor: Actor, referenciaId: string, ahora: Date): Promise<void> {
  const mias = await tx
    .select({ id: asignacion.id, estado: asignacion.estado })
    .from(asignacion)
    .where(
      and(
        eq(asignacion.referenciaId, referenciaId),
        eq(asignacion.aUsuarioId, actor.usuarioId),
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
      ),
    )
    .for('update');
  for (const m of mias) {
    transicionarAsignacion(m.estado as 'pendiente' | 'en_curso', 'terminar');
    await tx
      .update(asignacion)
      .set({ estado: 'hecha', completadaEn: ahora, accesoHasta: accesoTrasTerminar(actor, ahora) })
      .where(eq(asignacion.id, m.id));
  }
}

async function limitarEnvios(ctx: Contexto, ahora: Date): Promise<void> {
  const r = await limitarTasa(ctx.db, `enviar:${ctx.actor.usuarioId}`, REGLAS_TASA.enviarA, ahora);
  if (!r.permitido) {
    const minutos = Math.max(1, Math.ceil(r.reintentarEnMs / 60_000));
    throw new ErrorAccion(
      'LIMITE_TASA',
      `Enviaste muchas referencias seguidas. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`,
      { reintentarEnMs: r.reintentarEnMs },
    );
  }
}

function exigirPermisoEnviar(actor: Actor): void {
  if (!puede(actor, 'enviar_a')) {
    throw new ErrorAccion('SIN_PERMISO', 'Tu rol no puede enviar referencias. Si crees que es un error, avisa al administrador.');
  }
}

function exigirFichaEnviable(ficha: FilaReferencia): void {
  if (ficha.archivadaEn) {
    throw new ErrorAccion('FICHA_CERRADA', `La referencia ${ficha.codigo} está archivada: no se puede enviar. Un administrador puede desarchivarla.`);
  }
}

function resumenDe(perfil: Perfil, r: ResultadoColocar[]): ResumenDestinatario {
  return {
    usuarioId: perfil.id,
    nombre: nombreSinMarca(perfil.nombre),
    organizacion: nombreSinMarca(perfil.organizacionNombre),
    creadas: r.filter((x) => x.accion === 'creada').length,
    actualizadas: r.filter((x) => x.accion === 'actualizada').length,
    sinCambios: r.filter((x) => x.accion === 'sin_cambios').length,
    asignacionIds: r.map((x) => x.asignacionId),
  };
}

async function primerEnvio(tx: Tx, ficha: FilaReferencia, ahora: Date): Promise<void> {
  if (ficha.estado !== 'BORRADOR') return;
  await tx
    .update(referencia)
    .set({ estado: transicionar(ficha.estado as EstadoFicha, 'primer_envio'), version: sql`${referencia.version} + 1`, actualizadaEn: ahora })
    .where(eq(referencia.id, ficha.id));
}

// ---- enviarA ---------------------------------------------------------------------------------------------

export async function enviarA(ctx: Contexto, entrada: unknown): Promise<ResultadoEnviarA> {
  const e = parsear(entradaEnviarA, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  exigirPermisoEnviar(actor);
  await limitarEnvios(ctx, ahora);
  const mensaje = e.mensaje?.trim() ? e.mensaje.trim() : null;
  const destinatarios = unicosDestinatarios(e.destinatarios);

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    exigirFichaEnviable(ficha);
    const validados = await validarDestinatarios(tx, actor, ficha, destinatarios, ahora);

    const resumenes: ResumenDestinatario[] = [];
    let hubo = false;
    for (const destino of validados) {
      const r = await colocarAsignacion(tx, { actor, ficha, destino, mensaje, deUsuarioId: actor.usuarioId, ahora });
      if (r.accion !== 'sin_cambios') {
        hubo = true;
        await auditar(tx, {
          usuarioId: actor.usuarioId,
          accion: 'enviar_a',
          entidad: 'asignacion',
          entidadId: r.asignacionId,
          detalle: { referenciaId: ficha.id, codigo: ficha.codigo, para: destino.perfil.id, pedido: destino.pedido, resultado: r.accion },
          ip: ctx.ip,
          creadoEn: ahora,
        });
      }
      resumenes.push(resumenDe(destino.perfil, [r]));
    }

    if (hubo) {
      // Regla 5: al enviar a otra persona, mi pendiente en esta ficha queda hecho.
      await cerrarMisAsignaciones(tx, actor, ficha.id, ahora);
      await primerEnvio(tx, ficha, ahora);
    }

    return {
      creadas: resumenes.reduce((a, r) => a + r.creadas, 0),
      actualizadas: resumenes.reduce((a, r) => a + r.actualizadas, 0),
      yaTenianPendiente: resumenes.filter((r) => r.actualizadas + r.sinCambios > 0).map((r) => r.usuarioId),
      destinatarios: resumenes,
    };
  });
}

// ---- enviarALote ------------------------------------------------------------------------------------------

export async function enviarALote(ctx: Contexto, entrada: unknown): Promise<ResultadoEnviarA> {
  const e = parsear(entradaEnviarALote, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  exigirPermisoEnviar(actor);
  await limitarEnvios(ctx, ahora); // un lote cuenta como UNA operacion (13.3)
  const mensaje = e.mensaje?.trim() ? e.mensaje.trim() : null;
  const destinatarios = unicosDestinatarios(e.destinatarios);
  const idsFichas = [...new Set(e.referenciaIds)].sort();
  const loteId = crypto.randomUUID();

  return ctx.db.transaction(async (tx) => {
    const porDestino = new Map<string, ResultadoColocar[]>();
    const perfilesDestino = new Map<string, Perfil>();
    let asignacionesTocadas = 0;

    // Se bloquean en orden de id: dos lotes simultaneos no se interbloquean.
    for (const id of idsFichas) {
      const ficha = await cargarReferenciaBloqueada(tx, actor, id, ahora);
      exigirFichaEnviable(ficha);
      let validados: DestinoValidado[];
      try {
        validados = await validarDestinatarios(tx, actor, ficha, destinatarios, ahora);
      } catch (err) {
        if (err instanceof ErrorAccion) {
          throw new ErrorAccion(err.codigo, `${ficha.codigo}: ${err.message}`, { referenciaId: ficha.id });
        }
        throw err;
      }
      let hubo = false;
      for (const destino of validados) {
        const r = await colocarAsignacion(tx, { actor, ficha, destino, mensaje, deUsuarioId: actor.usuarioId, ahora });
        perfilesDestino.set(destino.perfil.id, destino.perfil);
        porDestino.set(destino.perfil.id, [...(porDestino.get(destino.perfil.id) ?? []), r]);
        if (r.accion !== 'sin_cambios') {
          hubo = true;
          asignacionesTocadas += 1;
          await auditar(tx, {
            usuarioId: actor.usuarioId,
            accion: 'enviar_a',
            entidad: 'asignacion',
            entidadId: r.asignacionId,
            detalle: { referenciaId: ficha.id, codigo: ficha.codigo, para: destino.perfil.id, pedido: destino.pedido, resultado: r.accion, loteId },
            ip: ctx.ip,
            creadoEn: ahora,
          });
        }
      }
      if (hubo) {
        await cerrarMisAsignaciones(tx, actor, ficha.id, ahora);
        await primerEnvio(tx, ficha, ahora);
      }
    }

    const resumenes: ResumenDestinatario[] = [];
    for (const [usuarioId, lista] of porDestino) {
      resumenes.push(resumenDe(perfilesDestino.get(usuarioId) as Perfil, lista));
    }

    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'enviar_lote',
      entidad: 'lote',
      entidadId: loteId,
      detalle: { referencias: idsFichas.length, destinatarios: destinatarios.map((d) => d.usuarioId), asignaciones: asignacionesTocadas },
      ip: ctx.ip,
      creadoEn: ahora,
    });

    return {
      creadas: resumenes.reduce((a, r) => a + r.creadas, 0),
      actualizadas: resumenes.reduce((a, r) => a + r.actualizadas, 0),
      yaTenianPendiente: resumenes.filter((r) => r.actualizadas + r.sinCambios > 0).map((r) => r.usuarioId),
      destinatarios: resumenes,
      loteId,
    };
  });
}

// ---- Cargar y autorizar sobre una asignacion --------------------------------------------------------------

/**
 * Bloquea la ficha y DESPUES la asignacion, en el mismo orden que marcarListo, enviarA y finalizar: con el orden
 * inverso dos clics a la vez sobre la misma ficha se interbloquean en Postgres (40P01). La primera lectura, sin
 * bloqueo, solo sirve para saber de que ficha es (la ficha de una asignacion no cambia).
 */
async function cargarAsignacionBloqueada(tx: Tx, actor: Actor, asignacionId: string, ahora: Date) {
  const noEsta = () => new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa asignación. Puede que ya se haya cancelado.');
  const [previa] = await tx.select({ referenciaId: asignacion.referenciaId }).from(asignacion).where(eq(asignacion.id, asignacionId)).limit(1);
  if (!previa) throw noEsta();
  const ficha = await cargarReferenciaBloqueada(tx, actor, previa.referenciaId, ahora);
  const [a] = await tx.select().from(asignacion).where(eq(asignacion.id, asignacionId)).for('update').limit(1);
  if (!a) throw noEsta();
  return { a, ficha };
}

const entradaAsignacion = z.object({ asignacionId: z.uuid() });

// ---- marcarListo ---------------------------------------------------------------------------------------------

export interface ResultadoMarcarListo {
  ok: true;
  /** Ya estaba hecha (doble clic o dos pestanas): no se notifica otra vez. */
  yaEstaba: boolean;
  /** Personas a las que se les aviso que terminaste. */
  avisados: string[];
}

export async function marcarListo(ctx: Contexto, entrada: unknown): Promise<ResultadoMarcarListo> {
  const { referenciaId } = parsear(z.object({ referenciaId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  exigirPermisoEnviar(actor);

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, referenciaId, ahora);
    const mias = await tx
      .select()
      .from(asignacion)
      .where(
        and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, actor.usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])),
      )
      .for('update');

    if (mias.length === 0) {
      const [hecha] = await tx
        .select({ id: asignacion.id })
        .from(asignacion)
        .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, actor.usuarioId), eq(asignacion.estado, 'hecha')))
        .limit(1);
      if (hecha) return { ok: true as const, yaEstaba: true, avisados: [] };
      throw new ErrorAccion(
        'VALIDACION',
        'Esta referencia no está pendiente para ti, así que no hay nada que marcar. Si quieres pasarla a alguien, usa «Enviar a…».',
      );
    }

    const hasta = accesoTrasTerminar(actor, ahora);
    for (const m of mias) {
      transicionarAsignacion(m.estado as 'pendiente' | 'en_curso', 'terminar');
      await tx.update(asignacion).set({ estado: 'hecha', completadaEn: ahora, accesoHasta: hasta }).where(eq(asignacion.id, m.id));
    }

    // Avisa a quien se la envio (una vez por persona).
    const remitentes = [...new Set(mias.map((m) => m.deUsuarioId))].filter((id) => id !== actor.usuarioId);
    const perfiles = await cargarPerfiles(tx, remitentes);
    const avisados: string[] = [];
    const devueltaA: string[] = [];
    let agencias: Array<{ id: string }> | null = null;
    for (const id of remitentes) {
      const p = perfiles.get(id);
      if (!p || !p.activo) continue;
      const delRemitente = mias.find((m) => m.deUsuarioId === id) as (typeof mias)[number];
      // Si la aduana pidio informacion («Responder») y ya no tiene la ficha en la mano (al enviarla, su pendiente
      // quedo hecho), la referencia vuelve a ella para clasificar: asi no queda sin responsable ni pierde el acceso.
      let asignacionAviso = delRemitente.id;
      const pidioInformacion = mias.some((m) => m.deUsuarioId === id && m.pedido === 'responder');
      // Si es de una agencia, solo se le devuelve si su agencia sigue con acceso: si un admin se lo retiro (y quiza la
      // envio a otra), devolverla le daria el acceso de vuelta y dejaria la ficha con dos agencias (D-29).
      if (p.organizacionTipo === 'agencia' && agencias === null) agencias = await agenciasConAcceso(tx, ficha.id, ahora);
      const conAcceso = p.organizacionTipo !== 'agencia' || !!agencias?.some((ag) => ag.id === p.organizacionId);
      if (!conAcceso) continue; // ya no ve la ficha: ni se le devuelve ni se le avisa
      if (pidioInformacion && ficha.estado === 'EN_GESTION' && pedidoCompatible(p.rol, 'clasificar') && p.organizacionActiva) {
        const [activa] = await tx
          .select({ id: asignacion.id })
          .from(asignacion)
          .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, id), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
          .limit(1);
        if (activa) asignacionAviso = activa.id;
        else {
          const [nueva] = await tx
            .insert(asignacion)
            .values({
              referenciaId: ficha.id,
              deUsuarioId: actor.usuarioId,
              aUsuarioId: id,
              pedido: 'clasificar',
              mensaje: 'Ya respondí lo que pediste: la referencia vuelve a ti para clasificar.',
              estado: 'pendiente',
              creadaEn: ahora,
            })
            .returning({ id: asignacion.id });
          if (nueva) {
            asignacionAviso = nueva.id;
            devueltaA.push(id);
          }
        }
      }
      await avisar(tx, {
        destino: comoDestino(p),
        tipo: 'respuesta',
        referenciaId: ficha.id,
        asignacionId: asignacionAviso,
        titulo: `${nombreSinMarca(actor.nombre)} terminó su parte en ${ficha.codigo}`,
        ahora,
      });
      avisados.push(id);
    }
    await auditarColaboracion(tx, {
      usuarioId: actor.usuarioId,
      accion: 'marcar_listo',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { codigo: ficha.codigo, asignaciones: mias.map((m) => m.id), avisados, ...(devueltaA.length > 0 ? { devueltaA } : {}) },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, yaEstaba: false, avisados };
  });
}

// ---- cancelarAsignacion --------------------------------------------------------------------------------------

export async function cancelarAsignacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true; yaEstaba: boolean }> {
  const { asignacionId } = parsear(entradaAsignacion, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const { a, ficha } = await cargarAsignacionBloqueada(tx, actor, asignacionId, ahora);
    const remitente = a.deUsuarioId === actor.usuarioId && (actor.rol === 'solicitante' || actor.rol === 'aduana');
    if (!(actor.rol === 'admin' || remitente)) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo quien envió la referencia o un administrador puede cancelar el envío.');
    }
    if (a.estado === 'cancelada') return { ok: true as const, yaEstaba: true };
    if (!esAsignacionActiva(a.estado)) {
      throw new ErrorAccion('VALIDACION', 'Esa persona ya terminó su parte o se la reasignaron, así que no hay nada que cancelar.');
    }
    transicionarAsignacion(a.estado as 'pendiente' | 'en_curso', 'cancelar');
    await tx.update(asignacion).set({ estado: 'cancelada', completadaEn: ahora, accesoHasta: null }).where(eq(asignacion.id, a.id));

    const destino = (await cargarPerfiles(tx, [a.aUsuarioId])).get(a.aUsuarioId);
    if (destino && destino.activo) {
      await avisar(tx, {
        destino: comoDestino(destino),
        tipo: 'asignacion',
        referenciaId: ficha.id,
        asignacionId: a.id,
        titulo: `${nombreSinMarca(actor.nombre)} canceló lo que te había enviado en ${ficha.codigo}. Ya no tienes nada pendiente ahí`,
        ahora,
      });
    }
    await auditarColaboracion(tx, {
      usuarioId: actor.usuarioId,
      accion: 'cancelar_asignacion',
      entidad: 'asignacion',
      entidadId: a.id,
      detalle: { referenciaId: ficha.id, codigo: ficha.codigo, aUsuarioId: a.aUsuarioId },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, yaEstaba: false };
  });
}

// ---- recordar -----------------------------------------------------------------------------------------------

export interface ResultadoRecordar {
  ok: true;
  /** Recordatorios enviados hoy sobre esta asignacion (incluido este). */
  hoy: number;
  maxPorDia: number;
}

export async function recordar(ctx: Contexto, entrada: unknown): Promise<ResultadoRecordar> {
  const { asignacionId } = parsear(entradaAsignacion, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const cfg = configAvisos();

  return ctx.db.transaction(async (tx) => {
    // El bloqueo de la ficha y la fila serializa dos "Recordar" simultaneos: el tope diario no se salta con dos clics.
    const { a, ficha } = await cargarAsignacionBloqueada(tx, actor, asignacionId, ahora);
    if (!puede(actor, 'recordar', { esRemitente: a.deUsuarioId === actor.usuarioId })) {
      throw new ErrorAccion(
        'SIN_PERMISO',
        'Solo quien envió la referencia, un administrador o la persona que lleva el proceso puede enviar un recordatorio.',
      );
    }
    if (!esAsignacionActiva(a.estado)) {
      throw new ErrorAccion('VALIDACION', 'Esa persona ya terminó su parte o la asignación se canceló, así que no hay nada que recordar.');
    }
    const [conteo] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(notificacion)
      .where(
        and(
          eq(notificacion.asignacionId, a.id),
          eq(notificacion.tipo, 'recordatorio'),
          gt(notificacion.creadaEn, new Date(inicioDiaBogota(ahora).getTime() - 1)),
        ),
      );
    const n = conteo?.n ?? 0;
    if (n >= cfg.maxRecordatoriosDia) {
      throw new ErrorAccion(
        'LIMITE_TASA',
        cfg.maxRecordatoriosDia === 1
          ? 'Ya enviaste un recordatorio hoy. Puedes volver a hacerlo mañana.'
          : `Ya enviaste ${cfg.maxRecordatoriosDia} recordatorios hoy. Puedes volver a hacerlo mañana.`,
        { hoy: n, maxPorDia: cfg.maxRecordatoriosDia },
      );
    }
    const perfil = (await cargarPerfiles(tx, [a.aUsuarioId])).get(a.aUsuarioId);
    if (!perfil || !perfil.activo) {
      throw new ErrorAccion('VALIDACION', 'Esa persona ya no tiene acceso a la plataforma. Reasigna la referencia a otra persona.');
    }
    const dias = Math.max(0, Math.floor((ahora.getTime() - a.creadaEn.getTime()) / 86_400_000));
    await avisar(tx, {
      destino: comoDestino(perfil),
      tipo: 'recordatorio',
      referenciaId: ficha.id,
      asignacionId: a.id,
      titulo: `${nombreSinMarca(actor.nombre)} te recuerda ${ficha.codigo}, que sigue pendiente${dias > 0 ? ` desde hace ${plural(dias, 'día', 'días')}` : ''}`,
      ahora,
    });
    await tx
      .update(asignacion)
      .set({ nRecordatorios: sql`${asignacion.nRecordatorios} + 1`, ultimoRecordatorioEn: ahora })
      .where(eq(asignacion.id, a.id));
    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'recordar',
      entidad: 'asignacion',
      entidadId: a.id,
      detalle: { referenciaId: ficha.id, codigo: ficha.codigo, aUsuarioId: a.aUsuarioId },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, hoy: n + 1, maxPorDia: cfg.maxRecordatoriosDia };
  });
}

// ---- reasignar ----------------------------------------------------------------------------------------------

export interface ResultadoReasignar {
  ok: true;
  nueva: ResumenDestinatario;
}

export async function reasignar(ctx: Contexto, entrada: unknown): Promise<ResultadoReasignar> {
  const e = parsear(z.object({ asignacionId: z.uuid(), aUsuarioId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const { a, ficha } = await cargarAsignacionBloqueada(tx, actor, e.asignacionId, ahora);
    if (!puede(actor, 'reasignar', { esRemitente: a.deUsuarioId === actor.usuarioId })) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo quien envió la referencia o un administrador puede reasignarla.');
    }
    if (!esAsignacionActiva(a.estado)) {
      throw new ErrorAccion('VALIDACION', 'Esa asignación ya terminó, así que no se puede reasignar. Envía la referencia a quien quieras desde «Enviar a…».');
    }
    if (a.aUsuarioId === e.aUsuarioId) {
      throw new ErrorAccion('VALIDACION', 'Esa persona ya tiene la referencia. Elige a otra.');
    }
    exigirFichaEnviable(ficha);
    const viejo = (await cargarPerfiles(tx, [a.aUsuarioId])).get(a.aUsuarioId);
    const nuevoPerfil = (await cargarPerfiles(tx, [e.aUsuarioId])).get(e.aUsuarioId);
    const pedidoOriginal = (a.pedido as Pedido | null) ?? null;
    const pedido: Pedido | undefined =
      nuevoPerfil && pedidoOriginal && pedidoCompatible(nuevoPerfil.rol, pedidoOriginal) ? pedidoOriginal : undefined;
    const [destino] = await validarDestinatarios(tx, actor, ficha, [{ usuarioId: e.aUsuarioId, ...(pedido ? { pedido } : {}) }], ahora);
    if (!destino) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos a esa persona.');

    transicionarAsignacion(a.estado as 'pendiente' | 'en_curso', 'reasignar');
    await tx.update(asignacion).set({ estado: 'reasignada', completadaEn: ahora, accesoHasta: null }).where(eq(asignacion.id, a.id));

    const r = await colocarAsignacion(tx, {
      actor,
      ficha,
      destino,
      mensaje: a.mensaje,
      deUsuarioId: a.deUsuarioId, // quien la envio sigue viendo a quien espera
      ahora,
      titulo: (p) => `${nombreSinMarca(actor.nombre)} te asignó ${ficha.codigo} para ${VERBO_PEDIDO[p]}`,
    });

    if (viejo && viejo.activo) {
      await avisar(tx, {
        destino: comoDestino(viejo),
        tipo: 'asignacion',
        referenciaId: ficha.id,
        asignacionId: a.id,
        titulo: `${nombreSinMarca(actor.nombre)} le pasó ${ficha.codigo} a ${nombreSinMarca(destino.perfil.nombre)}. Ya no tienes nada pendiente ahí`,
        ahora,
      });
    }
    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'reasignar',
      entidad: 'asignacion',
      entidadId: a.id,
      detalle: { referenciaId: ficha.id, codigo: ficha.codigo, de: a.aUsuarioId, a: e.aUsuarioId, nuevaAsignacionId: r.asignacionId },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, nueva: resumenDe(destino.perfil, [r]) };
  });
}

// ---- abrirFicha (pendiente -> en_curso) -----------------------------------------------------------------------

/**
 * Se llama cuando la persona abre la ficha (8.3): sus asignaciones `pendiente` pasan a `en_curso` y los
 * avisos sin leer de esa ficha se marcan leidos (ya los vio). Idempotente.
 */
export async function abrirFicha(ctx: Contexto, entrada: unknown): Promise<{ enCurso: number; leidas: number }> {
  const { referenciaId } = parsear(z.object({ referenciaId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaVisible(tx, actor, referenciaId, ahora);
    const pend = await tx
      .select({ id: asignacion.id })
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, actor.usuarioId), eq(asignacion.estado, 'pendiente')))
      .orderBy(asc(asignacion.creadaEn))
      .for('update');
    for (const p of pend) {
      await tx
        .update(asignacion)
        .set({ estado: transicionarAsignacion('pendiente', 'abrir'), vistaEn: ahora })
        .where(eq(asignacion.id, p.id));
    }
    const leidas = await marcarLeidasDeFicha(tx, actor.usuarioId, ficha.id, ahora);
    return { enCurso: pend.length, leidas };
  });
}

// ---- Aviso de una asignacion creada por otra via (reasignacion al desactivar a un usuario, etc.) ------------------

/**
 * Para quien crea una asignacion SIN pasar por `enviarA` (p. ej. la reasignacion obligatoria al desactivar a un
 * usuario, `acciones/usuarios.ts`): deja el aviso en la bandeja del nuevo responsable, en la misma transaccion de
 * quien llama. Idempotente: si la asignacion ya tiene su aviso inicial no hace nada.
 */
export async function avisarAsignacionExistente(
  tx: Tx,
  p: { asignacionId: string; quien: string; ahora: Date; titulo?: string },
): Promise<{ notificacionId: string } | null> {
  const [a] = await tx.select().from(asignacion).where(eq(asignacion.id, p.asignacionId)).limit(1);
  if (!a || !esAsignacionActiva(a.estado)) return null;
  const [previo] = await tx
    .select({ id: notificacion.id })
    .from(notificacion)
    .where(and(eq(notificacion.asignacionId, a.id), eq(notificacion.tipo, 'asignacion')))
    .limit(1);
  if (previo) return null;
  const [ficha] = await tx.select().from(referencia).where(eq(referencia.id, a.referenciaId)).limit(1);
  const destino = (await cargarPerfiles(tx, [a.aUsuarioId])).get(a.aUsuarioId);
  if (!ficha || !destino || !destino.activo) return null;
  const pedido = ((a.pedido as Pedido | null) ?? pedidoPorDefecto(destino.rol)) as Pedido;
  const r = await avisar(tx, {
    destino: comoDestino(destino),
    tipo: 'asignacion',
    referenciaId: ficha.id,
    asignacionId: a.id,
    titulo: p.titulo ?? tituloAsignacion(p.quien, ficha.codigo, pedido),
    ahora: p.ahora,
  });
  return { notificacionId: r.notificacionId };
}

// ---- Solicitud de informacion de la aduana (descripciones minimas adicionales) ------------------------------------

/** El mensaje de una asignacion admite 500 caracteres: la solicitud completa se lee en la zona de la aduana. */
function mensajeDeSolicitud(solicitud: string): string {
  const t = solicitud.trim();
  return [...t].length <= 500 ? t : `${[...t].slice(0, 497).join('')}…`;
}

/**
 * A QUIEN le llega la solicitud de informacion de la aduana. PUNTO UNICO para cambiar el destinatario: las cuentas
 * activas del «Área responsable» de la referencia (C1). Si la ficha no tiene area o el area no tiene a nadie que pueda
 * responder, quien creo la referencia; y si tampoco, las personas internas con una asignacion activa en la ficha.
 */
export async function destinatariosSolicitudAduana(tx: Ejecutor, ficha: FilaReferencia): Promise<Perfil[]> {
  const puedeResponder = (p: Perfil | undefined): p is Perfil =>
    !!p && p.activo && p.organizacionActiva && p.organizacionTipo === 'interna' && pedidoCompatible(p.rol, 'responder');
  const area = ficha.datos?.area_responsable?.v;
  if (esArea(area)) {
    const delArea = await tx
      .select({ id: usuario.id })
      .from(usuario)
      .where(and(eq(usuario.area, area), eq(usuario.activo, true), eq(usuario.organizacionTipo, 'interna')));
    const cuentas = [...(await cargarPerfiles(tx, delArea.map((u) => u.id))).values()].filter(puedeResponder);
    if (cuentas.length > 0) return cuentas;
  }
  const creador = (await cargarPerfiles(tx, [ficha.creadaPor])).get(ficha.creadaPor);
  if (puedeResponder(creador)) return [creador];
  const activas = await tx
    .select({ a: asignacion.aUsuarioId })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, ficha.id), inArray(asignacion.estado, ['pendiente', 'en_curso'])));
  const perfiles = await cargarPerfiles(
    tx,
    activas.map((x) => x.a),
  );
  return [...perfiles.values()].filter(puedeResponder);
}

/**
 * La aduana escribio (o cambio) su solicitud: el area la recibe como pendiente «Responder» en «Para mí» y un aviso en la
 * campana, con el texto de la solicitud como mensaje. Reutiliza la asignacion de «Enviar a…» (upsert: nunca duplica
 * un pendiente) y no toca el pendiente de la aduana, que sigue con la ficha para clasificar. Si el area aun no leyo el
 * aviso de una solicitud anterior, se renueva ese aviso en vez de sumar otro. Sin correo (avisos solo en la app). Corre en la transaccion de `aplicarEscritura`.
 */
export async function pedirRespuestaAlArea(tx: Tx, actor: Actor, ficha: FilaReferencia, solicitud: string, ahora: Date): Promise<void> {
  const mensaje = mensajeDeSolicitud(solicitud);
  for (const perfil of await destinatariosSolicitudAduana(tx, ficha)) {
    if (perfil.id === actor.usuarioId) continue;
    await colocarAsignacion(tx, {
      actor,
      ficha,
      destino: { perfil, pedido: 'responder', secciones: null },
      mensaje,
      deUsuarioId: actor.usuarioId,
      ahora,
      titulo: () => `${nombreSinMarca(actor.nombre)} pide información adicional en ${ficha.codigo}`,
      agruparAviso: true,
    });
  }
}

/** Los pendientes «Responder» que dejo `deUsuarioId` en la ficha quedan hechos (ya no hay nada que responder). */
export async function terminarPedidosDeRespuesta(tx: Tx, referenciaId: string, deUsuarioId: string, ahora: Date): Promise<void> {
  const abiertas = await tx
    .select({ id: asignacion.id, estado: asignacion.estado })
    .from(asignacion)
    .where(
      and(
        eq(asignacion.referenciaId, referenciaId),
        eq(asignacion.deUsuarioId, deUsuarioId),
        eq(asignacion.pedido, 'responder'),
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
      ),
    )
    .for('update');
  for (const a of abiertas) {
    transicionarAsignacion(a.estado as 'pendiente' | 'en_curso', 'terminar');
    await tx.update(asignacion).set({ estado: 'hecha', completadaEn: ahora }).where(eq(asignacion.id, a.id));
  }
}

/**
 * El area respondio la solicitud: los pendientes «Responder» que dejo quien escribio la solicitud quedan hechos y esa
 * persona recibe un aviso en la campana. Corre en la transaccion de `aplicarEscritura`.
 */
export async function registrarRespuestaDelArea(tx: Tx, actor: Actor, ficha: FilaReferencia, ahora: Date): Promise<void> {
  const autorSolicitud = ficha.datos?.descripciones_minimas?.a;
  if (!autorSolicitud) return;
  await terminarPedidosDeRespuesta(tx, ficha.id, autorSolicitud, ahora);
  if (autorSolicitud === actor.usuarioId) return;
  const autor = (await cargarPerfiles(tx, [autorSolicitud])).get(autorSolicitud);
  if (!autor || !autor.activo) return;
  await avisar(tx, {
    destino: comoDestino(autor),
    tipo: 'respuesta',
    referenciaId: ficha.id,
    titulo: `${nombreSinMarca(actor.nombre)} respondió tu solicitud de información en ${ficha.codigo}`,
    ahora,
  });
}
