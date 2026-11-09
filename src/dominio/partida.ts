/** Partida arancelaria con formato `NNNN.NN.NN.NN` (Apendice A, fila 23 de la matriz). */

const PARTIDA_REGEX = /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/;

export function esPartidaValida(valor: string): boolean {
  return PARTIDA_REGEX.test(valor);
}

/** Mascara progresiva: deja solo digitos (maximo 10) y coloca los puntos en 4.2.2.2. */
export function formatearPartida(entrada: string): string {
  const d = entrada.replace(/\D/g, '').slice(0, 10);
  const partes = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), d.slice(8, 10)].filter((p) => p !== '');
  return partes.join('.');
}

/** Lo unico que puede acompanar a los digitos al pegar o escribir una partida. */
const SOLO_DIGITOS_Y_SEPARADORES = /^[\d.\-\s]+$/;

/**
 * Devuelve la partida completa en formato canonico, o `null` si no son exactamente 10 digitos o si hay algo
 * distinto de digitos, puntos, guiones y espacios (la mascara de la interfaz es la que descarta letras al teclear).
 */
export function normalizarPartida(entrada: string): string | null {
  const limpia = entrada.trim();
  if (!SOLO_DIGITOS_Y_SEPARADORES.test(limpia)) return null;
  const soloDigitos = limpia.replace(/\D/g, '');
  if (soloDigitos.length !== 10) return null;
  const f = formatearPartida(soloDigitos);
  return esPartidaValida(f) ? f : null;
}
