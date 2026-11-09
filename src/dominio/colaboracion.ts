/**
 * Reglas puras de la colaboracion (SPEC 8.3 y 14): pedidos por rol, maquina de estados de la
 * asignacion y formato de tiempo. Dominio PURO: sin base ni Next.
 */
import { ETIQUETA_SECCION, SECCIONES, type Seccion } from './campos';
import type { Rol } from './permisos';

// ---- Pedidos ("¿Que le pides?", 8.3 regla 1) -------------------------------------------------------

export const PEDIDOS = ['completar', 'clasificar', 'responder', 'revisar'] as const;
export type Pedido = (typeof PEDIDOS)[number];

export const ETIQUETA_PEDIDO: Record<Pedido, string> = {
  completar: 'Completar',
  clasificar: 'Clasificar',
  responder: 'Responder',
  revisar: 'Revisar',
};

/** Verbo para frases: «te envió una referencia para clasificar». */
export const VERBO_PEDIDO: Record<Pedido, string> = {
  completar: 'completar',
  clasificar: 'clasificar',
  responder: 'responder lo que te piden',
  revisar: 'revisar',
};

/**
 * Un pedido solo se ofrece a quien puede actuar sobre el: `Clasificar` a aduana/admin; `Completar` y
 * `Responder` (la aduana necesita un dato del area y lo dice en el mensaje) a solicitante/admin; `Revisar` a
 * cualquiera que pueda escribir algun campo. El lector no recibe asignaciones.
 */
export function pedidosPermitidos(rol: Rol): Pedido[] {
  switch (rol) {
    case 'admin':
    case 'supervisor':
      return ['completar', 'clasificar', 'responder', 'revisar'];
    case 'solicitante':
      return ['completar', 'responder', 'revisar'];
    case 'aduana':
      return ['clasificar', 'revisar'];
    case 'lector':
      return [];
  }
}

export function pedidoPorDefecto(rol: Rol): Pedido {
  return rol === 'aduana' ? 'clasificar' : 'completar';
}

export function pedidoCompatible(rol: Rol, pedido: Pedido): boolean {
  return pedidosPermitidos(rol).includes(pedido);
}

/** Puede recibir una asignacion (no es lector). */
export function puedeRecibirAsignacion(rol: Rol): boolean {
  return rol !== 'lector';
}

// ---- Partes de la ficha que se dejan pendientes ("Pendiente de Edward: Detalle") ---------------------------------

/** Una parte de la ficha: las tres secciones del area y el bloque de la aduana. */
export type ParteFicha = Seccion | 'aduana';

export const ETIQUETA_PARTE: Record<ParteFicha, string> = { ...ETIQUETA_SECCION, aduana: 'Datos de la aduana' };

/** Lee `asignacion.secciones` («producto,detalle»); lo desconocido se ignora y el orden es el de la ficha. */
export function parsearSecciones(texto: string | null | undefined): Seccion[] {
  if (!texto) return [];
  const pedidas = new Set(texto.split(',').map((s) => s.trim()));
  return SECCIONES.filter((s) => pedidas.has(s));
}

/**
 * Las secciones que una asignacion cubre de verdad. Pais de origen, fabricante y proveedor pasaron de Detalle a Producto
 * (reunion 2026-11-09): quien tenia pendiente Detalle sigue cubriendo tambien Producto, para que esos tres campos no
 * queden sin dueno en las asignaciones ya hechas. Se resuelve al leer; no se reescribe nada.
 */
export function seccionesCubiertas(texto: string | null | undefined): Seccion[] {
  const elegidas = parsearSecciones(texto);
  return elegidas.includes('detalle') && !elegidas.includes('producto') ? ['producto', ...elegidas] : elegidas;
}

/** Lo que se guarda: nulo si no se eligio nada o se eligieron las tres (= toda su parte). */
export function textoDeSecciones(lista: readonly Seccion[]): string | null {
  const unicas = SECCIONES.filter((s) => lista.includes(s));
  return unicas.length === 0 || unicas.length === SECCIONES.length ? null : unicas.join(',');
}

/** Partes que tiene pendientes una persona segun su asignacion: la aduana siempre su bloque; el area, las elegidas o las tres. */
export function partesDeAsignacion(secciones: string | null | undefined, rolDestino: Rol): ParteFicha[] {
  if (rolDestino === 'aduana') return ['aduana'];
  const elegidas = seccionesCubiertas(secciones);
  return elegidas.length > 0 ? elegidas : [...SECCIONES];
}

/** «Detalle y Especificaciones» / «Producto, Detalle y Especificaciones». */
export function listaHumana(textos: readonly string[]): string {
  if (textos.length <= 1) return textos[0] ?? '';
  return `${textos.slice(0, -1).join(', ')} y ${textos[textos.length - 1]}`;
}

// ---- Maquina de estados de la asignacion (8.3) -----------------------------------------------------

export const ESTADOS_ASIGNACION = ['pendiente', 'en_curso', 'hecha', 'reasignada', 'cancelada'] as const;
export type EstadoAsignacion = (typeof ESTADOS_ASIGNACION)[number];

export type EventoAsignacion = 'abrir' | 'terminar' | 'cancelar' | 'reasignar';

const TRANSICIONES: Record<EventoAsignacion, Partial<Record<EstadoAsignacion, EstadoAsignacion>>> = {
  abrir: { pendiente: 'en_curso' },
  terminar: { pendiente: 'hecha', en_curso: 'hecha' },
  cancelar: { pendiente: 'cancelada', en_curso: 'cancelada' },
  reasignar: { pendiente: 'reasignada', en_curso: 'reasignada' },
};

export class TransicionAsignacionInvalida extends Error {
  constructor(
    readonly estado: EstadoAsignacion,
    readonly evento: EventoAsignacion,
  ) {
    super(`Transicion de asignacion invalida: ${evento} desde ${estado}`);
  }
}

export function puedeTransicionarAsignacion(estado: EstadoAsignacion, evento: EventoAsignacion): boolean {
  return TRANSICIONES[evento][estado] !== undefined;
}

export function transicionarAsignacion(estado: EstadoAsignacion, evento: EventoAsignacion): EstadoAsignacion {
  const siguiente = TRANSICIONES[evento][estado];
  if (!siguiente) throw new TransicionAsignacionInvalida(estado, evento);
  return siguiente;
}

export function esAsignacionActiva(estado: string): boolean {
  return estado === 'pendiente' || estado === 'en_curso';
}

// ---- Fechas y tiempo ----------------------------------------------------------------------------------

/** Inicio (00:00 en America/Bogota, UTC-5 sin horario de verano) del dia calendario de `ahora`. */
export function inicioDiaBogota(ahora: Date): Date {
  const bogota = new Date(ahora.getTime() - 5 * 3_600_000);
  return new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), 5, 0, 0, 0));
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const;

/** «ahora mismo», «hace 5 min», «hace 2 h», «ayer», «hace 3 días», «12 oct». */
export function tiempoRelativo(desde: Date | string, ahora: Date = new Date()): string {
  const d = typeof desde === 'string' ? new Date(desde) : desde;
  const seg = Math.floor((ahora.getTime() - d.getTime()) / 1000);
  if (seg < 45) return 'ahora mismo';
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 14) return `hace ${dias} días`;
  const bogota = new Date(d.getTime() - 5 * 3_600_000);
  return `${bogota.getUTCDate()} ${MESES[bogota.getUTCMonth()]}`;
}

/** «1 día», «5 días». */
export function textoDias(n: number): string {
  return n === 1 ? '1 día' : `${n} días`;
}

/** Texto plural simple: `plural(3, 'referencia', 'referencias')`. */
export function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

// ---- Enlaces ------------------------------------------------------------------------------------------

/** Enlace directo a una ficha. Solo lleva el UUID (opaco): ningun dato de la mercancia (D-23). */
export function enlaceReferencia(appUrl: string, referenciaId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/referencias/${referenciaId}`;
}

export function enlaceInicio(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/`;
}

/** Nombre para mostrar y para frases: sin la marca [DESARROLLO] de los usuarios de prueba. */
/** Avisos ya guardados con el nombre de un usuario de prueba: quita solo la marca exacta, no otros corchetes. */
export function tituloSinMarca(titulo: string): string {
  return titulo.replaceAll(' [DESARROLLO]', '');
}

export function nombreSinMarca(nombre: string): string {
  return nombre.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim() || nombre;
}
