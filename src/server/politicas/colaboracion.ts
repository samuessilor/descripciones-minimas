/**
 * Lecturas de la colaboracion (13.2): bandeja "Mis pendientes", "Esperando a otros", recientes,
 * notificaciones, seguimiento de los envios de una ficha, historial y comentarios. TODA lectura recibe el
 * `Actor` y devuelve lo que ese actor puede ver: nombres de otra agencia como "Otra agencia", comentarios
 * internos solo a organizaciones internas, motivos ocultos a la aduana (PA-38) y el estado del correo solo
 * a quien envio, al administrador y a la persona que lleva el proceso.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import {
  asignacion,
  campoHistorial,
  comentario,
  entregaCorreo,
  notificacion,
  organizacion,
  referencia,
  usuario,
} from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { ETIQUETA_SECCION, SECCIONES, getCampo, type Seccion, type TipoProducto } from '@/dominio/campos';
import {
  esAsignacionActiva,
  nombreSinMarca,
  parsearSecciones,
  pedidoPorDefecto,
  pedidosPermitidos,
  plural,
  type EstadoAsignacion,
  type Pedido,
} from '@/dominio/colaboracion';
import { calcularCompletitud, type Completitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, type ColorFicha, type EstadoFicha } from '@/dominio/estado';
import { textoDeValor } from '@/dominio/mostrar-valor';
import { normalizarTexto } from '@/dominio/normalizacion';
import { autorVisible, comentarioVisible, motivoVisible, puedeEscribirCampo, type Rol, type TipoOrganizacion } from '@/dominio/permisos';
import { nombreDeArea } from '@/dominio/areas';
import { agenciasConAcceso, idsPermitidosParaAduana } from '../acciones/asignaciones';
import { cargarPerfiles, configAvisos, type Perfil } from '../colaboracion/comun';
import { getConfig } from '../config';
import type { Actor } from './actor';
import {
  NOMBRE_OTRA_AGENCIA,
  cargarReferenciaVisible,
  condicionVisible,
  type FilaReferencia,
} from './referencias';
import { condicionSinResponsable, pendientesDelArea } from './responsable-area';

// ---- Comunes --------------------------------------------------------------------------------------------

export interface PersonaVista {
  id: string | null;
  nombre: string;
  organizacion: string;
  esAgencia: boolean;
  /** Es otra agencia: no se revela quien es (A5). */
  enmascarada: boolean;
}

function personaVista(actor: Actor, p: Perfil | undefined): PersonaVista {
  if (!p) return { id: null, nombre: 'Alguien', organizacion: '', esAgencia: false, enmascarada: false };
  const oculta = autorVisible(actor, { organizacionId: p.organizacionId, organizacionTipo: p.organizacionTipo }) === 'otra_agencia';
  if (oculta) return { id: null, nombre: NOMBRE_OTRA_AGENCIA, organizacion: '', esAgencia: true, enmascarada: true };
  return {
    id: p.id,
    nombre: nombreSinMarca(p.nombre),
    organizacion: nombreSinMarca(p.organizacionNombre),
    esAgencia: p.organizacionTipo === 'agencia',
    enmascarada: false,
  };
}

export type EstadoCorreoVista = 'enviado' | 'en_cola' | 'reintentando' | 'no_entregable' | 'sin_correo';

export interface EntregaVista {
  estado: EstadoCorreoVista;
  intentos: number;
  enviadoEn: string | null;
  error: string | null;
}

function estadoCorreoDe(estado: string): EstadoCorreoVista {
  switch (estado) {
    case 'enviado':
      return 'enviado';
    case 'fallido':
      return 'reintentando';
    case 'abandonado':
      return 'no_entregable';
    default:
      return 'en_cola';
  }
}

/** Ultimo correo de cada asignacion (aviso inicial, actualizacion o recordatorio). */
async function entregasPorAsignacion(ej: Ejecutor, ids: readonly string[]): Promise<Map<string, EntregaVista>> {
  const mapa = new Map<string, EntregaVista>();
  if (ids.length === 0) return mapa;
  const filas = await ej
    .select({
      asignacionId: notificacion.asignacionId,
      estado: entregaCorreo.estado,
      intentos: entregaCorreo.intentos,
      enviadoEn: entregaCorreo.enviadoEn,
      error: entregaCorreo.ultimoError,
    })
    .from(entregaCorreo)
    .innerJoin(notificacion, eq(notificacion.id, entregaCorreo.notificacionId))
    .where(inArray(notificacion.asignacionId, [...ids]))
    .orderBy(desc(entregaCorreo.creadaEn), desc(entregaCorreo.id));
  for (const f of filas) {
    if (!f.asignacionId || mapa.has(f.asignacionId)) continue;
    mapa.set(f.asignacionId, {
      estado: estadoCorreoDe(f.estado),
      intentos: f.intentos,
      enviadoEn: f.enviadoEn ? f.enviadoEn.toISOString() : null,
      error: f.error,
    });
  }
  return mapa;
}

const SIN_CORREO: EntregaVista = { estado: 'sin_correo', intentos: 0, enviadoEn: null, error: null };

function completitudDe(tipo: TipoProducto, datos: FilaReferencia['datos']): Completitud {
  const valores: Record<string, unknown> = {};
  for (const [clave, e] of Object.entries(datos ?? {})) valores[clave] = e.v;
  return calcularCompletitud({ tipo, valores });
}

/**
 * Que le falta a la ficha segun lo que se le pidio a la persona (una frase corta). `secciones` es la de su
 * asignacion: si se le pidieron secciones concretas, solo se nombran esas (nunca la parte de otra persona).
 */
export function describirFalta(c: Completitud, pedido: string | null, estado: EstadoFicha, secciones: string | null = null): string | null {
  if (estado === 'CLASIFICADA') return 'Ya está clasificada';
  if (pedido === 'clasificar') {
    // La clasificacion finalizada es el cierre, no un dato que falte; la respuesta del area la espera la aduana.
    const datos = c.aduana.faltantes.filter((k) => k !== 'clasificacion_finalizada' && k !== 'respuesta_area').length;
    if (datos > 0) return `${datos === 1 ? 'Falta' : 'Faltan'} ${plural(datos, 'dato', 'datos')} de la aduana`;
    return c.aduana.faltantes.includes('respuesta_area') ? 'Esperando la respuesta del área' : 'Falta cerrar la clasificación';
  }
  if (pedido === 'responder') {
    // La fila del pedido tapa la derivada del area (C1): si tambien faltan campos del area, se nombran aqui.
    return c.area.faltan > 0
      ? `Te pidieron información · faltan ${plural(c.area.faltan, 'campo', 'campos')} del área`
      : 'Te pidieron información: lee el mensaje';
  }
  const propias = parsearSecciones(secciones);
  const seccion = (propias.length > 0 ? propias : SECCIONES).find((s) => c.secciones[s].estado === 'amarillo');
  if (seccion) return `Falta: ${ETIQUETA_SECCION[seccion]} (${plural(c.secciones[seccion].faltan, 'campo', 'campos')})`;
  // Lo suyo ya esta en verde: la asignacion sigue abierta hasta que marque «Listo por mi parte».
  if (propias.length > 0) return 'Tu parte está completa: marca «Listo por mi parte»';
  if (c.area.faltan > 0) return `Faltan ${plural(c.area.faltan, 'campo', 'campos')} del área`;
  return 'Lo del área está completo';
}

function etiquetaColor(c: ColorFicha): string {
  return c === 'verde' ? 'Clasificada' : 'Pendiente';
}

// ---- Mis pendientes ------------------------------------------------------------------------------------

export interface FilaPendiente {
  /** `null` = no se la envio nadie: es de su area (responsabilidad derivada, C1). */
  asignacionId: string | null;
  /** Area responsable cuando la fila sale por ser del area del actor. */
  delArea: string | null;
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  /** Quien se la envio. */
  deUsuario: string;
  deOrganizacion: string;
  pedido: Pedido | null;
  mensaje: string | null;
  /** Desde cuando la tiene pendiente (ISO). */
  desde: string;
  estadoAsignacion: EstadoAsignacion;
  diasEnGestion: number;
  color: ColorFicha;
  etiqueta: string;
  falta: string | null;
}

/** Asignaciones `pendiente`/`en_curso` hacia el actor; primero las que mas dias llevan en gestion (S-09). */
export async function pendientesDe(ej: Ejecutor, actor: Actor, ahora: Date): Promise<FilaPendiente[]> {
  const filas = await ej
    .select({
      asignacionId: asignacion.id,
      referenciaId: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estadoFicha: referencia.estado,
      datos: referencia.datos,
      fechaSolicitud: referencia.fechaSolicitud,
      clasificadaEn: referencia.clasificadaEn,
      diasPausa: referencia.diasPausa,
      pedido: asignacion.pedido,
      secciones: asignacion.secciones,
      mensaje: asignacion.mensaje,
      desde: asignacion.creadaEn,
      estadoAsignacion: asignacion.estado,
      deId: asignacion.deUsuarioId,
    })
    .from(asignacion)
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(and(eq(asignacion.aUsuarioId, actor.usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso']), isNull(referencia.archivadaEn)))
    .orderBy(asc(asignacion.creadaEn));

  const remitentes = await cargarPerfiles(ej, filas.map((f) => f.deId));

  const resultado = filas.map((f): FilaPendiente => {
    const estado = f.estadoFicha as EstadoFicha;
    const de = personaVista(actor, remitentes.get(f.deId));
    const c = completitudDe(f.tipoProducto as TipoProducto, f.datos);
    const color = colorFicha(estado);
    return {
      asignacionId: f.asignacionId,
      delArea: null,
      referenciaId: f.referenciaId,
      codigo: f.codigo,
      nombreProducto: f.nombreProducto,
      tipoProducto: f.tipoProducto as TipoProducto,
      deUsuario: de.nombre,
      deOrganizacion: de.organizacion,
      pedido: (f.pedido as Pedido | null) ?? null,
      mensaje: f.mensaje,
      desde: f.desde.toISOString(),
      estadoAsignacion: f.estadoAsignacion as EstadoAsignacion,
      diasEnGestion: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora, diasPausa: f.diasPausa }),
      color,
      etiqueta: etiquetaColor(color),
      falta: describirFalta(c, f.pedido, estado, f.secciones),
    };
  });
  // Las de su area que nadie tiene en la mano (C1): salen aunque nadie se las haya enviado.
  for (const p of await pendientesDelArea(ej, actor, ahora)) {
    resultado.push({
      asignacionId: null,
      delArea: p.area,
      referenciaId: p.referenciaId,
      codigo: p.codigo,
      nombreProducto: p.nombreProducto,
      tipoProducto: p.tipoProducto,
      deUsuario: nombreDeArea(p.area),
      deOrganizacion: '',
      pedido: 'completar',
      mensaje: null,
      desde: p.desde,
      estadoAsignacion: 'pendiente',
      diasEnGestion: p.diasEnGestion,
      color: p.color,
      etiqueta: etiquetaColor(p.color),
      falta: p.falta,
    });
  }
  return resultado.sort((a, b) => b.diasEnGestion - a.diasEnGestion || a.desde.localeCompare(b.desde));
}

// ---- Esperando a otros -----------------------------------------------------------------------------------

export interface FilaEsperando {
  asignacionId: string;
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  aUsuario: PersonaVista;
  /** Quien la envio (cuando la dueña del proceso ve las de otros). */
  deUsuario: PersonaVista;
  esMia: boolean;
  pedido: Pedido | null;
  desde: string;
  estadoAsignacion: EstadoAsignacion;
  diasEsperando: number;
  diasEnGestion: number;
  color: ColorFicha;
  etiqueta: string;
  entrega: EntregaVista;
  recordadaHoy: boolean;
  nRecordatorios: number;
  /** El actor puede recordar / cancelar / reasignar (segun 3.3). */
  puedeRecordar: boolean;
  puedeGestionar: boolean;
}

/**
 * Asignaciones abiertas que el actor espera de otros. Quien lleva el proceso (`lector`) y el admin ven las
 * de cualquier persona (C-17); los demas, las que ellos enviaron.
 */
export async function esperandoDe(ej: Ejecutor, actor: Actor, ahora: Date, limite = 100): Promise<FilaEsperando[]> {
  const ve_todas = actor.rol === 'lector' || actor.rol === 'admin';
  const filas = await ej
    .select({
      asignacionId: asignacion.id,
      referenciaId: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estadoFicha: referencia.estado,
      fechaSolicitud: referencia.fechaSolicitud,
      clasificadaEn: referencia.clasificadaEn,
      diasPausa: referencia.diasPausa,
      pedido: asignacion.pedido,
      desde: asignacion.creadaEn,
      estadoAsignacion: asignacion.estado,
      deId: asignacion.deUsuarioId,
      aId: asignacion.aUsuarioId,
      nRecordatorios: asignacion.nRecordatorios,
      ultimoRecordatorioEn: asignacion.ultimoRecordatorioEn,
    })
    .from(asignacion)
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(
      and(
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
        isNull(referencia.archivadaEn),
        condicionVisible(actor, ahora),
        ve_todas ? sql`true` : eq(asignacion.deUsuarioId, actor.usuarioId),
        // Lo que me enviaron a mi va en "Para mi", no aqui.
        sql`${asignacion.aUsuarioId} <> ${actor.usuarioId}`,
      ),
    )
    .orderBy(asc(asignacion.creadaEn))
    .limit(limite);

  const perfiles = await cargarPerfiles(ej, filas.flatMap((f) => [f.deId, f.aId]));
  const entregas = await entregasPorAsignacion(ej, filas.map((f) => f.asignacionId));
  const hoyBogota = new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);

  return filas
    .map((f): FilaEsperando => {
      const esMia = f.deId === actor.usuarioId;
      const color = colorFicha(f.estadoFicha as EstadoFicha);
      const ultimo = f.ultimoRecordatorioEn ? new Date(f.ultimoRecordatorioEn.getTime() - 5 * 3_600_000).toISOString().slice(0, 10) : null;
      const puedeRecordar = actor.rol === 'admin' || actor.rol === 'lector' || esMia;
      return {
        asignacionId: f.asignacionId,
        referenciaId: f.referenciaId,
        codigo: f.codigo,
        nombreProducto: f.nombreProducto,
        tipoProducto: f.tipoProducto as TipoProducto,
        aUsuario: personaVista(actor, perfiles.get(f.aId)),
        deUsuario: personaVista(actor, perfiles.get(f.deId)),
        esMia,
        pedido: (f.pedido as Pedido | null) ?? null,
        desde: f.desde.toISOString(),
        estadoAsignacion: f.estadoAsignacion as EstadoAsignacion,
        diasEsperando: Math.max(0, Math.floor((ahora.getTime() - f.desde.getTime()) / 86_400_000)),
        diasEnGestion: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora, diasPausa: f.diasPausa }),
        color,
        etiqueta: etiquetaColor(color),
        entrega: entregas.get(f.asignacionId) ?? SIN_CORREO,
        recordadaHoy: ultimo === hoyBogota && configAvisos().maxRecordatoriosDia <= 1,
        nRecordatorios: f.nRecordatorios,
        puedeRecordar,
        puedeGestionar: actor.rol === 'admin' || (esMia && (actor.rol === 'solicitante' || actor.rol === 'aduana')),
      };
    })
    .sort((a, b) => b.diasEnGestion - a.diasEnGestion || a.desde.localeCompare(b.desde));
}

// ---- Recientes y resumen -------------------------------------------------------------------------------

export interface FilaReciente {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  color: ColorFicha;
  etiqueta: string;
  diasEnGestion: number;
  actualizadaEn: string;
}

export async function recientesDe(ej: Ejecutor, actor: Actor, ahora: Date, limite = 8): Promise<FilaReciente[]> {
  const filas = await ej
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estado: referencia.estado,
      fechaSolicitud: referencia.fechaSolicitud,
      clasificadaEn: referencia.clasificadaEn,
      diasPausa: referencia.diasPausa,
      actualizadaEn: referencia.actualizadaEn,
    })
    .from(referencia)
    .where(and(isNull(referencia.archivadaEn), condicionVisible(actor, ahora)))
    .orderBy(desc(referencia.actualizadaEn), desc(referencia.id))
    .limit(limite);
  return filas.map((f) => {
    const color = colorFicha(f.estado as EstadoFicha);
    return {
      id: f.id,
      codigo: f.codigo,
      nombreProducto: f.nombreProducto,
      tipoProducto: f.tipoProducto as TipoProducto,
      color,
      etiqueta: etiquetaColor(color),
      diasEnGestion: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora, diasPausa: f.diasPausa }),
      actualizadaEn: f.actualizadaEn.toISOString(),
    };
  });
}

export interface ResumenInicio {
  pendientesParaMi: number;
  esperandoAOtros: number;
  listas: number;
  /**
   * Solo para quien lleva el proceso (`lector`/`admin`): EN_GESTION sin ninguna asignacion activa ni area responsable
   * con cuenta (8.3 regla 11 + C1).
   */
  sinResponsable: number | null;
}

export async function resumenInicioDe(ej: Ejecutor, actor: Actor, ahora: Date): Promise<ResumenInicio> {
  const [para] = await ej
    .select({ n: sql<number>`count(*)::int` })
    .from(asignacion)
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(and(eq(asignacion.aUsuarioId, actor.usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso']), isNull(referencia.archivadaEn)));
  const veTodas = actor.rol === 'lector' || actor.rol === 'admin';
  const [esperando] = await ej
    .select({ n: sql<number>`count(*)::int` })
    .from(asignacion)
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(
      and(
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
        isNull(referencia.archivadaEn),
        condicionVisible(actor, ahora),
        veTodas ? sql`true` : eq(asignacion.deUsuarioId, actor.usuarioId),
        sql`${asignacion.aUsuarioId} <> ${actor.usuarioId}`,
      ),
    );
  const [listas] = await ej
    .select({ n: sql<number>`count(*)::int` })
    .from(referencia)
    .where(and(eq(referencia.estado, 'CLASIFICADA'), isNull(referencia.archivadaEn), condicionVisible(actor, ahora)));
  let sinResponsable: number | null = null;
  if (veTodas) {
    const [s] = await ej
      .select({ n: sql<number>`count(*)::int` })
      .from(referencia)
      .where(and(isNull(referencia.archivadaEn), condicionSinResponsable()));
    sinResponsable = s?.n ?? 0;
  }
  const delArea = (await pendientesDelArea(ej, actor, ahora)).length;
  return { pendientesParaMi: (para?.n ?? 0) + delArea, esperandoAOtros: esperando?.n ?? 0, listas: listas?.n ?? 0, sinResponsable };
}

// ---- Notificaciones ---------------------------------------------------------------------------------------

export interface NotificacionVista {
  id: string;
  tipo: string;
  titulo: string;
  referenciaId: string;
  asignacionId: string | null;
  leidaEn: string | null;
  creadaEn: string;
  /** Enlace interno a la ficha. */
  href: string;
}

export interface ListaNotificaciones {
  items: NotificacionVista[];
  noLeidas: number;
  /** Cursor para pedir mas (null si no hay mas). */
  siguiente: string | null;
}

export async function contarNoLeidasDe(ej: Ejecutor, actor: Actor): Promise<number> {
  const [r] = await ej
    .select({ n: sql<number>`count(*)::int` })
    .from(notificacion)
    .where(and(eq(notificacion.usuarioId, actor.usuarioId), isNull(notificacion.leidaEn)));
  return r?.n ?? 0;
}

export async function notificacionesDe(
  ej: Ejecutor,
  actor: Actor,
  opciones: { soloNoLeidas?: boolean; soloLeidas?: boolean; limite?: number; antes?: string | null } = {},
): Promise<ListaNotificaciones> {
  const limite = Math.min(Math.max(opciones.limite ?? 20, 1), 100);
  const condiciones = [eq(notificacion.usuarioId, actor.usuarioId)];
  if (opciones.soloNoLeidas) condiciones.push(isNull(notificacion.leidaEn));
  else if (opciones.soloLeidas) condiciones.push(isNotNull(notificacion.leidaEn));
  if (opciones.antes) {
    const [iso, id] = opciones.antes.split('|');
    const fecha = iso ? new Date(iso) : null;
    if (fecha && !Number.isNaN(fecha.getTime()) && id && /^[0-9a-f-]{36}$/i.test(id)) {
      const c = or(lt(notificacion.creadaEn, fecha), and(eq(notificacion.creadaEn, fecha), lt(notificacion.id, id)));
      if (c) condiciones.push(c);
    }
  }
  const filas = await ej
    .select()
    .from(notificacion)
    .where(and(...condiciones))
    .orderBy(desc(notificacion.creadaEn), desc(notificacion.id))
    .limit(limite + 1);
  const hayMas = filas.length > limite;
  const items = filas.slice(0, limite).map(
    (n): NotificacionVista => ({
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      referenciaId: n.referenciaId,
      asignacionId: n.asignacionId,
      leidaEn: n.leidaEn ? n.leidaEn.toISOString() : null,
      creadaEn: n.creadaEn.toISOString(),
      href: `/referencias/${n.referenciaId}`,
    }),
  );
  const ultima = items[items.length - 1];
  return {
    items,
    noLeidas: await contarNoLeidasDe(ej, actor),
    siguiente: hayMas && ultima ? `${ultima.creadaEn}|${ultima.id}` : null,
  };
}

// ---- Seguimiento de los envios de una ficha --------------------------------------------------------------

export interface SeguimientoAsignacion {
  asignacionId: string;
  referenciaId: string;
  codigo: string;
  /** Ya se le recordo hoy (calendario de Bogota). */
  recordadaHoy: boolean;
  a: PersonaVista;
  de: PersonaVista;
  pedido: Pedido | null;
  mensaje: string | null;
  estado: EstadoAsignacion;
  activa: boolean;
  creadaEn: string;
  vistaEn: string | null;
  completadaEn: string | null;
  nRecordatorios: number;
  ultimoRecordatorioEn: string | null;
  /** Solo para quien envio, el admin y quien lleva el proceso. */
  entrega: EntregaVista | null;
  esMia: boolean;
  puedeRecordar: boolean;
  puedeCancelar: boolean;
  puedeReasignar: boolean;
}

export async function seguimientoDeFicha(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<SeguimientoAsignacion[]> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const filas = await ej
    .select()
    .from(asignacion)
    .where(eq(asignacion.referenciaId, ficha.id))
    .orderBy(desc(asignacion.creadaEn))
    .limit(40);
  const perfiles = await cargarPerfiles(ej, filas.flatMap((f) => [f.deUsuarioId, f.aUsuarioId]));
  const activas = filas.filter((f) => esAsignacionActiva(f.estado)).map((f) => f.id);
  const entregas = await entregasPorAsignacion(ej, activas);

  return filas
    .filter((f) => {
      // Una agencia solo ve las asignaciones en las que participa su organizacion.
      if (actor.rol !== 'aduana') return true;
      const a = perfiles.get(f.aUsuarioId);
      const d = perfiles.get(f.deUsuarioId);
      return a?.organizacionId === actor.organizacionId || d?.organizacionId === actor.organizacionId || f.deUsuarioId === actor.usuarioId;
    })
    .map((f): SeguimientoAsignacion => {
      const activa = esAsignacionActiva(f.estado);
      const esMia = f.deUsuarioId === actor.usuarioId;
      const veEntrega = esMia || actor.rol === 'admin' || actor.rol === 'lector';
      const parte = esMia || f.aUsuarioId === actor.usuarioId || actor.rol !== 'aduana';
      const ultimoRecordatorio = f.ultimoRecordatorioEn ? new Date(f.ultimoRecordatorioEn.getTime() - 5 * 3_600_000).toISOString().slice(0, 10) : null;
      return {
        asignacionId: f.id,
        referenciaId: ficha.id,
        codigo: ficha.codigo,
        recordadaHoy:
          ultimoRecordatorio === new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10) && configAvisos().maxRecordatoriosDia <= 1,
        a: personaVista(actor, perfiles.get(f.aUsuarioId)),
        de: personaVista(actor, perfiles.get(f.deUsuarioId)),
        pedido: (f.pedido as Pedido | null) ?? null,
        mensaje: parte ? f.mensaje : null,
        estado: f.estado as EstadoAsignacion,
        activa,
        creadaEn: f.creadaEn.toISOString(),
        vistaEn: f.vistaEn ? f.vistaEn.toISOString() : null,
        completadaEn: f.completadaEn ? f.completadaEn.toISOString() : null,
        nRecordatorios: f.nRecordatorios,
        ultimoRecordatorioEn: f.ultimoRecordatorioEn ? f.ultimoRecordatorioEn.toISOString() : null,
        entrega: veEntrega && activa ? (entregas.get(f.id) ?? SIN_CORREO) : null,
        esMia,
        puedeRecordar: activa && (actor.rol === 'admin' || actor.rol === 'lector' || esMia),
        puedeCancelar: activa && (actor.rol === 'admin' || (esMia && (actor.rol === 'solicitante' || actor.rol === 'aduana'))),
        puedeReasignar: activa && (actor.rol === 'admin' || (esMia && (actor.rol === 'solicitante' || actor.rol === 'aduana'))),
      };
    });
}

// ---- Contexto del dialogo "Enviar a" -----------------------------------------------------------------------

export interface ContextoEnvio {
  referenciaId: string;
  /** Nombre de quien envia (para la vista previa del aviso). */
  quien: string;
  codigo: string;
  nombreProducto: string;
  estado: EstadoFicha;
  archivada: boolean;
  /** Campos que aun faltan del lado del area (aviso, no bloquea: 8.3 regla 3). */
  faltanDelArea: number;
  /** Secciones del area que siguen en amarillo: lo que se ofrece dejar pendiente. */
  seccionesPendientes: Seccion[];
  /** El aviso tambien sale por correo (modo completo). Apagado: solo campana y «Para mí». */
  avisosPorCorreo: boolean;
  puedeEnviar: boolean;
  /** Puede escribir comentarios (el lector solo los lee). */
  puedeComentar: boolean;
  /** La aduana solo escribe comentarios visibles para todos (RV-29). */
  comentaSoloParaTodos: boolean;
  /** Mi asignacion activa en esta ficha ("Listo por mi parte" se ofrece solo si existe). */
  miAsignacion: { id: string; pedido: Pedido | null; deNombre: string } | null;
  /** Agencia que hoy tiene la ficha (para el aviso de la segunda agencia). */
  agenciaActual: string | null;
}

export async function contextoEnvioDe(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<ContextoEnvio> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const c = completitudDe(ficha.tipoProducto as TipoProducto, ficha.datos);
  const [mia] = await ej
    .select({ id: asignacion.id, pedido: asignacion.pedido, deId: asignacion.deUsuarioId })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, actor.usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
    .orderBy(asc(asignacion.creadaEn))
    .limit(1);
  const de = mia ? (await cargarPerfiles(ej, [mia.deId])).get(mia.deId) : undefined;
  const agencias = await ej
    .selectDistinct({ id: organizacion.id, nombre: organizacion.nombre })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(
      and(
        eq(asignacion.referenciaId, ficha.id),
        eq(organizacion.tipo, 'agencia'),
        inArray(asignacion.estado, ['pendiente', 'en_curso']),
      ),
    );
  const puedeEnviar = actor.rol !== 'lector' && !ficha.archivadaEn;
  return {
    referenciaId: ficha.id,
    quien: nombreSinMarca(actor.nombre),
    codigo: ficha.codigo,
    nombreProducto: ficha.nombreProducto,
    estado: ficha.estado as EstadoFicha,
    archivada: ficha.archivadaEn !== null,
    faltanDelArea: c.area.faltan,
    seccionesPendientes: SECCIONES.filter((s) => c.secciones[s].estado === 'amarillo'),
    avisosPorCorreo: getConfig().AVISOS_POR_CORREO,
    puedeEnviar,
    puedeComentar: actor.rol !== 'lector' && !ficha.archivadaEn,
    comentaSoloParaTodos: actor.rol === 'aduana',
    miAsignacion: mia ? { id: mia.id, pedido: (mia.pedido as Pedido | null) ?? null, deNombre: personaVista(actor, de).nombre } : null,
    agenciaActual: agencias[0] && actor.organizacionTipo !== 'agencia' ? nombreSinMarca(agencias[0].nombre) : null,
  };
}

// ---- Candidatos a destinatario ------------------------------------------------------------------------------

export interface CandidatoDestino {
  id: string;
  nombre: string;
  organizacionId: string;
  organizacion: string;
  esAgencia: boolean;
  rol: Rol;
  area: string | null;
  pedidosPermitidos: Pedido[];
  pedidoPorDefecto: Pedido;
  /** Ya tiene esta ficha pendiente con este pedido. */
  yaTiene: Pedido | null;
  /** Por que no se le puede enviar (se muestra deshabilitado, con salida). */
  noDisponible: string | null;
}

/**
 * Personas a las que el actor puede enviar esta ficha, para el selector. Un usuario interno ve a todos los
 * activos que no sean `lector`; una agencia solo a quien creo la ficha, a quienes se la enviaron y a su propia
 * agencia (no se revela el resto del equipo interno a un externo).
 */
export async function candidatosDestinoDe(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<CandidatoDestino[]> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const filas = await ej
    .select({ id: usuario.id })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(and(eq(usuario.activo, true), eq(organizacion.activa, true), sql`${usuario.rol} <> 'lector'`, sql`${usuario.id} <> ${actor.usuarioId}`));
  let ids = filas.map((f) => f.id);
  const perfiles = await cargarPerfiles(ej, ids);
  if (actor.rol === 'aduana') {
    const permitidos = await idsPermitidosParaAduana(ej, ficha);
    ids = ids.filter((id) => permitidos.has(id) || perfiles.get(id)?.organizacionId === actor.organizacionId);
  }
  const activas = await ej
    .select({ aId: asignacion.aUsuarioId, pedido: asignacion.pedido })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, ficha.id), inArray(asignacion.estado, ['pendiente', 'en_curso'])));
  const yaTienen = new Map(activas.map((a) => [a.aId, (a.pedido as Pedido | null) ?? null]));
  const agencias = await agenciasConAcceso(ej, ficha.id, ahora);
  const cerrada = ficha.estado === 'CLASIFICADA';

  return ids
    .map((id) => perfiles.get(id))
    .filter((p): p is Perfil => !!p)
    .map((p): CandidatoDestino => {
      let noDisponible: string | null = null;
      if (p.organizacionTipo === 'agencia' && agencias.length > 0 && !agencias.some((a) => a.id === p.organizacionId) && actor.rol !== 'admin') {
        noDisponible = 'La referencia ya está con otra agencia. Pide a un administrador que la comparta.';
      } else if (cerrada && !pedidosPermitidos(p.rol).includes('revisar')) {
        noDisponible = 'La referencia está clasificada.';
      }
      return {
        id: p.id,
        nombre: nombreSinMarca(p.nombre),
        organizacionId: p.organizacionId,
        organizacion: nombreSinMarca(p.organizacionNombre),
        esAgencia: p.organizacionTipo === 'agencia',
        rol: p.rol,
        area: p.area,
        pedidosPermitidos: cerrada ? pedidosPermitidos(p.rol).filter((x) => x === 'revisar') : pedidosPermitidos(p.rol),
        pedidoPorDefecto: cerrada ? 'revisar' : pedidoPorDefecto(p.rol),
        yaTiene: yaTienen.get(p.id) ?? null,
        noDisponible,
      };
    })
    .sort((a, b) => a.organizacion.localeCompare(b.organizacion, 'es') || a.nombre.localeCompare(b.nombre, 'es'));
}

/** Filtra candidatos por texto (nombre, organizacion, area), sin tildes ni mayusculas. */
export function filtrarCandidatos(lista: readonly CandidatoDestino[], q: string): CandidatoDestino[] {
  const tokens = normalizarTexto(q).split(' ').filter(Boolean);
  if (tokens.length === 0) return [...lista];
  return lista.filter((c) => {
    const pajar = normalizarTexto(`${c.nombre} ${c.organizacion} ${c.area ?? ''}`);
    return tokens.every((t) => pajar.includes(t));
  });
}

// ---- Historial de la ficha -----------------------------------------------------------------------------------

export interface EntradaHistorialFicha {
  id: number;
  campo: string;
  etiqueta: string;
  version: number;
  tipoEvento: string;
  /** Texto legible del valor que quedo. */
  valor: string;
  motivo: string | null;
  hayMotivoOculto: boolean;
  autor: string;
  autorEsPropio: boolean;
  creadoEn: string;
  restauraId: number | null;
  /** Es la version vigente del campo. */
  vigente: boolean;
  /** El actor puede reponer este valor (permiso de campo, ficha abierta, no es la vigente). */
  restaurable: boolean;
}

export interface HistorialFicha {
  items: EntradaHistorialFicha[];
  /** Campos con historial (para el filtro). */
  campos: Array<{ clave: string; etiqueta: string }>;
  siguiente: number | null;
}

/**
 * Etiqueta legible de una clave del historial o de un comentario. Las claves `dm:<id>` son respuestas a las
 * preguntas que la aduana hacia antes de 2026-10-27: el historial es inmutable y las conserva.
 */
function etiquetaDeCampo(clave: string): string {
  return getCampo(clave)?.etiqueta ?? (clave.startsWith('dm:') ? 'Respuesta a una pregunta (retirada)' : clave);
}

export async function historialDeFichaDe(
  ej: Ejecutor,
  actor: Actor,
  referenciaId: string,
  ahora: Date,
  opciones: { campo?: string | null; antes?: number | null; limite?: number } = {},
): Promise<HistorialFicha> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const limite = Math.min(Math.max(opciones.limite ?? 40, 1), 100);
  const condiciones = [eq(campoHistorial.referenciaId, ficha.id)];
  if (opciones.campo) condiciones.push(eq(campoHistorial.campo, opciones.campo));
  if (opciones.antes) condiciones.push(lt(campoHistorial.id, opciones.antes));

  const filas = await ej
    .select()
    .from(campoHistorial)
    .where(and(...condiciones))
    .orderBy(desc(campoHistorial.id))
    .limit(limite + 1);
  const hayMas = filas.length > limite;
  const pagina = filas.slice(0, limite);

  const perfiles = await cargarPerfiles(ej, pagina.map((f) => f.autorId));
  const cerrada = ficha.estado === 'CLASIFICADA' || ficha.archivadaEn !== null;
  const permisoPorCampo = new Map<string, boolean>();
  const puedeCampo = (clave: string): boolean => {
    let v = permisoPorCampo.get(clave);
    if (v === undefined) {
      v = puedeEscribirCampo(actor, clave, { estado: ficha.estado as EstadoFicha, archivada: ficha.archivadaEn !== null, creadaPor: ficha.creadaPor }).ok;
      permisoPorCampo.set(clave, v);
    }
    return v;
  };

  const items = pagina.map((f): EntradaHistorialFicha => {
    const perfil = perfiles.get(f.autorId);
    const tipoOrg: TipoOrganizacion = perfil?.organizacionTipo ?? 'interna';
    const veMotivo = motivoVisible(actor, { organizacionId: f.organizacionId, organizacionTipo: tipoOrg });
    const def = getCampo(f.campo) ?? null;
    const vigente = ficha.datos?.[f.campo]?.n === f.versionCampo;
    return {
      id: f.id,
      campo: f.campo,
      etiqueta: etiquetaDeCampo(f.campo),
      version: f.versionCampo,
      tipoEvento: f.tipoEvento,
      valor: textoDeValor(def, f.valor),
      motivo: veMotivo ? f.motivo : null,
      hayMotivoOculto: !veMotivo && !!f.motivo,
      autor: personaVista(actor, perfil).nombre,
      autorEsPropio: f.autorId === actor.usuarioId,
      creadoEn: f.creadoEn.toISOString(),
      restauraId: f.restauraId,
      vigente,
      // la clasificacion finalizada solo cambia con finalizar/reabrir (ver restaurarCampo)
      restaurable: !cerrada && !vigente && f.campo !== 'clasificacion_finalizada' && puedeCampo(f.campo),
    };
  });

  const camposFilas = await ej
    .selectDistinct({ campo: campoHistorial.campo })
    .from(campoHistorial)
    .where(eq(campoHistorial.referenciaId, ficha.id));
  const campos = camposFilas
    .map((c) => ({ clave: c.campo, etiqueta: etiquetaDeCampo(c.campo) }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es'));

  const ultima = pagina[pagina.length - 1];
  return { items, campos, siguiente: hayMas && ultima ? ultima.id : null };
}

// ---- Resumen "quien lo puso y cuando" por campo ------------------------------------------------------------

export interface ResumenCampo {
  clave: string;
  autor: string;
  propio: boolean;
  instante: string;
  version: number;
}

export async function resumenCamposDe(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<{ version: number; campos: ResumenCampo[] }> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const datos = ficha.datos ?? {};
  const perfiles = await cargarPerfiles(ej, Object.values(datos).map((e) => e.a));
  const campos = Object.entries(datos)
    .filter(([, e]) => e.v !== null && e.v !== undefined)
    .map(([clave, e]) => ({
      clave,
      autor: personaVista(actor, perfiles.get(e.a)).nombre,
      propio: e.a === actor.usuarioId,
      instante: e.t,
      version: e.n,
    }));
  return { version: ficha.version, campos };
}

// ---- Comentarios --------------------------------------------------------------------------------------------

export interface ComentarioVista {
  id: string;
  campo: string | null;
  campoEtiqueta: string | null;
  autor: string;
  autorEsPropio: boolean;
  texto: string;
  visibilidad: 'interno' | 'todos';
  creadoEn: string;
}

export async function comentariosDe(
  ej: Ejecutor,
  actor: Actor,
  referenciaId: string,
  ahora: Date,
  opciones: { campo?: string | null } = {},
): Promise<ComentarioVista[]> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const condiciones = [eq(comentario.referenciaId, ficha.id)];
  if (opciones.campo) condiciones.push(eq(comentario.campo, opciones.campo));
  // Los comentarios internos NUNCA llegan a una agencia (RV-29): se filtran en SQL, no en la interfaz.
  if (!comentarioVisible(actor, 'interno')) condiciones.push(eq(comentario.visibilidad, 'todos'));
  const filas = await ej
    .select()
    .from(comentario)
    .where(and(...condiciones))
    .orderBy(asc(comentario.creadoEn), asc(comentario.id))
    .limit(300);
  const perfiles = await cargarPerfiles(ej, filas.map((f) => f.autorId));
  return filas.map(
    (f): ComentarioVista => ({
      id: f.id,
      campo: f.campo,
      campoEtiqueta: f.campo ? etiquetaDeCampo(f.campo) : null,
      autor: personaVista(actor, perfiles.get(f.autorId)).nombre,
      autorEsPropio: f.autorId === actor.usuarioId,
      texto: f.texto,
      visibilidad: f.visibilidad as 'interno' | 'todos',
      creadoEn: f.creadoEn.toISOString(),
    }),
  );
}
