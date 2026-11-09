/**
 * Normalizaciones puras de texto (D-18, D-27). Sin dependencias de Next ni de la base.
 */

/**
 * Codigo normalizado (`codigo_norm`, D-27): mayusculas y sin espacios, guiones, puntos,
 * barras, guiones bajos ni caracteres invisibles; Unicode en forma NFKC (ancho completo = ASCII).
 * El codigo se MUESTRA como se digito; esta forma solo sirve para decidir si dos codigos son la
 * misma referencia. Los ceros a la izquierda se conservan.
 */
export function normalizarCodigo(codigo: string): string {
  return codigo
    .normalize('NFKC') // ancho completo -> ASCII; guiones y espacios de compatibilidad -> sus formas basicas
    .toUpperCase()
    .replace(SEPARADORES_CODIGO, '');
}

/**
 * Lo que NO identifica a una referencia: cualquier espacio (\p{Z}, \s), caracter de control (\p{Cc}), de
 * formato o invisible (\p{Cf}: ancho cero, guion blando, BOM, word joiner), cualquier guion Unicode (\p{Pd}),
 * el signo menos y los puntos medios, mas `. _ / \` y el guion ASCII. Son los restos habituales al pegar desde
 * Excel o la web; si quedaran, el indice unico dejaria pasar el mismo codigo dos veces.
 */
const SEPARADORES_CODIGO = /[\p{Z}\p{Cc}\p{Cf}\p{Pd}\s−·•‧∙⋅._/\\-]+/gu;

/**
 * Quita lo que Postgres no admite en `text` y `jsonb`: U+0000 se elimina y los sustitutos UTF-16 sueltos
 * (mitades de un par que llegaron sin la otra) se reemplazan por U+FFFD. Asi una entrada rara nunca llega a
 * la base como un error 500 (`22021`, `22P02`): o se limpia o la validacion la rechaza.
 */
export function limpiarCaracteres(texto: string): string {
  return texto.replace(/\u0000/g, '').toWellFormed();
}

/**
 * Motivo ya limpio, o `null` si no tiene ningun caracter visible. Los espacios, controles y caracteres de
 * formato (`\p{Cf}`: ancho cero, guion blando, marcas de direccion) no cuentan como texto: un motivo hecho
 * solo de eso no justifica pisar el valor de otra persona (SPEC 9.3). Los invisibles de los bordes se quitan.
 */
export function motivoVisible(motivo: string | null | undefined): string | null {
  if (!motivo) return null;
  const limpio = limpiarCaracteres(motivo).replace(/^[\p{Z}\p{Cc}\p{Cf}\s]+|[\p{Z}\p{Cc}\p{Cf}\s]+$/gu, '');
  return limpio === '' ? null : limpio;
}

/** Texto de busqueda: minusculas, sin tildes, espacios colapsados. */
export function normalizarTexto(texto: string | null | undefined): string {
  if (!texto) return '';
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escapa `\`, `%` y `_` para usarlos como literales dentro de un `LIKE ... ESCAPE '\'`. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Tokens normalizados de una consulta de busqueda (se combinan con AND). */
export function tokenizarBusqueda(consulta: string): string[] {
  const n = normalizarTexto(consulta);
  return n === '' ? [] : n.split(' ');
}
