/**
 * Valores de los campos: validacion y normalizacion de lo que llega del formulario hacia lo que
 * se guarda en `campo_historial.valor` y `referencia.datos` (SPEC 6.3 y 7). Dominio puro.
 */
import { esArea } from './areas';
import { getCampo, type CampoDef, type TipoProducto, TIPOS_PRODUCTO } from './campos';
import { parsearCantidad, parsearValorUnitario, type Desambiguacion, type ResultadoNumero } from './cantidad';
import { compararFechas } from './dias-gestion';
import { limpiarCaracteres } from './normalizacion';
import { PAIS_NO_SE_CONOCE, esCodigoPais } from './paises';
import { normalizarPartida } from './partida';

export type ResultadoValor =
  | { ok: true; valor: unknown }
  | { ok: false; mensaje: string; detalle?: Extract<ResultadoNumero, { ok: false }> };

export interface ContextoValor {
  /** Fecha de hoy en Bogota (`YYYY-MM-DD`). */
  hoy: string;
  /** Valores vigentes de la ficha (la respuesta del area guarda la solicitud de la aduana que contesta). */
  valores?: Record<string, unknown>;
}

/** Valor de la marca «No aplica» (cuenta como diligenciado). */
export const NO_APLICA = { no_aplica: true } as const;

export function esNoAplica(v: unknown): boolean {
  return esObjeto(v) && v.no_aplica === true;
}

/** Campos que se piden al crear y que nunca pueden quedar vacios. */
const NO_VACIABLES = new Set(['nombre_producto', 'tipo_producto', 'fecha_solicitud']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const falla = (mensaje: string): ResultadoValor => ({ ok: false, mensaje });
const bien = (valor: unknown): ResultadoValor => ({ ok: true, valor });

function limpiarTexto(s: string): string {
  // Postgres rechaza U+0000 y los sustitutos sueltos en jsonb; los saltos de linea se unifican.
  return limpiarCaracteres(s).replace(/\r\n?/g, '\n').trim();
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function esFechaValida(fecha: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function textoLibre(campo: CampoDef, entrada: unknown): ResultadoValor {
  if (entrada === null || entrada === undefined) return bien(null);
  if (typeof entrada !== 'string') return falla('Escribe texto.');
  const t = limpiarTexto(entrada);
  if (t === '') return bien(null);
  if (campo.maximo && [...t].length > campo.maximo) {
    return falla(`Máximo ${campo.maximo} caracteres.`);
  }
  return bien(t);
}

function numero(
  entrada: unknown,
  parse: (t: string, o: { desambiguar?: Desambiguacion }) => ResultadoNumero,
  envolver: (r: Extract<ResultadoNumero, { ok: true }>) => unknown,
): ResultadoValor {
  if (entrada === null || entrada === undefined) return bien(null);
  let texto: string;
  let desambiguar: Desambiguacion | undefined;
  if (typeof entrada === 'string') texto = entrada;
  else if (typeof entrada === 'number' && Number.isFinite(entrada)) texto = String(entrada);
  else if (esObjeto(entrada) && typeof entrada.texto === 'string') {
    texto = entrada.texto;
    if (entrada.desambiguar === 'decimal' || entrada.desambiguar === 'entero') desambiguar = entrada.desambiguar;
  } else return falla('Escribe un número.');
  if (texto.trim() === '') return bien(null);
  const r = parse(texto, { desambiguar });
  if (!r.ok) return { ok: false, mensaje: r.mensaje, detalle: r };
  return bien(envolver(r));
}

/**
 * Valida y normaliza lo digitado. `null`/vacio significa "vaciar el campo".
 * El valor devuelto es JSON listo para guardar.
 */
export function normalizarValor(campoOClave: CampoDef | string, entrada: unknown, ctx: ContextoValor): ResultadoValor {
  const campo = typeof campoOClave === 'string' ? getCampo(campoOClave) : campoOClave;
  if (!campo) return falla('Campo desconocido.');

  const r = normalizarSegunTipo(campo, entrada, ctx);
  if (r.ok && r.valor === null && NO_VACIABLES.has(campo.clave)) {
    return falla(`${campo.etiqueta} no se puede dejar vacío.`);
  }
  return r;
}

function normalizarSegunTipo(campo: CampoDef, entrada: unknown, ctx: ContextoValor): ResultadoValor {
  if (esNoAplica(entrada)) return campo.noAplica ? bien({ ...NO_APLICA }) : falla('Este campo no admite «No aplica».');
  switch (campo.tipoDato) {
    case 'texto':
    case 'texto_largo':
    case 'lista':
      return textoLibre(campo, entrada);

    case 'tipo_producto': {
      if (typeof entrada !== 'string' || !(TIPOS_PRODUCTO as readonly string[]).includes(entrada)) {
        return falla('Elige un tipo de producto de la lista.');
      }
      return bien(entrada as TipoProducto);
    }

    case 'area': {
      if (entrada === null || entrada === undefined || entrada === '') return bien(null);
      return esArea(entrada) ? bien(entrada) : falla('Elige un área de la lista.');
    }

    case 'marca': {
      if (entrada === null || entrada === undefined) return bien(null);
      if (typeof entrada === 'string') {
        const t = limpiarTexto(entrada);
        return t === '' ? bien(null) : tamanoMarca(campo, t);
      }
      if (esObjeto(entrada)) {
        if (entrada.sin_marca === true) return bien({ sin_marca: true });
        if (typeof entrada.texto === 'string') {
          const t = limpiarTexto(entrada.texto);
          return t === '' ? bien(null) : tamanoMarca(campo, t);
        }
      }
      return falla('Escribe la marca o marca «No tiene marca».');
    }

    case 'proveedor': {
      if (esObjeto(entrada) && entrada.mismo_fabricante === true) return bien({ mismo_fabricante: true });
      if (entrada !== null && entrada !== undefined && typeof entrada !== 'string') return falla('Escribe el proveedor.');
      return textoLibre(campo, entrada);
    }

    case 'respuesta': {
      const r = textoLibre(campo, esObjeto(entrada) && typeof entrada.texto === 'string' ? entrada.texto : entrada);
      if (!r.ok || r.valor === null) return r;
      const solicitud = ctx.valores?.descripciones_minimas;
      return bien({ texto: r.valor, sobre: typeof solicitud === 'string' ? solicitud.trim() : '' });
    }

    case 'pais': {
      if (entrada === null || entrada === undefined || entrada === '') return bien(null);
      if (typeof entrada !== 'string') return falla('Elige un país de la lista.');
      if (entrada === PAIS_NO_SE_CONOCE) return bien(PAIS_NO_SE_CONOCE);
      const codigo = entrada.trim().toUpperCase();
      return esCodigoPais(codigo) ? bien(codigo) : falla('Elige un país de la lista.');
    }

    case 'valor_unitario':
      return numero(entrada, parsearValorUnitario, (r) => r.valor);

    case 'cantidad':
      return numero(entrada, parsearCantidad, (r) => ({ valor: r.valor, expresion: r.expresion }));

    case 'fecha': {
      if (typeof entrada !== 'string' || !esFechaValida(entrada)) return falla('Escribe una fecha válida.');
      if (compararFechas(entrada, ctx.hoy) > 0) return falla('La fecha no puede ser futura.');
      return bien(entrada);
    }

    case 'fecha_fabricacion': {
      if (entrada === null || entrada === undefined) return bien(null);
      if (!esObjeto(entrada)) return falla('Escribe una fecha o marca «Por confirmar».');
      if (entrada.por_confirmar === true) {
        const nota = typeof entrada.nota === 'string' ? limpiarTexto(entrada.nota) : '';
        if ([...nota].length > 500) return falla('La nota admite máximo 500 caracteres.');
        return bien({ por_confirmar: true, nota });
      }
      if (typeof entrada.fecha !== 'string' || !esFechaValida(entrada.fecha)) return falla('Escribe una fecha válida.');
      if (compararFechas(entrada.fecha, ctx.hoy) > 0) return falla('La fecha de fabricación no puede ser futura.');
      return bien({ fecha: entrada.fecha });
    }

    case 'partida': {
      if (entrada === null || entrada === undefined || entrada === '') return bien(null);
      if (typeof entrada !== 'string') return falla('La partida tiene el formato 0000.00.00.00.');
      const p = normalizarPartida(entrada);
      return p ? bien(p) : falla('La partida tiene el formato 0000.00.00.00.');
    }

    case 'clasificador': {
      if (entrada === null || entrada === undefined) return bien(null);
      if (!esObjeto(entrada)) return falla('Elige un usuario o escribe nombre y organización.');
      if (typeof entrada.usuario_id === 'string') {
        return UUID.test(entrada.usuario_id) ? bien({ usuario_id: entrada.usuario_id }) : falla('Usuario no válido.');
      }
      if (typeof entrada.nombre === 'string' && typeof entrada.organizacion === 'string') {
        const nombre = limpiarTexto(entrada.nombre);
        const organizacion = limpiarTexto(entrada.organizacion);
        if (nombre === '' || organizacion === '') return falla('Escribe el nombre y la organización.');
        if ([...nombre].length > 200 || [...organizacion].length > 200) return falla('Máximo 200 caracteres.');
        return bien({ nombre, organizacion });
      }
      return falla('Elige un usuario o escribe nombre y organización.');
    }

    case 'si_no': {
      if (entrada === null || entrada === undefined || entrada === '') return bien(null);
      if (typeof entrada !== 'string') return falla('Elige SÍ o NO.');
      const t = entrada
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .trim()
        .toUpperCase();
      return t === 'SI' || t === 'NO' ? bien(t) : falla('Elige SÍ o NO.');
    }

    case 'codigo':
    case 'calculado':
    case 'adjuntos':
      return falla('Este campo no se escribe de esta forma.');
  }
}

function tamanoMarca(campo: CampoDef, t: string): ResultadoValor {
  if (campo.maximo && [...t].length > campo.maximo) return falla(`Máximo ${campo.maximo} caracteres.`);
  return bien({ texto: t });
}

/** `true` si el valor equivale a "sin valor" (null, texto vacio, marca sin texto). */
export function estaVacio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === 'string') return valor.trim() === '';
  if (Array.isArray(valor)) return valor.length === 0;
  if (esObjeto(valor)) {
    if ('texto' in valor && Object.keys(valor).length === 1) return estaVacio(valor.texto);
    return Object.keys(valor).length === 0;
  }
  return false;
}

function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (esObjeto(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Igualdad por contenido de dos valores JSON (sin importar el orden de las claves). */
export function valoresIguales(a: unknown, b: unknown): boolean {
  return canonico(a) === canonico(b);
}

/** Texto plano de un valor, para busqueda y para exportar. */
export function textoDeValor(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor === PAIS_NO_SE_CONOCE ? 'No se conoce' : valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (esObjeto(valor)) {
    if (typeof valor.texto === 'string') return valor.texto;
    if (valor.sin_marca === true) return 'Sin marca';
    if (valor.no_aplica === true) return 'No aplica';
    if (valor.mismo_fabricante === true) return 'El mismo fabricante';
    if (valor.por_confirmar === true) {
      return typeof valor.nota === 'string' && valor.nota !== '' ? `Por confirmar (${valor.nota})` : 'Por confirmar';
    }
    if (typeof valor.fecha === 'string') return valor.fecha;
    if (typeof valor.valor === 'string') return valor.valor;
    if (typeof valor.nombre === 'string') {
      return typeof valor.organizacion === 'string' ? `${valor.nombre} (${valor.organizacion})` : valor.nombre;
    }
  }
  return '';
}
