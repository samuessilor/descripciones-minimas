/**
 * Informe de la importacion del historico (Excel): lo que se cargaria o se cargo, y fila por fila lo que hay que corregir.
 * Los numeros de fila son los de la hoja `Referencias` del archivo, para ir directo a la celda.
 */
import ExcelJS from 'exceljs';
import type { PlanImportacion } from './historico';
import type { LibroLeido } from './leer-libro';

const ETIQUETA_CATALOGO: Record<string, string> = { unidad_medida: 'Unidad de medida', aspecto_fisico: 'Aspecto físico' };

export function resumenEnTexto(plan: PlanImportacion, libro: LibroLeido): string[] {
  const l: string[] = [
    `Filas con datos en «${libro.hoja}»: ${libro.filas.length}`,
    `  Listas para cargar:           ${plan.validas.length}`,
    `  Con errores (no se cargan):   ${plan.rechazadas.length}`,
    `  Ya estaban en la plataforma:  ${plan.yaExisten.length}`,
    `  Repetidas en el archivo:      ${plan.repetidas.length}`,
    `  Listas pero incompletas:      ${plan.avisos.filter((a) => a.avisos.some((x) => x.startsWith('Le faltan'))).length} (avisos, no bloquean)`,
    `  Partidas nuevas para el catálogo: ${plan.partidasNuevas.length}`,
  ];
  if (libro.columnasIgnoradas.length > 0) l.push(`Columnas que no se usan (se ignoran): ${[...new Set(libro.columnasIgnoradas)].join(', ')}`);
  if (libro.columnasRepetidas.length > 0) l.push(`Columnas repetidas (se usa la primera): ${[...new Set(libro.columnasRepetidas)].join(', ')}`);
  return l;
}

function hojaConTabla(libro: ExcelJS.Workbook, nombre: string, columnas: Array<{ titulo: string; ancho: number }>, filas: Array<Array<string | number>>): void {
  const h = libro.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
  h.columns = columnas.map((c) => ({ header: c.titulo, width: c.ancho }));
  h.getRow(1).font = { bold: true };
  h.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F6' } };
  for (const f of filas) h.addRow(f).alignment = { vertical: 'top', wrapText: true };
}

export async function crearInforme(plan: PlanImportacion, lectura: LibroLeido, aplicada: boolean): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Descripciones mínimas';
  hojaConTabla(
    libro,
    'Resumen',
    [{ titulo: 'Importación del histórico', ancho: 90 }],
    [
      [aplicada ? 'CARGA REALIZADA' : 'PRUEBA EN SECO: no se escribió nada en la plataforma'],
      ...resumenEnTexto(plan, lectura).map((t) => [t]),
    ],
  );
  hojaConTabla(
    libro,
    'Con errores',
    [{ titulo: 'Fila', ancho: 8 }, { titulo: 'Código', ancho: 20 }, { titulo: 'Qué corregir', ancho: 110 }],
    plan.rechazadas.map((r) => [r.fila, r.codigo ?? '', r.errores.join('\n')]),
  );
  hojaConTabla(
    libro,
    'Valores por agregar',
    [{ titulo: 'Lista', ancho: 20 }, { titulo: 'Valor escrito', ancho: 30 }, { titulo: 'Filas que lo usan', ancho: 18 }],
    plan.valoresDesconocidos.map((v) => [ETIQUETA_CATALOGO[v.catalogo] ?? v.catalogo, v.valor, v.filas]),
  );
  hojaConTabla(
    libro,
    'Omitidas',
    [{ titulo: 'Fila', ancho: 8 }, { titulo: 'Código', ancho: 20 }, { titulo: 'Motivo', ancho: 70 }],
    [
      ...plan.yaExisten.map((r) => [r.fila, r.codigo, 'Ya está en la plataforma: no se toca.']),
      ...plan.repetidas.map((r) => [r.fila, r.codigo, `Repetida: el mismo código está en la fila ${r.primeraEn}.`]),
    ],
  );
  hojaConTabla(
    libro,
    'Avisos',
    [{ titulo: 'Fila', ancho: 8 }, { titulo: 'Código', ancho: 20 }, { titulo: 'Aviso', ancho: 110 }],
    plan.avisos.map((a) => [a.fila, a.codigo, a.avisos.join('\n')]),
  );
  hojaConTabla(
    libro,
    'Partidas nuevas',
    [{ titulo: 'Partida', ancho: 20 }],
    plan.partidasNuevas.map((p) => [p]),
  );
  return Buffer.from(await libro.xlsx.writeBuffer());
}
