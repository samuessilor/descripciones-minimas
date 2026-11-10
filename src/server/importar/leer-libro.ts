/**
 * Lee el Excel del historico (el de la plantilla o uno descargado de la plataforma) y lo entrega como filas por clave de
 * columna. No valida valores: eso es de `interpretarFila` (dominio). Aqui solo se ubica la hoja, el encabezado y las columnas.
 */
import ExcelJS from 'exceljs';
import { columnaPorEncabezado, COLUMNAS_HISTORICO, textoDeCelda, type Celda, type ColumnaHistorico } from '@/dominio/plantilla-historico';

export interface FilaLeida {
  /** Numero de fila en la hoja (1 = encabezado). */
  fila: number;
  celdas: Record<string, Celda>;
}

export interface LibroLeido {
  hoja: string;
  filas: FilaLeida[];
  /** Encabezados que la plataforma no usa (se ignoran). */
  columnasIgnoradas: string[];
  /** Columnas obligatorias que no estan en el archivo: sin ellas no se puede importar nada. */
  columnasFaltantes: string[];
  /** Columnas que aparecen dos veces (se usa la primera). */
  columnasRepetidas: string[];
}

/** Hojas donde se busca el encabezado, en este orden; si ninguna existe, la primera del libro. */
const HOJAS = ['Referencias', 'Base'];

function valorDeCelda(v: ExcelJS.CellValue): Celda {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  const o = v as unknown as Record<string, unknown>;
  if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('');
  if ('formula' in o || 'sharedFormula' in o) {
    // Formula: vale lo que Excel dejo calculado. Sin resultado guardado (libros generados por script) no hay dato que leer.
    return o.result === undefined || o.result === null ? { invalida: 'formula' } : valorDeCelda(o.result as ExcelJS.CellValue);
  }
  if (typeof o.text === 'string') return o.text; // hipervinculo
  if ('error' in o) return { invalida: String(o.error) };
  return null;
}

/** Valor de una celda tal como se ve: un numero con formato de porcentaje («85 %») se conserva como texto y no como 0,85. */
function leerCelda(c: ExcelJS.Cell): Celda {
  const v = valorDeCelda(c.value);
  // (`cell.text` de ExcelJS no aplica el formato: 0,85 con formato 0 % hay que escribirlo como 85%.)
  if (typeof v === 'number' && typeof c.numFmt === 'string' && c.numFmt.includes('%')) return `${Number((v * 100).toFixed(6))}%`;
  return v;
}

function hojaDe(libro: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  for (const n of HOJAS) {
    const h = libro.getWorksheet(n);
    if (h) return h;
  }
  return libro.worksheets[0];
}

export async function leerLibro(origen: string | Buffer | ArrayBuffer): Promise<LibroLeido> {
  const libro = new ExcelJS.Workbook();
  if (typeof origen === 'string') await libro.xlsx.readFile(origen);
  else await libro.xlsx.load(origen as unknown as ExcelJS.Buffer);
  const hoja = hojaDe(libro);
  if (!hoja) throw new Error('El archivo no tiene hojas.');

  // El encabezado es la primera fila (de las 10 primeras) donde aparece la columna «Código».
  let filaEncabezado = 0;
  const columnas = new Map<number, ColumnaHistorico>();
  const ignoradas: string[] = [];
  const repetidas: string[] = [];
  for (let r = 1; r <= Math.min(10, hoja.rowCount) && filaEncabezado === 0; r++) {
    const fila = hoja.getRow(r);
    const candidatas = new Map<number, ColumnaHistorico>();
    fila.eachCell({ includeEmpty: false }, (celda, n) => {
      const c = columnaPorEncabezado(textoDeCelda(valorDeCelda(celda.value)));
      if (c) candidatas.set(n, c);
    });
    if ([...candidatas.values()].some((c) => c.clave === 'codigo')) {
      filaEncabezado = r;
      const vistas = new Set<string>();
      fila.eachCell({ includeEmpty: false }, (celda, n) => {
        const texto = textoDeCelda(valorDeCelda(celda.value));
        const c = candidatas.get(n);
        if (!c) {
          if (texto !== '') ignoradas.push(texto);
        } else if (vistas.has(c.clave)) repetidas.push(texto);
        else {
          vistas.add(c.clave);
          columnas.set(n, c);
        }
      });
    }
  }
  if (filaEncabezado === 0) {
    return { hoja: hoja.name, filas: [], columnasIgnoradas: [], columnasFaltantes: ['Código'], columnasRepetidas: [] };
  }

  const presentes = new Set([...columnas.values()].map((c) => c.clave));
  const columnasFaltantes = COLUMNAS_HISTORICO.filter((c) => c.requerida && !presentes.has(c.clave)).map((c) => c.encabezado);

  const filas: FilaLeida[] = [];
  // `eachRow` salta las filas que no existen (un libro con formato hasta la fila 1.048.576 no se recorre entero).
  hoja.eachRow({ includeEmpty: false }, (fila, r) => {
    if (r <= filaEncabezado) return;
    const celdas: Record<string, Celda> = {};
    let hayDatos = false;
    for (const [n, c] of columnas) {
      const v = leerCelda(fila.getCell(n));
      celdas[c.clave] = v;
      if (v !== null && !(typeof v === 'string' && v.trim() === '')) hayDatos = true;
    }
    if (hayDatos) filas.push({ fila: r, celdas });
  });
  return { hoja: hoja.name, filas, columnasIgnoradas: ignoradas, columnasFaltantes, columnasRepetidas: repetidas };
}
