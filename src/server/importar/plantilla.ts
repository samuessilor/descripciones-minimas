/**
 * Genera la plantilla de Excel del historico: hoja `Instrucciones`, hoja `Referencias` (los encabezados de la plataforma, con
 * listas desplegables y formato de fecha/texto ya puestos) y hoja `Listas` (lo que cada lista acepta). La lee `leer-libro.ts`.
 */
import ExcelJS from 'exceljs';
import { listarPaises } from '@/dominio/paises';
import { COLUMNAS_HISTORICO, OPCIONES_PLANTILLA } from '@/dominio/plantilla-historico';
import { AREAS } from '@/dominio/areas';

/** Hasta que fila de `Referencias` llegan las listas desplegables (el importador lee todas las que tengan datos). */
export const FILAS_PLANTILLA = 3000;

export interface OpcionesPlantilla {
  unidades: readonly string[];
  aspectos: readonly string[];
}

const AZUL = 'FF1F3A5F';
const GRIS = 'FFEFF2F6';

function titulo(c: ExcelJS.Cell): void {
  c.font = { bold: true, size: 14, color: { argb: AZUL } };
}

/** Letra de columna de Excel (1 = A). */
function letra(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export async function crearPlantilla(opciones: OpcionesPlantilla): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Descripciones mínimas';
  libro.created = new Date();

  // Las hojas se crean en el orden en que se ven; se llenan despues.
  const instrucciones = libro.addWorksheet('Instrucciones');
  const hoja = libro.addWorksheet('Referencias', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  const listas = libro.addWorksheet('Listas');

  // ---- Listas -----------------------------------------------------------------------------------------------------
  const paises = [...listarPaises().map((p) => p.nombre), 'No se conoce'];
  const columnasLista: Array<{ nombre: string; valores: readonly string[] }> = [
    { nombre: 'Tipo de producto', valores: OPCIONES_PLANTILLA.tipo },
    { nombre: 'Área responsable', valores: AREAS },
    { nombre: 'Reembolsable', valores: OPCIONES_PLANTILLA.reembolsable },
    { nombre: 'Tipo de empaque', valores: OPCIONES_PLANTILLA.empaque },
    { nombre: 'Requiere RIM', valores: OPCIONES_PLANTILLA.siNo },
    { nombre: 'Unidad de medida', valores: opciones.unidades },
    { nombre: 'Aspecto físico', valores: [...opciones.aspectos, 'No aplica'] },
    { nombre: 'País de origen', valores: paises },
  ];
  columnasLista.forEach((l, i) => {
    const col = listas.getColumn(i + 1);
    col.width = Math.max(16, l.nombre.length + 2);
    const cab = listas.getCell(1, i + 1);
    cab.value = l.nombre;
    cab.font = { bold: true };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } };
    l.valores.forEach((v, j) => {
      listas.getCell(j + 2, i + 1).value = v;
    });
  });
  listas.views = [{ state: 'frozen', ySplit: 1 }];
  const rango = (nombre: string): string => {
    const i = columnasLista.findIndex((l) => l.nombre === nombre);
    return `Listas!$${letra(i + 1)}$2:$${letra(i + 1)}$${Math.max(2, (columnasLista[i]?.valores.length ?? 0) + 1)}`;
  };

  // ---- Referencias ------------------------------------------------------------------------------------------------
  hoja.columns = COLUMNAS_HISTORICO.map((c) => ({ header: c.encabezado, key: c.clave, width: c.ancho }));
  COLUMNAS_HISTORICO.forEach((c, i) => {
    const col = hoja.getColumn(i + 1);
    if (c.formato === 'texto') col.numFmt = '@';
    else if (c.formato === 'fecha') col.numFmt = 'dd/mm/yyyy';
    col.alignment = { vertical: 'top', wrapText: true };
  });
  const cabecera = hoja.getRow(1);
  cabecera.height = 32;
  cabecera.eachCell((c, n) => {
    const def = COLUMNAS_HISTORICO[n - 1];
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: def?.requerida ? 'FF9A3412' : AZUL } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNAS_HISTORICO.length } };

  // ExcelJS agrupa las validaciones por rango en `worksheet.dataValidations`, pero sus tipos no lo declaran (solo `cell.dataValidation`,
  // que escribiria una entrada por celda: 24.000). La API existe en tiempo de ejecucion; la prueba comprueba el XML resultante.
  const validaciones = (hoja as unknown as { dataValidations: { add(rango: string, v: ExcelJS.DataValidation): void } }).dataValidations;
  const lista = (clave: string, nombreLista: string, estricta: boolean) => {
    const n = COLUMNAS_HISTORICO.findIndex((c) => c.clave === clave) + 1;
    if (n === 0) return;
    const col = letra(n);
    validaciones.add(`${col}2:${col}${FILAS_PLANTILLA}`, {
      type: 'list',
      allowBlank: true,
      formulae: [rango(nombreLista)],
      showErrorMessage: true,
      errorStyle: estricta ? 'stop' : 'warning',
      errorTitle: nombreLista,
      error: estricta ? 'Elige un valor de la lista.' : 'Ese valor no está en la lista; el importador lo rechazará si el catálogo no lo tiene.',
    });
  };
  lista('tipo_producto', 'Tipo de producto', true);
  lista('area_responsable', 'Área responsable', true);
  lista('reembolsable', 'Reembolsable', true);
  lista('tipo_empaque', 'Tipo de empaque', true);
  lista('requiere_rim', 'Requiere RIM', true);
  lista('unidad_medida', 'Unidad de medida', false);
  lista('aspecto_fisico', 'Aspecto físico', false);
  lista('pais_origen', 'País de origen', false);

  // ---- Instrucciones (primera hoja del libro) ---------------------------------------------------------------------
  instrucciones.getColumn(1).width = 30;
  instrucciones.getColumn(2).width = 16;
  instrucciones.getColumn(3).width = 80;
  instrucciones.getColumn(4).width = 34;
  let f = 1;
  titulo(instrucciones.getCell(f, 1));
  instrucciones.getCell(f, 1).value = 'Carga del histórico a Descripciones mínimas';
  f += 2;
  const parrafos = [
    'Cada fila de la hoja «Referencias» es UNA referencia que ya terminó su clasificación antes de existir la plataforma. Entra a la plataforma como «Clasificada» y queda disponible en el buscador, el listado, el Resumen y el Excel.',
    'Solo las columnas con encabezado naranja son indispensables (Código, Descripción según factura, Tipo de producto y Fecha de solicitud). El resto se llena con lo que se tenga: lo que falte NO impide la carga; el informe de la importación lista, referencia por referencia, qué datos de los que hoy pide la ficha no trae.',
    'Las fechas se escriben día/mes/año (15/03/2025). Ninguna puede ser futura y la de clasificación no puede ser anterior a la de solicitud. Sin fecha de clasificación se usa la de solicitud y «Días en gestión» sale en 0: conviene llenarla.',
    'Las columnas con lista desplegable (tipo, área, reembolsable, empaque, RIM, unidad, aspecto, país) aceptan sin importar mayúsculas ni tildes. Si una unidad de medida o un aspecto físico no está en la lista, primero se agrega en Administración › Catálogos y luego se carga.',
    'En los campos que admiten «No aplica» (aspecto físico, descripciones mínimas, restricciones, observaciones de la aduana) se puede escribir exactamente eso. «Sin marca» en Marca y «El mismo fabricante» en Proveedor también se reconocen.',
    'El código no se puede repetir: ni dentro del archivo ni con una referencia que ya esté en la plataforma (esas filas se omiten y se informan; nunca se sobrescribe nada).',
    'Se puede cargar cuantas veces se quiera: lo ya cargado se omite. Primero se corre en modo prueba (no escribe nada) y el informe dice qué filas tienen errores y qué valores hay que corregir.',
    'Los datos cargados quedan a nombre de la cuenta «Histórico importado» (no puede entrar a la plataforma) y con la nota «Referencia cargada del histórico anterior a la plataforma» si «Información adicional» viene vacía. Si más adelante hay que cambiar una, se reabre como cualquier referencia clasificada.',
  ];
  for (const p of parrafos) {
    instrucciones.mergeCells(f, 1, f, 4);
    const c = instrucciones.getCell(f, 1);
    c.value = p;
    c.alignment = { wrapText: true, vertical: 'top' };
    instrucciones.getRow(f).height = Math.max(32, Math.ceil(p.length / 125) * 16);
    f += 1;
  }
  f += 1;
  titulo(instrucciones.getCell(f, 1));
  instrucciones.getCell(f, 1).value = 'Columnas';
  f += 1;
  ['Columna', 'Indispensable', 'Qué poner', 'Ejemplo'].forEach((t, i) => {
    const c = instrucciones.getCell(f, i + 1);
    c.value = t;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  });
  f += 1;
  for (const c of COLUMNAS_HISTORICO) {
    instrucciones.getCell(f, 1).value = c.encabezado;
    instrucciones.getCell(f, 1).font = { bold: true };
    instrucciones.getCell(f, 2).value = c.requerida ? 'Sí' : 'No';
    instrucciones.getCell(f, 3).value = c.ayuda;
    instrucciones.getCell(f, 4).value = c.ejemplo;
    for (let i = 1; i <= 4; i++) instrucciones.getCell(f, i).alignment = { wrapText: true, vertical: 'top' };
    f += 1;
  }
  // El libro se abre en la hoja de instrucciones.
  libro.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];

  return Buffer.from(await libro.xlsx.writeBuffer());
}
