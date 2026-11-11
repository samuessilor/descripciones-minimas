/**
 * Maquina de estados de la ficha (8.1, D-25) y reglas de cierre (D-26). Dominio puro.
 *
 * Se persisten TRES estados de ciclo de vida (+ la marca `archivada_en`). El color sale solo del
 * estado: verde si y solo si CLASIFICADA; amarillo en cualquier otro (C-12, C-13). No hay tercer color.
 */
import { esPartidaValida } from './partida';
import { esGestor, type Rol } from './permisos';

export const ESTADOS_FICHA = ['BORRADOR', 'EN_GESTION', 'CLASIFICADA'] as const;
export type EstadoFicha = (typeof ESTADOS_FICHA)[number];

export type EventoFicha = 'primer_envio' | 'cerrar' | 'reabrir';

const TRANSICIONES: Record<EventoFicha, Partial<Record<EstadoFicha, EstadoFicha>>> = {
  // El primer "Enviar a" saca la ficha de borrador; enviar a otra persona la mantiene en gestion.
  primer_envio: { BORRADOR: 'EN_GESTION', EN_GESTION: 'EN_GESTION' },
  cerrar: { EN_GESTION: 'CLASIFICADA' },
  reabrir: { CLASIFICADA: 'EN_GESTION' },
};

export class TransicionInvalida extends Error {
  constructor(
    readonly estado: EstadoFicha,
    readonly evento: EventoFicha,
  ) {
    super(`Transicion invalida: ${evento} desde ${estado}`);
  }
}

export function transicionar(estado: EstadoFicha, evento: EventoFicha): EstadoFicha {
  const siguiente = TRANSICIONES[evento][estado];
  if (!siguiente) throw new TransicionInvalida(estado, evento);
  return siguiente;
}

export function puedeTransicionar(estado: EstadoFicha, evento: EventoFicha): boolean {
  return TRANSICIONES[evento][estado] !== undefined;
}

export type ColorFicha = 'verde' | 'amarillo';

export function colorFicha(estado: EstadoFicha): ColorFicha {
  return estado === 'CLASIFICADA' ? 'verde' : 'amarillo';
}

export type EtiquetaFicha =
  | 'Archivada'
  | 'Borrador'
  | 'Clasificada'
  | 'Reabierta'
  | 'Pendiente de información'
  | 'En espera de clasificación'
  | 'En gestión';

export interface EntradaEtiqueta {
  estado: EstadoFicha;
  archivada: boolean;
  /** Hay un evento de reapertura posterior a la ultima clasificacion. */
  reabierta: boolean;
  finalizada: 'SI' | 'NO' | null;
  tresSeccionesVerdes: boolean;
  /** La aduana pidio informacion adicional y el area no ha respondido (A2). */
  esperaRespuesta?: boolean;
}

/** Etiqueta derivada que se muestra junto al color (nunca como color). Orden de 8.1. */
export function etiquetaFicha(e: EntradaEtiqueta): EtiquetaFicha {
  if (e.archivada) return 'Archivada';
  if (e.estado === 'BORRADOR') return 'Borrador';
  if (e.estado === 'CLASIFICADA') return 'Clasificada';
  if (e.reabierta) return 'Reabierta';
  if (e.finalizada === 'NO') return 'Pendiente de información';
  if (e.esperaRespuesta) return 'Pendiente de información';
  if (e.tresSeccionesVerdes && e.finalizada === null) return 'En espera de clasificación';
  return 'En gestión';
}

// ---- Cierre de la clasificacion --------------------------------------------------------------

export type ModoCierre = 'advertir' | 'bloquear';
export type ReglaCierre = 'G1' | 'G6' | 'A1' | 'A2' | 'A3';

export interface EntradaCierre {
  rol: Rol;
  /** La ficha es visible para quien intenta cerrar (G6). */
  fichaVisible: boolean;
  partida: string | null;
  /** Claves de campos `O` del grupo cliente que faltan (A1). */
  camposAreaFaltantes: string[];
  /** Las descripciones minimas adicionales estan vacias: ni solicitud ni «No aplica» (A2). */
  descripcionesVacias: boolean;
  restriccionesVacias: boolean;
  /** Las observaciones de la aduana estan vacias: ni texto ni «No aplica» (A3). */
  observacionesVacias?: boolean;
  /** Falta elegir el arancel o el IVA de la partida (A3). */
  arancelIvaVacios?: boolean;
  modo: ModoCierre;
}

export interface Aviso {
  regla: ReglaCierre;
  mensaje: string;
  detalle: string[];
}

export type ResultadoCierre =
  | { ok: true; advertencias: Aviso[]; requiereMotivo: boolean }
  | { ok: false; bloqueos: Aviso[] };

/**
 * G1 y G6 son duras (C-13, permiso). A1-A3 advierten ("Cerrar de todos modos" con motivo) salvo
 * que `CIERRE_MODO=bloquear`, caso en que pasan a ser duras. (A4, el primer clasificador por defecto, se retiro con
 * los clasificadores.)
 */
export function evaluarCierre(e: EntradaCierre): ResultadoCierre {
  const bloqueos: Aviso[] = [];

  if (!(e.rol === 'aduana' || esGestor(e.rol)) || !e.fichaVisible) {
    bloqueos.push({
      regla: 'G6',
      mensaje: 'Solo la aduana, un administrador o la supervisora general pueden cerrar la clasificación.',
      detalle: [],
    });
  }
  if (!e.partida || !esPartidaValida(e.partida)) {
    bloqueos.push({
      regla: 'G1',
      mensaje: 'Falta la partida arancelaria (formato 0000.00.00.00).',
      detalle: [],
    });
  }

  const advertencias: Aviso[] = [];
  if (e.camposAreaFaltantes.length > 0) {
    const n = e.camposAreaFaltantes.length;
    advertencias.push({
      regla: 'A1',
      mensaje: `Faltan ${n} ${n === 1 ? 'campo' : 'campos'} del área`,
      detalle: e.camposAreaFaltantes,
    });
  }
  if (e.descripcionesVacias) {
    advertencias.push({ regla: 'A2', mensaje: 'Las descripciones mínimas adicionales están vacías', detalle: [] });
  }
  if (e.restriccionesVacias) {
    advertencias.push({ regla: 'A3', mensaje: 'Las restricciones están vacías', detalle: [] });
  }
  if (e.observacionesVacias) {
    advertencias.push({ regla: 'A3', mensaje: 'Las observaciones de la aduana están vacías', detalle: [] });
  }
  if (e.arancelIvaVacios) {
    advertencias.push({ regla: 'A3', mensaje: 'Falta elegir el arancel o el IVA', detalle: [] });
  }

  if (e.modo === 'bloquear') bloqueos.push(...advertencias);
  if (bloqueos.length > 0) return { ok: false, bloqueos };
  return { ok: true, advertencias, requiereMotivo: advertencias.length > 0 };
}
