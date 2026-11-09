/**
 * Numeros y cantidades (6.3, D-32, RV-40). Parser aritmetico propio, NUNCA `eval`.
 *
 * Gramatica: digitos; decimales con punto o coma; operadores `+ - * / ( )` y tambien `x`, `X` y
 * `×` (se leen como `*`); espacios. Sin separador de miles. Un literal con UN separador seguido
 * de exactamente 3 digitos (`1.374`, `1,374`) es ambiguo: no se adivina, se pide elegir. Con dos o mas
 * separadores (`1.234,56`) el ultimo es el decimal si lo siguen 1-2 o 4-6 digitos y el resto son miles.
 * La aritmetica es exacta (fracciones con BigInt): no hay errores de coma flotante.
 */

export type CodigoNumero =
  | 'VACIO'
  | 'SINTAXIS'
  | 'AMBIGUO'
  | 'MILES'
  | 'DECIMALES'
  | 'NO_POSITIVO'
  | 'NEGATIVO'
  | 'DIVISION_CERO';

export type Desambiguacion = 'decimal' | 'entero';

export interface OpcionAmbigua {
  clave: Desambiguacion;
  /** Valor resultante de esa lectura, en cadena decimal con punto. */
  valor: string;
  /** Texto para el boton de la interfaz (decimal con coma, es-CO). */
  texto: string;
}

export type ResultadoNumero =
  | { ok: true; valor: string; expresion: string; interpretacion: string }
  | {
      ok: false;
      codigo: CodigoNumero;
      mensaje: string;
      literal?: string;
      opciones?: OpcionAmbigua[];
    };

export interface OpcionesNumero {
  desambiguar?: Desambiguacion;
}

const DECIMALES_MAX = 6;
const ESCALA = 10n ** BigInt(DECIMALES_MAX);
const LARGO_MAX = 200;

interface Fraccion {
  n: bigint;
  d: bigint;
}

class ErrorNumero extends Error {
  constructor(
    readonly codigo: CodigoNumero,
    mensaje: string,
    readonly extra: { literal?: string; opciones?: OpcionAmbigua[] } = {},
  ) {
    super(mensaje);
  }
}

function mcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

function fraccion(n: bigint, d: bigint): Fraccion {
  if (d === 0n) throw new ErrorNumero('DIVISION_CERO', 'No se puede dividir por cero.');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = mcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}

type Token =
  | { t: 'num'; v: Fraccion; texto: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' }
  | { t: 'par'; v: '(' | ')' };

function aTexto(f: Fraccion, conComa: boolean): string {
  // Solo se llama con fracciones que caben en 6 decimales.
  const negativo = f.n < 0n;
  const abs = negativo ? -f.n : f.n;
  const escalado = abs * (ESCALA / f.d);
  const entera = escalado / ESCALA;
  const frac = (escalado % ESCALA).toString().padStart(DECIMALES_MAX, '0').replace(/0+$/, '');
  const sep = conComa ? ',' : '.';
  const cuerpo = frac === '' ? entera.toString() : `${entera}${sep}${frac}`;
  return negativo && escalado !== 0n ? `-${cuerpo}` : cuerpo;
}

function opcionesPara(literal: string): OpcionAmbigua[] {
  const digitos = literal.replace(/[.,]/g, '');
  const k = 3;
  const entera = digitos.slice(0, digitos.length - k);
  const decimal = `${entera}.${digitos.slice(digitos.length - k)}`;
  const entero = digitos;
  return [
    { clave: 'decimal', valor: decimal, texto: `${entera},${digitos.slice(digitos.length - k)}` },
    { clave: 'entero', valor: entero, texto: entero },
  ];
}

const errorDecimales = () =>
  new ErrorNumero('DECIMALES', `Usa como máximo ${DECIMALES_MAX} decimales. No redondeamos por ti.`);

/**
 * Dos o mas separadores (6.3, D-32): el ULTIMO es el decimal solo si lo siguen 1 a 2 digitos o 4 a 6; los
 * anteriores deben ser miles bien agrupados (1 a 3 digitos y luego grupos de 3, todos con el mismo caracter y
 * distinto del decimal). En cualquier otro caso no se adivina: se pide aclarar.
 */
function leerConMiles(literal: string): Fraccion {
  const aclarar = () =>
    new ErrorNumero('MILES', `No entendí «${literal}». Aclara el número sin separador de miles, por ejemplo 1234,56 o 1234.56.`, {
      literal,
    });
  const idx = Math.max(literal.lastIndexOf('.'), literal.lastIndexOf(','));
  const sepDecimal = literal.charAt(idx);
  const decimales = literal.slice(idx + 1);
  const parteMiles = literal.slice(0, idx);
  const grupos = parteMiles.split(/[.,]/);
  const sepMiles = parteMiles.match(/[.,]/g) ?? [];
  if (decimales.length > DECIMALES_MAX) throw errorDecimales();
  const decimalValido = decimales.length <= 2 || decimales.length >= 4;
  const primero = grupos[0] ?? '';
  const milesValidos =
    sepMiles.every((s) => s === sepMiles[0] && s !== sepDecimal) &&
    primero.length >= 1 &&
    primero.length <= 3 &&
    grupos.slice(1).every((g) => g.length === 3);
  if (!decimalValido || !milesValidos) throw aclarar();
  return fraccion(BigInt(grupos.join('') + decimales), 10n ** BigInt(decimales.length));
}

function leerLiteral(literal: string, desambiguar?: Desambiguacion): Fraccion {
  const separadores = literal.match(/[.,]/g) ?? [];
  if (separadores.length === 0) return fraccion(BigInt(literal), 1n);
  if (separadores.length >= 2) return leerConMiles(literal);
  const [parteEntera = '', parteDecimal = ''] = literal.split(/[.,]/);
  // Se cuentan los decimales ESCRITOS antes de reducir la fraccion: `1,0000000` no se cuela como `1`.
  if (parteDecimal.length > DECIMALES_MAX) throw errorDecimales();
  if (parteDecimal.length === 3 && desambiguar === undefined) {
    throw new ErrorNumero('AMBIGUO', `¿Quisiste decir ${parteEntera},${parteDecimal} o ${parteEntera}${parteDecimal}?`, {
      literal,
      opciones: opcionesPara(literal),
    });
  }
  if (parteDecimal.length === 3 && desambiguar === 'entero') {
    return fraccion(BigInt(parteEntera + parteDecimal), 1n);
  }
  return fraccion(BigInt(parteEntera + parteDecimal), 10n ** BigInt(parteDecimal.length));
}

function tokenizar(texto: string, desambiguar?: Desambiguacion): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < texto.length) {
    const c = texto[i] as string;
    if (/\s/u.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(?:[.,]\d+)*/.exec(texto.slice(i));
      const literal = (m as RegExpExecArray)[0];
      tokens.push({ t: 'num', v: leerLiteral(literal, desambiguar), texto: literal });
      i += literal.length;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ t: 'op', v: c });
    } else if (c === 'x' || c === 'X' || c === '×') {
      tokens.push({ t: 'op', v: '*' });
    } else if (c === '(' || c === ')') {
      tokens.push({ t: 'par', v: c });
    } else {
      throw new ErrorNumero('SINTAXIS', 'Escribe solo números y operaciones (+ − × ÷), por ejemplo 13x12.');
    }
    i++;
  }
  return tokens;
}

function evaluar(tokens: Token[], soloLiteral: boolean): Fraccion {
  let pos = 0;
  const sintaxis = () => new ErrorNumero('SINTAXIS', soloLiteral ? 'Escribe solo el número.' : 'No entendí la operación.');

  const mirar = () => tokens[pos];

  function primario(): Fraccion {
    const tk = mirar();
    if (!tk) throw sintaxis();
    if (tk.t === 'num') {
      pos++;
      return tk.v;
    }
    if (tk.t === 'par' && tk.v === '(' && !soloLiteral) {
      pos++;
      const v = expresion();
      const cierre = mirar();
      if (!cierre || cierre.t !== 'par' || cierre.v !== ')') throw sintaxis();
      pos++;
      return v;
    }
    throw sintaxis();
  }

  function unario(): Fraccion {
    const tk = mirar();
    if (tk && tk.t === 'op' && (tk.v === '+' || tk.v === '-')) {
      pos++;
      const v = unario();
      return tk.v === '-' ? fraccion(-v.n, v.d) : v;
    }
    return primario();
  }

  function termino(): Fraccion {
    let acc = unario();
    for (;;) {
      const tk = mirar();
      if (!tk || tk.t !== 'op' || (tk.v !== '*' && tk.v !== '/')) return acc;
      if (soloLiteral) throw sintaxis();
      pos++;
      const der = unario();
      acc = tk.v === '*' ? fraccion(acc.n * der.n, acc.d * der.d) : fraccion(acc.n * der.d, acc.d * der.n);
    }
  }

  function expresion(): Fraccion {
    let acc = termino();
    for (;;) {
      const tk = mirar();
      if (!tk || tk.t !== 'op' || (tk.v !== '+' && tk.v !== '-')) return acc;
      if (soloLiteral) throw sintaxis();
      pos++;
      const der = termino();
      acc =
        tk.v === '+'
          ? fraccion(acc.n * der.d + der.n * acc.d, acc.d * der.d)
          : fraccion(acc.n * der.d - der.n * acc.d, acc.d * der.d);
    }
  }

  const resultado = expresion();
  if (pos !== tokens.length) throw sintaxis();
  return resultado;
}

function formatoVisible(valor: string): string {
  return valor.replace('.', ',');
}

function procesar(
  texto: string,
  modo: 'cantidad' | 'valor',
  opciones: OpcionesNumero,
): ResultadoNumero {
  const expresion = texto.trim();
  if (expresion === '') return { ok: false, codigo: 'VACIO', mensaje: 'Escribe un valor.' };
  if (expresion.length > LARGO_MAX) {
    return { ok: false, codigo: 'SINTAXIS', mensaje: 'La operación es demasiado larga.' };
  }
  try {
    const tokens = tokenizar(expresion, opciones.desambiguar);
    const f = evaluar(tokens, modo === 'valor');
    if (modo === 'cantidad' && f.n <= 0n) {
      return { ok: false, codigo: 'NO_POSITIVO', mensaje: 'La cantidad debe ser mayor que cero.' };
    }
    if (modo === 'valor' && f.n < 0n) {
      return { ok: false, codigo: 'NEGATIVO', mensaje: 'El valor no puede ser negativo.' };
    }
    if (ESCALA % f.d !== 0n) {
      return {
        ok: false,
        codigo: 'DECIMALES',
        mensaje: `Usa como máximo ${DECIMALES_MAX} decimales. No redondeamos por ti.`,
      };
    }
    const valor = aTexto(f, false);
    const interpretacion =
      modo === 'valor' ? `= ${formatoVisible(valor)} USD` : `= ${formatoVisible(valor)}`;
    return { ok: true, valor, expresion, interpretacion };
  } catch (e) {
    if (e instanceof ErrorNumero) {
      return { ok: false, codigo: e.codigo, mensaje: e.message, ...e.extra };
    }
    throw e;
  }
}

/** Cantidad a radicar: resultado mayor que cero; acepta expresiones (`13*12`). */
export function parsearCantidad(texto: string, opciones: OpcionesNumero = {}): ResultadoNumero {
  return procesar(texto, 'cantidad', opciones);
}

/** Valor unitario (USD): un solo numero, no negativo, hasta 6 decimales. */
export function parsearValorUnitario(texto: string, opciones: OpcionesNumero = {}): ResultadoNumero {
  return procesar(texto, 'valor', opciones);
}
