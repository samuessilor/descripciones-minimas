/**
 * Semaforo por seccion y global (8.2, D-13, D-26). Funcion pura sobre la matriz de campos.
 *
 * Una seccion es VERDE si todos sus campos `O` DEL GRUPO CLIENTE que aplican a la ficha tienen valor valido (la marca
 * «No aplica», «No tiene marca» o «El proveedor es el mismo fabricante» cuentan como valor; el contenido por
 * empaque solo se pide con bidon o paquete). Los `O` del grupo aduana (partida, RIM, descripciones minimas adicionales,
 * restricciones, observaciones y clasificacion finalizada) no entran: se cuentan en "De la aduana", igual que la respuesta del area a
 * una solicitud de la aduana mientras este pendiente. Mientras `clasificacion_finalizada` sea `NO`, Especificaciones se
 * muestra amarilla ("La aduana pidió más información").
 *
 * Todo sale de los valores vigentes: borrar un valor, desmarcar «No aplica» o elegir bidon o paquete sin contenido lo
 * vuelve a dejar pendiente en el mismo calculo que usan la ficha, el tablero, el listado, la bandeja y el Excel.
 */
import { SECCIONES, camposObligatoriosAduana, camposObligatoriosCliente, type Seccion, type TipoProducto } from './campos';
import { estaVacio } from './valores';

export type ColorSeccion = 'verde' | 'amarillo';

export interface EntradaCompletitud {
  tipo: TipoProducto;
  /** Valor vigente de cada campo por clave (null/ausente = vacio). */
  valores: Record<string, unknown>;
}

export interface ResumenSeccion {
  estado: ColorSeccion;
  faltan: number;
  total: number;
  /** Claves de los campos que faltan. */
  faltantes: string[];
  texto: string;
}

export interface Completitud {
  secciones: Record<Seccion, ResumenSeccion>;
  /** Contador "Del area" (lo que llena el cliente). */
  area: { faltan: number; total: number; completo: boolean };
  /**
   * Contador "De la aduana". `completo` = partida, descripciones minimas adicionales (y su respuesta, si hubo
   * solicitud), restricciones, observaciones y clasificacion finalizada con valor: la parte de la aduana queda verde.
   */
  aduana: { faltan: number; total: number; faltantes: string[]; completo: boolean };
  tresSeccionesVerdes: boolean;
  finalizada: 'SI' | 'NO' | null;
}

function textoSeccion(faltan: number): string {
  return faltan === 0 ? 'Completa' : faltan === 1 ? 'Falta 1' : `Faltan ${faltan}`;
}

/** Texto de la solicitud de la aduana (vacio si no hay o si marco «No es necesario por ahora / no aplica»). */
export function textoSolicitudAduana(valores: Record<string, unknown>): string {
  const v = valores.descripciones_minimas;
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Hay una solicitud de la aduana sin respuesta del area: no hay respuesta, o la respuesta contesta un texto anterior
 * de la solicitud (la aduana la cambio despues). La respuesta guarda la solicitud que contesto (`sobre`).
 */
export function solicitudSinRespuesta(valores: Record<string, unknown>): boolean {
  const solicitud = textoSolicitudAduana(valores);
  if (solicitud === '') return false;
  const r = valores.respuesta_area as { texto?: unknown; sobre?: unknown } | null | undefined;
  if (!r || typeof r !== 'object' || typeof r.texto !== 'string' || r.texto.trim() === '') return true;
  return typeof r.sobre !== 'string' || r.sobre.trim() !== solicitud;
}

export function calcularCompletitud({ tipo, valores }: EntradaCompletitud): Completitud {
  const finalizadaCruda = valores.clasificacion_finalizada;
  const finalizada: 'SI' | 'NO' | null = finalizadaCruda === 'SI' || finalizadaCruda === 'NO' ? finalizadaCruda : null;

  const secciones = {} as Record<Seccion, ResumenSeccion>;
  let faltanArea = 0;
  let totalArea = 0;

  for (const seccion of SECCIONES) {
    const requeridos = camposObligatoriosCliente(tipo, seccion, valores);
    const faltantes = requeridos.filter((c) => estaVacio(valores[c.clave])).map((c) => c.clave);
    const total = requeridos.length;
    const faltan = faltantes.length;
    faltanArea += faltan;
    totalArea += total;

    let estado: ColorSeccion = faltan === 0 ? 'verde' : 'amarillo';
    let texto = textoSeccion(faltan);
    if (seccion === 'especificaciones' && finalizada === 'NO') {
      estado = 'amarillo';
      texto = 'La aduana pidió más información';
    }
    secciones[seccion] = { estado, faltan, total, faltantes, texto };
  }

  const obligatoriosAduana = camposObligatoriosAduana(tipo);
  // `NO` es un valor, pero no es una clasificacion finalizada: la parte de la aduana sigue pendiente.
  // La respuesta del area solo se pide si la aduana escribio una solicitud; mientras falte, la parte sigue amarilla.
  const hayRespuestaPedida = textoSolicitudAduana(valores) !== '';
  const sinRespuesta = solicitudSinRespuesta(valores);
  const faltantesAduana: string[] = [];
  for (const c of obligatoriosAduana) {
    if (c.clave === 'clasificacion_finalizada' ? finalizada !== 'SI' : estaVacio(valores[c.clave])) faltantesAduana.push(c.clave);
    if (c.clave === 'descripciones_minimas' && sinRespuesta) faltantesAduana.push('respuesta_area');
  }
  const totalAduana = obligatoriosAduana.length + (hayRespuestaPedida ? 1 : 0);

  return {
    secciones,
    area: { faltan: faltanArea, total: totalArea, completo: faltanArea === 0 },
    aduana: {
      faltan: faltantesAduana.length,
      total: totalAduana,
      faltantes: faltantesAduana,
      completo: faltantesAduana.length === 0,
    },
    tresSeccionesVerdes: SECCIONES.every((s) => secciones[s].estado === 'verde'),
    finalizada,
  };
}
