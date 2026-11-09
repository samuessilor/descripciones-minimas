/**
 * Neutralizacion de formulas en Excel (SPEC 13.4): los textos de la ficha los escriben personas, incluidas las de
 * agencias externas, asi que una celda que EMPIECE por `=`, `+`, `-` o `@` (o por tabulacion / retorno, que algunos
 * programas recortan antes de interpretar) no debe llegar al libro como algo ejecutable.
 *
 * La exportacion NUNCA escribe formulas: toda cadena va como texto (tipo cadena del libro) y, si podria leerse como
 * formula, ademas con formato de texto (`@`). Este modulo es PURO (sin ExcelJS) para poder probarlo aislado.
 */

const INICIO_PELIGROSO = /^[\s​-‍﻿]*[=+\-@\t\r]/u;

/** `true` si un programa de hojas de calculo podria interpretar el texto como formula. */
export function podriaSerFormula(texto: string): boolean {
  return INICIO_PELIGROSO.test(texto);
}

export interface CeldaTexto {
  /** Contenido tal cual lo escribio la persona (nunca se le antepone nada: el dato no se altera). */
  texto: string;
  /** Aplicar formato de texto (`@`) a la celda: Excel no la evalua aunque se edite despues. */
  formatoTexto: boolean;
}

/** Caracteres que no caben en XML 1.0 (se permiten tabulacion, salto de linea y retorno). */
const NO_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Prepara una cadena para una celda: sin formulas y sin caracteres de control que rompan el XML. */
export function prepararTexto(valor: string): CeldaTexto {
  const limpio = valor.replace(NO_XML, '');
  return { texto: limpio, formatoTexto: podriaSerFormula(limpio) };
}

/** Excel limita una celda a 32.767 caracteres. */
export const MAX_CELDA = 32_000;

export function recortarCelda(texto: string): string {
  return texto.length > MAX_CELDA ? `${texto.slice(0, MAX_CELDA - 1)}…` : texto;
}
