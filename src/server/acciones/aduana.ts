/**
 * Lado aduana (SPEC 8.1, 9, 10.2, 12.4) -- STUBS tipados del hito H4 (y H2/H5 donde se indica).
 * El dominio puro que estas acciones usan YA existe y esta probado: `evaluarCierre`,
 * `transicionar`, `diasPausaAlReabrir`, `calcularCompletitud`.
 */
import type { Contexto } from '../politicas/actor';
import { noImplementado } from './resultado';

// ---- Cierre y ciclo de vida de la ficha (H4: implementado en ./cierre) -------------------------------

export { archivar, desarchivar, finalizar, reabrir, solicitarReapertura } from './cierre';
export type { EntradaFinalizar, EntradaMotivo, ResultadoFinalizar } from './cierre';

export async function corregirCodigo(
  _ctx: Contexto,
  _entrada: { referenciaId: string; codigoNuevo: string; motivo: string },
): Promise<{ ok: true }> {
  // TODO(H2): creador mientras no CLASIFICADA, o admin; verifica duplicado, reindexa, historial.
  // Se escribe con aplicarEscritura(campo 'codigo'); la violacion del indice unico es DUPLICADO. CA-34.
  return noImplementado('H2', 'corregirCodigo');
}

// H5: «Retirar acceso a [agencia]» (8.3 regla 10) vive en ./organizaciones.
export { retirarAccesoAgencia } from './organizaciones';

// ---- Partida arancelaria (las descripciones minimas y las restricciones son campos de texto: guardarCampo) ----

export { fijarPartida, infoDePartida } from './partida';
export type { InfoPartida, ResultadoFijarPartida } from './partida';

// ---- Adjuntos, busqueda, exportacion ---------------------------------------------------------------

export async function subirAdjunto(
  _ctx: Contexto,
  _entrada: { referenciaId: string; archivo: Uint8Array; nombre: string },
): Promise<{ id: string }> {
  // TODO(H2): 13.5 -- lista blanca, magic bytes, sharp.rotate() primero, 4 MB, maximo 5 fotos.
  return noImplementado('H2', 'subirAdjunto');
}

export async function retirarAdjunto(_ctx: Contexto, _entrada: { adjuntoId: string; motivo: string }): Promise<{ ok: true }> {
  // TODO(H2): se retira con motivo; la foto de otro no se quita.
  return noImplementado('H2', 'retirarAdjunto');
}

export interface ResultadoBusqueda {
  id: string;
  codigo: string;
  nombreProducto: string;
  estado: string;
}

export async function buscar(_ctx: Contexto, _entrada: { q: string }): Promise<ResultadoBusqueda[]> {
  // TODO(H2): tokens AND con LIKE ... ESCAPE '\' sobre texto_busqueda, maximo 8, solo lo visible (D-18).
  return noImplementado('H2', 'buscar');
}

// La exportacion a Excel vive en `src/server/exportar` (H4).
export { exportarBase } from '../exportar';
