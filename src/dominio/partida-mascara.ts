/**
 * Mascara progresiva de la partida arancelaria (SPEC 7 fila 23): `NNNN.NN.NN.NN`. Pura, para poder probarla.
 *
 * Mientras la persona escribe hacia adelante, el punto aparece solo cuando se completa un grupo (`8421` -> `8421.`);
 * al borrar nunca se vuelve a poner, asi el punto se puede quitar con la tecla de borrar sin pelear con la mascara.
 * Acepta pegar con otros separadores (`8421-39-90-00`, `8421 39 90 00`) y descarta las letras.
 */
import { formatearPartida } from './partida';

const FINES_DE_GRUPO = new Set([4, 6, 8]);

export function mascaraPartida(nuevo: string, previo: string): string {
  const digitos = nuevo.replace(/\D/g, '').slice(0, 10);
  const formateada = formatearPartida(digitos);
  const creciendo = nuevo.length > previo.length;
  if (creciendo && FINES_DE_GRUPO.has(digitos.length) && !formateada.endsWith('.')) return `${formateada}.`;
  return formateada;
}

/** Cuantos digitos faltan para una partida completa (para el mensaje de ayuda). */
export function digitosQueFaltan(valor: string): number {
  return Math.max(0, 10 - valor.replace(/\D/g, '').length);
}
