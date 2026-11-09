/**
 * Escritura del libro de Excel en STREAMING (SPEC 15.1): la memoria no crece con las filas. Hojas, en este orden:
 * `Base` (con la columna «Descripciones mínimas» entre la partida y las restricciones, como en el F-ADI-30),
 * `Resumen de estado` (estado, dias en gestion, que tan completa va cada parte y de quien falta), `Historial` (cada
 * cambio de campo; ver `historial.ts`) y `Leyenda`. Reglas: sin formulas, fila de encabezado congelada y con
 * autofiltro, ajuste de texto, fuente Arial, codigo y partida con formato Texto, fechas reales, y el color de la
 * columna Estado ACOMPANADO del texto ("Pendiente" / "Clasificada").
 *
 * Un libro en streaming escribe una hoja a la vez: `Base` se escribe lote a lote y, de paso, se guarda lo MINIMO de
 * cada fila para `Resumen de estado` (unas 16 celdas), que se escribe despues sin volver a la base de datos.
 */
import ExcelJS from 'exceljs';
import type { Writable } from 'node:stream';
import { COLUMNAS_BASE, COLUMNAS_HISTORIAL, COLUMNAS_RESUMEN, RELLENO_AMARILLO, RELLENO_VERDE, type ColumnaBase } from './columnas';
import type { FilaBase, ValorCelda } from './filas';
import type { HistorialExportado } from './historial';
import { prepararTexto, recortarCelda } from './neutralizar';

const FUENTE = 'Arial';
const AZUL_MARCA = 'FF0B2F6B';

export interface ResumenLeyenda {
  exportadoPor: string;
  rol: string;
  /** Texto ya formateado (hora de Bogota). */
  fecha: string;
  alcance: string;
  filtros: string[];
  filas: number;
  incluyeArchivadas: boolean;
}

type Hoja = ExcelJS.Worksheet;

function estiloEncabezado(hoja: Hoja, n: number, numeroFila = 1): void {
  const fila = hoja.getRow(numeroFila);
  for (let i = 1; i <= n; i++) {
    const c = fila.getCell(i);
    c.font = { name: FUENTE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_MARCA } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  }
  fila.height = 32;
}

/** Escribe un valor en una celda segun el tipo de la columna; nunca como formula. */
function escribirCelda(c: ExcelJS.Cell, valor: ValorCelda, col: Pick<ColumnaBase, 'tipo'>): void {
  c.font = { name: FUENTE, size: 10 };
  c.alignment = { vertical: 'top', wrapText: col.tipo === 'texto' || col.tipo === 'texto_largo' || col.tipo === 'estado' };
  if (valor === null || valor === undefined || valor === '') return;

  if (valor instanceof Date) {
    c.value = valor;
    c.numFmt = col.tipo === 'fechahora' ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd';
    c.alignment = { vertical: 'top', horizontal: 'left' };
    return;
  }
  if (typeof valor === 'number') {
    c.value = valor;
    c.numFmt = col.tipo === 'numero' && !Number.isInteger(valor) ? '#,##0.######' : '0';
    c.alignment = { vertical: 'top', horizontal: 'right' };
    return;
  }
  const { texto, formatoTexto } = prepararTexto(recortarCelda(valor));
  c.value = texto; // cadena: ExcelJS la escribe como texto, jamas como formula
  if (formatoTexto) c.numFmt = '@';
}

/** Escribe una hoja de tabla completa (encabezado en la fila 1, o en la 2 si lleva un aviso arriba; congelado y con autofiltro). */
function escribirTabla(
  libro: ExcelJS.stream.xlsx.WorkbookWriter,
  nombre: string,
  columnas: readonly ColumnaBase[],
  filas: Iterable<{ valores: Record<string, ValorCelda>; estadoColor?: 'amarillo' | 'verde' | null }>,
  opciones: { aviso?: string } = {},
): void {
  const filaEncabezado = opciones.aviso ? 2 : 1;
  const hoja = libro.addWorksheet(nombre, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: filaEncabezado, activeCell: `B${filaEncabezado + 1}` }],
    properties: { defaultRowHeight: 15 },
  });
  hoja.columns = columnas.map((c) => ({ key: c.clave, width: c.ancho }));
  if (opciones.aviso) {
    // Aviso visible arriba (p. ej. historial recortado): una celda que se lee de corrido sobre las vacias de al lado.
    const aviso = hoja.addRow([]);
    const c = aviso.getCell(1);
    c.font = { name: FUENTE, size: 10, bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELLENO_AMARILLO } };
    c.alignment = { vertical: 'middle', wrapText: false };
    c.value = prepararTexto(opciones.aviso).texto;
    aviso.height = 22;
    aviso.commit();
  }
  hoja.addRow(columnas.map((c) => c.encabezado));
  hoja.autoFilter = { from: { row: filaEncabezado, column: 1 }, to: { row: filaEncabezado, column: columnas.length } };
  estiloEncabezado(hoja, columnas.length, filaEncabezado);
  hoja.getRow(filaEncabezado).commit();

  for (const f of filas) {
    const fila = hoja.addRow([]);
    columnas.forEach((col, i) => {
      const celda = fila.getCell(i + 1);
      escribirCelda(celda, f.valores[col.clave] ?? null, col);
      if (col.tipo === 'estado') {
        celda.font = { name: FUENTE, size: 10, bold: true };
        if (f.estadoColor) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.estadoColor === 'verde' ? RELLENO_VERDE : RELLENO_AMARILLO } };
      }
      if (col.clave === 'codigo') celda.numFmt = '@';
    });
    fila.commit();
  }
  hoja.commit();
}

export async function escribirLibro(
  salida: Writable,
  datos: {
    /** Genera los lotes en orden; cada lote trae sus filas de la hoja Base. */
    lotes: () => AsyncIterable<FilaBase[]>;
    leyenda: ResumenLeyenda;
    /** Los cambios de campo de las mismas referencias (una consulta). Se pide DESPUES de escribir `Base`. */
    historial?: () => Promise<HistorialExportado>;
  },
): Promise<void> {
  const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: salida, useStyles: true, useSharedStrings: true });
  libro.creator = 'Descripciones mínimas';
  libro.created = new Date();

  // ---- Hoja Base -----------------------------------------------------------------------------------------
  const base = libro.addWorksheet('Base', {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 1, activeCell: 'B2' }],
    properties: { defaultRowHeight: 15 },
  });
  base.columns = COLUMNAS_BASE.map((c) => ({ header: c.encabezado, key: c.clave, width: c.ancho }));
  base.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS_BASE.length } };
  estiloEncabezado(base, COLUMNAS_BASE.length);
  base.getRow(1).commit();

  let total = 0;
  const conteo = { pendientes: 0, clasificadas: 0, archivadas: 0 };
  const resumen: Array<{ valores: Record<string, ValorCelda>; estadoColor: 'amarillo' | 'verde' | null }> = [];
  for await (const lote of datos.lotes()) {
    for (const f of lote) {
      const fila = base.addRow([]);
      COLUMNAS_BASE.forEach((col, i) => {
        const celda = fila.getCell(i + 1);
        escribirCelda(celda, f.valores[col.clave] ?? null, col);
        if (col.tipo === 'estado') {
          celda.font = { name: FUENTE, size: 10, bold: true };
          if (f.estadoColor) {
            celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.estadoColor === 'verde' ? RELLENO_VERDE : RELLENO_AMARILLO } };
          }
        }
        if (col.clave === 'codigo' || col.clave === 'partida') celda.numFmt = '@';
      });
      fila.commit();
      total += 1;
      // Para «Resumen de estado» solo se conserva lo que esa hoja muestra.
      resumen.push({ valores: Object.fromEntries(COLUMNAS_RESUMEN.map((c) => [c.clave, f.valores[c.clave] ?? null])), estadoColor: f.estadoColor });
      const estado = f.valores.estado;
      if (estado === 'Clasificada') conteo.clasificadas += 1;
      else if (estado === 'Archivada') conteo.archivadas += 1;
      else conteo.pendientes += 1;
    }
  }
  base.commit();

  // ---- Resumen de estado -----------------------------------------------------------------------------------
  escribirTabla(libro, 'Resumen de estado', COLUMNAS_RESUMEN, resumen);

  // ---- Historial ----------------------------------------------------------------------------------------------
  let textoHistorial = 'No incluido';
  if (datos.historial) {
    const h = await datos.historial();
    const tope = h.tope.toLocaleString('es-CO');
    const aviso = h.recortado
      ? `Aviso: hay más cambios de los que caben en esta hoja. Se muestran solo los ${tope} más recientes. Filtra la lista y descarga por partes para ver el resto.`
      : undefined;
    escribirTabla(libro, 'Historial', COLUMNAS_HISTORIAL, h.filas, aviso ? { aviso } : {});
    textoHistorial = h.recortado
      ? `Incompleto: solo los ${tope} cambios más recientes`
      : `${h.filas.length.toLocaleString('es-CO')} cambios de campo, del más reciente al más antiguo`;
  }

  // ---- Leyenda -------------------------------------------------------------------------------------------
  const ley = libro.addWorksheet('Leyenda');
  ley.columns = [
    { key: 'a', width: 30 },
    { key: 'b', width: 80 },
  ];
  const l = datos.leyenda;
  const lineas: Array<[string, string, 'titulo' | 'amarillo' | 'verde' | null]> = [
    ['Descripciones mínimas', 'EssilorLuxottica · Supply Chain', 'titulo'],
    ['Exportado por', `${l.exportadoPor} (${l.rol})`, null],
    ['Fecha de la exportación', `${l.fecha} (hora de Bogotá)`, null],
    ['Alcance', l.alcance, null],
    ['Filtros aplicados', l.filtros.length > 0 ? l.filtros.join(' · ') : 'Ninguno', null],
    ['Referencias exportadas', String(total), null],
    ['Archivadas', l.incluyeArchivadas ? 'Incluidas' : 'No incluidas', null],
    ['Pendientes', String(conteo.pendientes), null],
    ['Clasificadas', String(conteo.clasificadas), null],
    ['Hoja «Base»', 'Una fila por referencia con todos sus campos.', null],
    ['Hoja «Resumen de estado»', 'Estado, días en gestión, qué tan completa va cada parte y de quién falta.', null],
    ['Hoja «Historial»', textoHistorial, null],
    ['', '', null],
    ['Pendiente', 'La clasificación no está finalizada. La referencia sigue en gestión.', 'amarillo'],
    ['Clasificada', 'La aduana cerró la clasificación. Los días en gestión quedan congelados.', 'verde'],
    ['', '', null],
    ['Nota', 'El archivo no contiene fórmulas. Los textos que empiezan con = + - @ están guardados como texto.', null],
  ];
  for (const [a, b, tipo] of lineas) {
    const fila = ley.addRow([a, b]);
    const ca = fila.getCell(1);
    const cb = fila.getCell(2);
    ca.font = { name: FUENTE, size: tipo === 'titulo' ? 14 : 10, bold: true, color: tipo === 'titulo' ? { argb: AZUL_MARCA } : undefined };
    cb.font = { name: FUENTE, size: 10 };
    ca.alignment = { vertical: 'top' };
    cb.alignment = { vertical: 'top', wrapText: true };
    if (tipo === 'amarillo' || tipo === 'verde') {
      ca.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tipo === 'verde' ? RELLENO_VERDE : RELLENO_AMARILLO } };
    }
    const p = prepararTexto(b);
    cb.value = p.texto;
    if (p.formatoTexto) cb.numFmt = '@';
    fila.commit();
  }
  ley.commit();

  await libro.commit();
}
