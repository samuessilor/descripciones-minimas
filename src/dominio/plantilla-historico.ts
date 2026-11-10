/**
 * Plantilla del historico (Excel -> referencias cerradas) y lectura de una fila. Dominio PURO: sin base, sin Excel.
 *
 * Una fila = una referencia ya CLASIFICADA. Cada celda pasa por `normalizarValor`, la MISMA validacion que usa la ficha, asi
 * que el historico cumple las reglas de hoy (maximos, formatos, fechas no futuras, listas) y no hay un camino de carga con
 * reglas distintas. Lo que la ficha pediria y la fila no trae NO bloquea (son procesos viejos): queda como aviso y como
 * «faltantes» en el informe.
 *
 * Los encabezados son los de la hoja `Base` del Excel que descarga la plataforma: un archivo exportado se puede volver a
 * cargar, y las columnas que no conoce (Estado, Dias en gestion, autoria...) se ignoran.
 */
import { normalizarArea } from './areas';
import {
  camposObligatoriosAduana,
  camposObligatoriosCliente,
  EMPAQUES,
  EMPAQUES_CON_CONTENIDO,
  ETIQUETA_TIPO,
  esVisible,
  getCampo,
  REEMBOLSABLE,
  TIPOS_PRODUCTO,
  type CampoDef,
  type TipoProducto,
} from './campos';
import { compararFechas } from './dias-gestion';
import { NOTA_HISTORICO } from './historico-importado';
import { limpiarCaracteres, normalizarCodigo, normalizarTexto } from './normalizacion';
import { esCodigoPais, listarPaises, PAIS_NO_SE_CONOCE, sugerirPaises } from './paises';
import { esFechaValida, estaVacio, NO_APLICA, normalizarValor } from './valores';

/** Una celda que no se puede leer como dato: formula sin valor calculado guardado, o con error (`#N/A`, `#REF!`). */
export interface CeldaInvalida {
  invalida: string;
}

/** Lo que entrega el lector de Excel por celda. */
export type Celda = string | number | boolean | Date | CeldaInvalida | null | undefined;

export function esCeldaInvalida(c: Celda): c is CeldaInvalida {
  return typeof c === 'object' && c !== null && !(c instanceof Date) && 'invalida' in c;
}

export interface ColumnaHistorico {
  /** Clave del campo de la ficha, o `fecha_clasificacion` (no es un campo: es la fecha de cierre). */
  clave: string;
  encabezado: string;
  /** Otros encabezados que se aceptan (los de la ficha, que a veces difieren de los del Excel exportado). */
  alias?: readonly string[];
  /** Sin esta columna o sin este valor la fila no se puede cargar. */
  requerida?: boolean;
  ancho: number;
  /** Para la hoja de instrucciones. */
  ayuda: string;
  ejemplo: string;
  /** `texto` fuerza formato texto en la plantilla (codigos y partidas: Excel no debe volverlos numeros o fechas). */
  formato: 'texto' | 'fecha' | 'normal';
}

export const COLUMNAS_HISTORICO: readonly ColumnaHistorico[] = [
  { clave: 'codigo', encabezado: 'Código', requerida: true, ancho: 18, formato: 'texto', ejemplo: '1GA0612A00', ayuda: 'El código de la referencia, tal como se usa. No se puede repetir (ni dentro del archivo ni con las que ya están en la plataforma).' },
  { clave: 'nombre_producto', encabezado: 'Descripción según factura', requerida: true, ancho: 34, formato: 'normal', ejemplo: 'FILTRO ABSOLUTO - AIRE NUEVO', ayuda: 'Hasta 500 caracteres.' },
  { clave: 'tipo_producto', encabezado: 'Tipo de producto', requerida: true, ancho: 16, formato: 'normal', ejemplo: 'Repuesto', ayuda: 'Insumo, Repuesto, Equipo/Máquina, Accesorio o Montura.' },
  { clave: 'area_responsable', encabezado: 'Área responsable', ancho: 16, formato: 'normal', ejemplo: 'Mantenimiento', ayuda: 'Consumibles, Mantenimiento, Instrumentos o Marketing. Si queda vacía, la referencia queda sin área.' },
  { clave: 'fecha_solicitud', encabezado: 'Fecha de solicitud', requerida: true, ancho: 16, formato: 'fecha', ejemplo: '15/03/2025', ayuda: 'Día/mes/año. Cuándo se pidió la clasificación. No puede ser futura.' },
  { clave: 'fecha_clasificacion', encabezado: 'Fecha de clasificación', ancho: 18, formato: 'fecha', ejemplo: '02/04/2025', ayuda: 'Día/mes/año. Cuándo se cerró. Si queda vacía se usa la fecha de solicitud y «Días en gestión» saldrá en 0. Muy recomendada.' },
  { clave: 'descripcion_factura', encabezado: 'Nombre comercial', ancho: 30, formato: 'normal', ejemplo: 'NSR E1', ayuda: 'Hasta 500 caracteres.' },
  { clave: 'uso', encabezado: 'Uso del producto', ancho: 40, formato: 'normal', ejemplo: 'Filtrar el aire de la cabina de recubrimiento', ayuda: 'Hasta 2.000 caracteres.' },
  { clave: 'funciones', encabezado: 'Función de la máquina', alias: ['Función'], ancho: 40, formato: 'normal', ejemplo: 'Retiene partículas de 0,3 micras', ayuda: 'Hasta 2.000 caracteres.' },
  { clave: 'unidad_medida', encabezado: 'Unidad de medida', ancho: 16, formato: 'normal', ejemplo: 'Unidades', ayuda: 'Debe estar en la lista (hoja «Listas»). Si falta una, se agrega antes en Administración › Catálogos.' },
  { clave: 'pais_origen', encabezado: 'País de origen', ancho: 18, formato: 'normal', ejemplo: 'Francia', ayuda: 'Nombre en español (hoja «Listas») o código de 2 letras. «No se conoce» también vale.' },
  { clave: 'fabricante', encabezado: 'Fabricante', ancho: 24, formato: 'normal', ejemplo: 'NAGA', ayuda: 'Hasta 200 caracteres.' },
  { clave: 'proveedor', encabezado: 'Proveedor', ancho: 24, formato: 'normal', ejemplo: 'Essilor International', ayuda: 'Hasta 200 caracteres. «El mismo fabricante» si lo es.' },
  { clave: 'reembolsable', encabezado: 'Reembolsable', ancho: 14, formato: 'normal', ejemplo: 'No', ayuda: 'Sí, No o No aplica.' },
  { clave: 'materia_constitutiva', encabezado: 'Materia constitutiva', ancho: 36, formato: 'normal', ejemplo: 'Fibra de vidrio, aluminio', ayuda: 'Hasta 2.000 caracteres.' },
  { clave: 'aspecto_fisico', encabezado: 'Aspecto físico', ancho: 16, formato: 'normal', ejemplo: 'Sólido', ayuda: 'De la lista (hoja «Listas») o «No aplica».' },
  { clave: 'marca', encabezado: 'Marca', ancho: 20, formato: 'normal', ejemplo: 'NAGA', ayuda: 'Hasta 200 caracteres. «Sin marca» si no tiene.' },
  { clave: 'tipo_empaque', encabezado: 'Tipo de empaque', ancho: 18, formato: 'normal', ejemplo: 'Unidad', ayuda: 'Bidón, Paquete o Unidad.' },
  { clave: 'cantidad_empaque', encabezado: 'Contenido por empaque', ancho: 20, formato: 'normal', ejemplo: '20 litros', ayuda: 'Solo con Bidón o Paquete (litros, kilos o unidades por empaque). Con Unidad se ignora.' },
  { clave: 'maquina_destino', encabezado: 'Máquina de destino', alias: ['Máquina donde se instala'], ancho: 26, formato: 'normal', ejemplo: 'Aspiradora MEI', ayuda: 'Solo repuestos y accesorios. Hasta 500 caracteres.' },
  { clave: 'fecha_fabricacion', encabezado: 'Fecha de fabricación', ancho: 20, formato: 'fecha', ejemplo: '10/01/2024', ayuda: 'Solo equipos. Día/mes/año o «Por confirmar».' },
  { clave: 'requiere_rim', encabezado: 'Requiere RIM', alias: ['¿Requiere registro de importación (RIM)?'], ancho: 14, formato: 'normal', ejemplo: 'No', ayuda: 'Sí o No: si requería registro de importación.' },
  { clave: 'partida_arancelaria', encabezado: 'Partida arancelaria final', alias: ['Partida arancelaria', 'Partida'], ancho: 20, formato: 'texto', ejemplo: '8421.39.20.00', ayuda: '10 dígitos, con o sin puntos.' },
  { clave: 'descripciones_minimas', encabezado: 'Descripciones mínimas adicionales', ancho: 44, formato: 'normal', ejemplo: 'No aplica', ayuda: 'Lo que la aduana pidió saber, o «No aplica». Hasta 5.000 caracteres.' },
  { clave: 'respuesta_area', encabezado: 'Respuesta del área', ancho: 40, formato: 'normal', ejemplo: '', ayuda: 'Solo si «Descripciones mínimas adicionales» trae una solicitud. Si no, se ignora.' },
  { clave: 'restricciones', encabezado: 'Restricciones', ancho: 36, formato: 'normal', ejemplo: 'No aplica', ayuda: 'Texto de la restricción o «No aplica». Hasta 5.000 caracteres.' },
  { clave: 'observaciones_aduana', encabezado: 'Observaciones de la aduana', ancho: 36, formato: 'normal', ejemplo: 'No aplica', ayuda: 'Texto o «No aplica». Hasta 2.000 caracteres.' },
  { clave: 'informacion_adicional', encabezado: 'Información adicional', ancho: 36, formato: 'normal', ejemplo: '', ayuda: `Opcional. Si queda vacía se escribe «${NOTA_HISTORICO}»` },
];

/** Los valores que la plantilla ofrece en sus listas desplegables. */
export const OPCIONES_PLANTILLA = {
  tipo: TIPOS_PRODUCTO.map((t) => ETIQUETA_TIPO[t]),
  reembolsable: [...REEMBOLSABLE],
  empaque: [...EMPAQUES],
  siNo: ['Sí', 'No'],
} as const;

export function normalizarEncabezado(texto: string): string {
  return normalizarTexto(texto).replace(/[¿?:]/g, '').trim();
}

/** Para cada columna conocida, que encabezado normalizado la identifica. */
const POR_ENCABEZADO: ReadonlyMap<string, ColumnaHistorico> = new Map(
  COLUMNAS_HISTORICO.flatMap((c) => [c.encabezado, ...(c.alias ?? [])].map((e) => [normalizarEncabezado(e), c] as const)),
);

export function columnaPorEncabezado(texto: string): ColumnaHistorico | null {
  return POR_ENCABEZADO.get(normalizarEncabezado(texto)) ?? null;
}

// ---- Celdas -> texto y fechas ---------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0');

function fechaDeDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  // ExcelJS entrega las celdas de fecha como medianoche UTC del dia que se ve en la hoja.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `YYYY-MM-DD` desde una fecha de Excel, un numero de serie de Excel o un texto (`2025-03-15`, `15/03/2025`, `15-03-2025`). */
export function fechaDeCelda(c: Celda): string | null {
  if (c === null || c === undefined || c === '' || esCeldaInvalida(c)) return null;
  let f: string | null = null;
  if (c instanceof Date) f = fechaDeDate(c);
  else if (typeof c === 'number') {
    // Numero de serie de Excel (dias desde 1899-12-30).
    if (c >= 20_000 && c <= 80_000) f = fechaDeDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(c) * 86_400_000));
  } else if (typeof c === 'string') {
    const t = c.trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
    if (m) f = `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
    else {
      m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
      if (m) f = `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`; // dia/mes/año (Colombia)
    }
  }
  return f && esFechaValida(f) ? f : null;
}

/** Texto de una celda para un campo de texto. Una fecha escrita en una celda de texto se conserva como fecha ISO. */
export function textoDeCelda(c: Celda): string {
  if (c === null || c === undefined || esCeldaInvalida(c)) return '';
  if (c instanceof Date) return fechaDeDate(c) ?? '';
  if (typeof c === 'boolean') return c ? 'Sí' : 'No';
  if (typeof c === 'number') return String(c);
  return c.replace(/\r\n?/g, '\n').trim();
}

// ---- Listas ---------------------------------------------------------------------------------------------------------

const TIPOS_POR_TEXTO: ReadonlyMap<string, TipoProducto> = new Map<string, TipoProducto>([
  ...TIPOS_PRODUCTO.flatMap((t) => [[normalizarTexto(t), t] as const, [normalizarTexto(ETIQUETA_TIPO[t]), t] as const]),
  ['equipo', 'EQUIPO'],
  ['maquina', 'EQUIPO'],
  ['equipo maquina', 'EQUIPO'],
  ['insumos', 'INSUMO'],
  ['repuestos', 'REPUESTO'],
  ['accesorios', 'ACCESORIO'],
  ['monturas', 'MONTURA'],
]);

const ALIAS_PAIS: ReadonlyArray<readonly [string, string]> = [
  ['eeuu', 'US'], ['ee uu', 'US'], ['ee. uu.', 'US'], ['usa', 'US'], ['estados unidos de america', 'US'],
  ['uk', 'GB'], ['inglaterra', 'GB'], ['gran bretana', 'GB'],
  ['holanda', 'NL'], ['corea', 'KR'], ['republica checa', 'CZ'], ['hong kong', 'HK'], ['emiratos arabes', 'AE'],
  ['china continental', 'CN'], ['desconocido', PAIS_NO_SE_CONOCE], ['no se conoce', PAIS_NO_SE_CONOCE], ['no se sabe', PAIS_NO_SE_CONOCE],
];

let paisesPorNombre: Map<string, string> | null = null;
function mapaPaises(): Map<string, string> {
  if (!paisesPorNombre) {
    paisesPorNombre = new Map(listarPaises().map((p) => [normalizarTexto(p.nombre), p.codigo]));
    for (const [alias, codigo] of ALIAS_PAIS) paisesPorNombre.set(normalizarTexto(alias), codigo);
  }
  return paisesPorNombre;
}

function resolverPais(texto: string): { ok: true; codigo: string } | { ok: false; mensaje: string } {
  const n = normalizarTexto(texto);
  const porNombre = mapaPaises().get(n);
  if (porNombre) return { ok: true, codigo: porNombre };
  const cod = texto.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(cod) && esCodigoPais(cod)) return { ok: true, codigo: cod };
  const sug = sugerirPaises(texto).slice(0, 3).map((p) => p.nombre);
  return { ok: false, mensaje: `«${texto}» no es un país de la lista${sug.length ? ` (¿${sug.join(', ')}?)` : ''}.` };
}

function esNoAplicaTexto(texto: string): boolean {
  const n = normalizarTexto(texto);
  return n === 'no aplica' || n === 'n/a' || n === 'na' || n.startsWith('no es necesario');
}

function coincidir(texto: string, opciones: readonly string[]): string | null {
  const n = normalizarTexto(texto);
  return opciones.find((o) => normalizarTexto(o) === n) ?? null;
}

// ---- Interpretacion de una fila ---------------------------------------------------------------------------------------

export interface ContextoImportacion {
  /** Hoy en Bogota (`YYYY-MM-DD`): ninguna fecha puede ser posterior. */
  hoy: string;
  /** Valores vigentes de los catalogos administrables. */
  catalogos: { unidad_medida: readonly string[]; aspecto_fisico: readonly string[] };
}

export interface FilaInterpretada {
  /** Numero de fila en la hoja de Excel (para el informe). */
  fila: number;
  codigo: string;
  codigoNorm: string;
  tipo: TipoProducto;
  fechaSolicitud: string;
  /** Fecha de cierre efectiva (la de solicitud si la fila no la trae). */
  fechaClasificacion: string;
  sinFechaClasificacion: boolean;
  partida: string | null;
  /** Campos ya normalizados y no vacios, en el orden de las columnas. Incluye codigo, nombre, tipo y fecha de solicitud. */
  valores: Array<[campo: string, valor: unknown]>;
  /** Etiquetas de lo que la ficha pediria y esta fila no trae. */
  faltantes: string[];
}

/** Un valor escrito en una lista administrable (unidad, aspecto) que el catalogo no tiene. */
export interface ValorDesconocido {
  catalogo: 'unidad_medida' | 'aspecto_fisico';
  valor: string;
}

export type ResultadoFila =
  | { ok: true; fila: FilaInterpretada; avisos: string[] }
  | { ok: false; fila: number; codigo: string | null; errores: string[]; avisos: string[]; desconocidos: ValorDesconocido[] };

/** Para cada campo con tratamiento propio: de la celda a la «entrada» que entiende `normalizarValor`. */
function entradaDeCampo(
  def: CampoDef,
  celda: Celda,
  ctx: ContextoImportacion,
): { ok: true; entrada: unknown } | { ok: false; mensaje: string; desconocido?: ValorDesconocido } {
  const texto = textoDeCelda(celda);
  if (texto === '') return { ok: true, entrada: null };
  if (def.noAplica && esNoAplicaTexto(texto)) return { ok: true, entrada: { ...NO_APLICA } };

  switch (def.tipoDato) {
    case 'pais': {
      const p = resolverPais(texto);
      return p.ok ? { ok: true, entrada: p.codigo } : { ok: false, mensaje: p.mensaje };
    }
    case 'marca': {
      const n = normalizarTexto(texto);
      return { ok: true, entrada: n === 'sin marca' || n === 'no tiene marca' ? { sin_marca: true } : texto };
    }
    case 'proveedor': {
      const n = normalizarTexto(texto);
      const mismo = n === 'mismo fabricante' || n === 'el mismo fabricante' || n === 'igual al fabricante';
      return { ok: true, entrada: mismo ? { mismo_fabricante: true } : texto };
    }
    case 'si_no':
      return { ok: true, entrada: texto };
    case 'fecha_fabricacion': {
      if (normalizarTexto(texto) === 'por confirmar') return { ok: true, entrada: { por_confirmar: true, nota: '' } };
      const f = fechaDeCelda(celda);
      return f ? { ok: true, entrada: { fecha: f } } : { ok: false, mensaje: `«${texto}» no es una fecha (usa día/mes/año) ni «Por confirmar».` };
    }
    case 'lista': {
      if (def.opciones) {
        const o = coincidir(texto, def.opciones);
        return o ? { ok: true, entrada: o } : { ok: false, mensaje: `«${texto}» no es una opción. Elige: ${def.opciones.join(', ')}.` };
      }
      if (def.catalogo) {
        const lista = ctx.catalogos[def.catalogo];
        const v = coincidir(texto, lista);
        if (v) return { ok: true, entrada: v };
        const muestra = lista.slice(0, 8).join(', ');
        return {
          ok: false,
          mensaje: `«${texto}» no está en el catálogo de «${def.etiqueta}»${muestra ? ` (${muestra}${lista.length > 8 ? ', …' : ''})` : ''}. Agrégalo antes en Administración › Catálogos.`,
          desconocido: { catalogo: def.catalogo, valor: texto },
        };
      }
      return { ok: true, entrada: texto };
    }
    default:
      return { ok: true, entrada: texto };
  }
}

/**
 * Lee una fila. `celdas` va por clave de columna. Devuelve los errores que la dejan fuera y los avisos que no la bloquean.
 */
export function interpretarFila(filaExcel: number, celdas: Readonly<Record<string, Celda>>, ctx: ContextoImportacion): ResultadoFila {
  const errores: string[] = [];
  const avisos: string[] = [];
  const desconocidos: ValorDesconocido[] = [];
  const get = (clave: string): Celda => celdas[clave];

  // Una celda que Excel no pudo calcular (formula sin resultado guardado, #N/A...) no es «vacia»: es un dato perdido.
  for (const col of COLUMNAS_HISTORICO) {
    if (esCeldaInvalida(get(col.clave))) errores.push(`${col.encabezado}: la celda tiene una fórmula sin valor calculado o un error de Excel. Reemplázala por el valor.`);
  }

  // El codigo es lo unico que no se puede corregir luego sin motivo ni rastro: se lee con mas cuidado que el resto.
  const celdaCodigo = get('codigo');
  const codigo = limpiarCaracteres(textoDeCelda(celdaCodigo)).trim();
  const codigoNorm = normalizarCodigo(codigo);
  if (codigoNorm === '') {
    if (!esCeldaInvalida(celdaCodigo)) errores.push('Falta el código de la referencia.');
  } else if ([...codigo].length > 80) errores.push('El código supera los 80 caracteres.');
  else if (/[\r\n\t]/.test(codigo)) errores.push('El código no puede tener saltos de línea ni tabulaciones.');
  else if (celdaCodigo instanceof Date || typeof celdaCodigo === 'boolean') {
    errores.push('El código llegó como fecha o como Sí/No (Excel lo convirtió). Formatea la columna Código como Texto y escríbelo de nuevo.');
  } else if (typeof celdaCodigo === 'number') {
    avisos.push('El código llegó como número: si tenía ceros a la izquierda, Excel los quitó. Formatea la columna Código como Texto.');
  }
  if (get('partida_arancelaria') instanceof Date || typeof get('partida_arancelaria') === 'boolean') {
    errores.push('Partida arancelaria final: llegó como fecha o como Sí/No. Formatea la columna como Texto y escríbela de nuevo.');
  }

  const textoTipo = textoDeCelda(get('tipo_producto'));
  const tipo = TIPOS_POR_TEXTO.get(normalizarTexto(textoTipo)) ?? null;
  if (!tipo) errores.push(textoTipo === '' ? 'Falta el tipo de producto.' : `Tipo de producto «${textoTipo}» no válido. Elige: ${OPCIONES_PLANTILLA.tipo.join(', ')}.`);

  const fechaSolicitud = fechaDeCelda(get('fecha_solicitud'));
  if (!fechaSolicitud) {
    const t = textoDeCelda(get('fecha_solicitud'));
    errores.push(t === '' ? 'Falta la fecha de solicitud.' : `La fecha de solicitud «${t}» no es válida (usa día/mes/año).`);
  } else if (compararFechas(fechaSolicitud, ctx.hoy) > 0) errores.push('La fecha de solicitud no puede ser futura.');

  const textoCierre = textoDeCelda(get('fecha_clasificacion'));
  let fechaCierre = textoCierre === '' ? null : fechaDeCelda(get('fecha_clasificacion'));
  if (textoCierre !== '' && !fechaCierre) errores.push(`La fecha de clasificación «${textoCierre}» no es válida (usa día/mes/año).`);
  if (fechaCierre) {
    if (compararFechas(fechaCierre, ctx.hoy) > 0) errores.push('La fecha de clasificación no puede ser futura.');
    else if (fechaSolicitud && compararFechas(fechaCierre, fechaSolicitud) < 0) errores.push('La fecha de clasificación es anterior a la de solicitud.');
  }
  const sinFechaClasificacion = textoCierre === '';
  if (sinFechaClasificacion) fechaCierre = fechaSolicitud;
  if (sinFechaClasificacion && fechaSolicitud) avisos.push('Sin fecha de clasificación: se usa la de solicitud (los días en gestión salen en 0).');

  const textoArea = textoDeCelda(get('area_responsable'));
  const area = textoArea === '' ? null : normalizarArea(textoArea);
  if (textoArea !== '' && !area) errores.push(`Área «${textoArea}» no válida. Elige Consumibles, Mantenimiento, Instrumentos o Marketing.`);

  const valores: Array<[string, unknown]> = [];
  const mapa: Record<string, unknown> = {};
  const poner = (campo: string, valor: unknown) => {
    valores.push([campo, valor]);
    mapa[campo] = valor;
  };

  // Un error por campo, con el nombre de la columna: quien corrige el Excel necesita saber cual celda.
  for (const col of COLUMNAS_HISTORICO) {
    const def = getCampo(col.clave);
    // Codigo, tipo, area y fecha de solicitud se leen aparte (arriba); la fecha de clasificacion no es un campo.
    if (!def || ['codigo', 'tipo_producto', 'area_responsable', 'fecha_solicitud'].includes(col.clave)) continue;
    const celda = get(col.clave);
    if (textoDeCelda(celda) === '') continue;
    if (tipo && !esVisible(def, tipo)) {
      avisos.push(`«${col.encabezado}» no aplica a un ${ETIQUETA_TIPO[tipo].toLowerCase()}: se ignoró.`);
      continue;
    }
    if (def.clave === 'cantidad_empaque' && !EMPAQUES_CON_CONTENIDO.includes(String(mapa.tipo_empaque ?? ''))) {
      avisos.push('«Contenido por empaque» solo se guarda con Bidón o Paquete: se ignoró.');
      continue;
    }
    if (def.clave === 'respuesta_area' && typeof mapa.descripciones_minimas !== 'string') {
      avisos.push('«Respuesta del área» necesita una solicitud en «Descripciones mínimas adicionales»: se ignoró.');
      continue;
    }
    const e = entradaDeCampo(def, celda, ctx);
    if (!e.ok) {
      errores.push(`${col.encabezado}: ${e.mensaje}`);
      if (e.desconocido) desconocidos.push(e.desconocido);
      continue;
    }
    const r = normalizarValor(def, e.entrada, { hoy: ctx.hoy, valores: mapa });
    if (!r.ok) {
      errores.push(`${col.encabezado}: ${r.mensaje}`);
      continue;
    }
    if (!estaVacio(r.valor)) poner(def.clave, r.valor);
  }

  if (typeof mapa.nombre_producto !== 'string' && textoDeCelda(get('nombre_producto')) === '') errores.push('Falta la descripción según factura.');

  if (errores.length > 0 || !tipo || !fechaSolicitud || !fechaCierre || typeof mapa.nombre_producto !== 'string') {
    return { ok: false, fila: filaExcel, codigo: codigo === '' ? null : codigo, errores, avisos, desconocidos };
  }

  // Los datos que la ficha pide al crearla van primero, como en una referencia nueva; el resto, en el orden de las columnas.
  const encabezado: Array<[string, unknown]> = [
    ['codigo', codigo],
    ['nombre_producto', mapa.nombre_producto],
    ['tipo_producto', tipo],
    ['fecha_solicitud', fechaSolicitud],
  ];
  if (area) encabezado.push(['area_responsable', area]);
  const resto = valores.filter(([c]) => c !== 'nombre_producto');
  if (!('informacion_adicional' in mapa)) resto.push(['informacion_adicional', NOTA_HISTORICO]);
  const todos = [...encabezado, ...resto];
  const plano: Record<string, unknown> = Object.fromEntries(todos);

  const obligatorios = [...camposObligatoriosCliente(tipo, undefined, plano), ...camposObligatoriosAduana(tipo)].filter(
    (c) => c.clave !== 'clasificacion_finalizada' && c.tipoDato !== 'adjuntos' && c.tipoDato !== 'calculado',
  );
  const faltantes = [...new Set(obligatorios.filter((c) => estaVacio(plano[c.clave])).map((c) => c.etiqueta))];
  if (faltantes.length > 0) avisos.push(`Le faltan ${faltantes.length} dato(s) que hoy pide la ficha: ${faltantes.join(', ')}.`);

  const partida = typeof plano.partida_arancelaria === 'string' ? plano.partida_arancelaria : null;
  return {
    ok: true,
    avisos,
    fila: {
      fila: filaExcel,
      codigo,
      codigoNorm,
      tipo,
      fechaSolicitud,
      fechaClasificacion: fechaCierre,
      sinFechaClasificacion,
      partida,
      valores: todos,
      faltantes,
    },
  };
}
