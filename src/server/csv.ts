/**
 * CSV seguro (13.4): las celdas que empiezan por `=`, `+`, `-`, `@`, tabulador o retorno se neutralizan con una
 * comilla simple delante, asi una hoja de calculo nunca las interpreta como formula. Los textos que escriben
 * los externos llegan a la auditoria, de modo que esto no es opcional.
 */
const PELIGROSAS = /^[=+\-@\t\r]/;

export function neutralizarFormula(valor: string): string {
  return PELIGROSAS.test(valor) ? `'${valor}` : valor;
}

export function celdaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number' && Number.isFinite(valor)) return String(valor);
  const texto = typeof valor === 'string' ? valor : typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  const seguro = neutralizarFormula(texto);
  return /[",\n\r;]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** Una fila por linea, `\r\n` y BOM al inicio para que Excel abra bien las tildes. */
export function aCsv(encabezados: readonly string[], filas: ReadonlyArray<readonly unknown[]>): string {
  const lineas = [encabezados.map(celdaCsv).join(','), ...filas.map((f) => f.map(celdaCsv).join(','))];
  return `﻿${lineas.join('\r\n')}\r\n`;
}
