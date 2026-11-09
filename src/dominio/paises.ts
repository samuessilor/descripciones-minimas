import { normalizarTexto } from './normalizacion';

/**
 * Paises: lista ISO 3166-1 alfa-2 completa; los nombres salen de `Intl.DisplayNames('es')`
 * (SPEC 6.2). Se guarda el codigo ISO2. "No se conoce" es un valor aparte (S-19).
 */
export const CODIGOS_PAIS: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ ' +
  'BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ ' +
  'DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY ' +
  'HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY ' +
  'MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ ' +
  'NA NC NE NF NG NI NL NO NP NR NU NZ OM ' +
  'PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ ' +
  'TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ ' +
  'VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

export const PAIS_NO_SE_CONOCE = 'NO_SE_CONOCE';

const nombres = new Intl.DisplayNames(['es-CO', 'es'], { type: 'region' });
const CONJUNTO = new Set(CODIGOS_PAIS);

export interface Pais {
  codigo: string;
  nombre: string;
}

export function esCodigoPais(codigo: string): boolean {
  return CONJUNTO.has(codigo);
}

export function nombrePais(codigo: string): string {
  if (codigo === PAIS_NO_SE_CONOCE) return 'No se conoce';
  return nombres.of(codigo) ?? codigo;
}

/**
 * Los que mas se piden como origen: lo que ofrece la ficha al escribir. Las demas referencias con otro
 * pais ya guardado se siguen mostrando (`nombrePais` conoce todos); `listarPaises` es la lista completa.
 * Los cinco primeros van arriba del desplegable.
 */
export const CODIGOS_PAIS_FRECUENTES: readonly string[] = (
  'TH CN BR FR US ' +
  'DE JP MX IT GB IN KR TW VN MY SG ES NL CH CA AR CL PE EC CO HK PH ID IE BE AT PL TR'
).split(' ');

export function listarPaisesFrecuentes(): Pais[] {
  return CODIGOS_PAIS_FRECUENTES.map((codigo) => ({ codigo, nombre: nombrePais(codigo) }));
}

let cache: Pais[] | null = null;

/** Lista ordenada por nombre en espanol. */
export function listarPaises(): Pais[] {
  cache ??= CODIGOS_PAIS.map((codigo) => ({ codigo, nombre: nombrePais(codigo) })).sort((a, b) =>
    a.nombre.localeCompare(b.nombre, 'es'),
  );
  return cache;
}

/** Sugerencias al escribir: primero los que empiezan por el texto, luego los que lo contienen. */
export function sugerirPaises(texto: string): Pais[] {
  const q = normalizarTexto(texto);
  const todos = listarPaises();
  if (q === '') return todos;
  const empieza: Pais[] = [];
  const contiene: Pais[] = [];
  for (const p of todos) {
    const n = normalizarTexto(p.nombre);
    if (n.startsWith(q)) empieza.push(p);
    else if (n.includes(q)) contiene.push(p);
  }
  return [...empieza, ...contiene];
}
