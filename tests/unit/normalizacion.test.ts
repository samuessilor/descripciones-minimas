import { describe, expect, it } from 'vitest';
import {
  escaparLike,
  normalizarCodigo,
  normalizarTexto,
  tokenizarBusqueda,
} from '@/dominio/normalizacion';

describe('normalizarCodigo (D-27)', () => {
  it('trata como iguales los codigos que difieren solo en separadores', () => {
    const a = normalizarCodigo('B32 10-KIT5');
    expect(a).toBe('B3210KIT5');
    expect(normalizarCodigo('B3210-KIT5')).toBe(a);
    expect(normalizarCodigo('B32-10-KIT5')).toBe(a);
    expect(normalizarCodigo('b32_10.kit5')).toBe(a);
    expect(normalizarCodigo('B32/10 KIT5')).toBe(a);
  });

  it('pasa a mayusculas y recorta espacios', () => {
    expect(normalizarCodigo('  1ga0612a00 ')).toBe('1GA0612A00');
  });

  it('conserva los ceros a la izquierda (los codigos son texto)', () => {
    expect(normalizarCodigo('00123')).toBe('00123');
  });

  it('quita tambien espacios no separables y tabulaciones', () => {
    expect(normalizarCodigo('AB 12\t3')).toBe('AB123');
  });

  it('absorbe caracteres invisibles y variantes Unicode de guion, espacio y ancho completo', () => {
    const base = normalizarCodigo('B32 10-KIT5');
    const variantes = [
      'B3210\u200BKIT5', // espacio de ancho cero (pegado desde Excel o web)
      'B32\u00AD10KIT5', // guion blando
      'B32\u221210KIT5', // signo menos
      'B32\uFF0D10KIT5', // guion de ancho completo
      '\uFF22\uFF13\uFF12\uFF11\uFF10KIT5', // letras y digitos de ancho completo
      'B3210\u2060KIT5', // word joiner
      'B3210\u00B7KIT5', // punto medio
      'B3210\uFEFFKIT5', // BOM
      '\u3000B3210 KIT5', // espacio ideografico
      'B32\u201310\u2014KIT5', // guion medio y raya
      'B3210\u0007KIT5', // caracter de control
    ];
    for (const v of variantes) expect(normalizarCodigo(v), JSON.stringify(v)).toBe(base);
  });

  it('no mezcla codigos realmente distintos', () => {
    expect(normalizarCodigo('10254-KIT')).not.toBe(normalizarCodigo('10254-KIT2'));
  });
});

describe('normalizarTexto (busqueda, D-18)', () => {
  it('pasa a minusculas, quita tildes y colapsa espacios', () => {
    expect(normalizarTexto('  Descripción   MÍNIMA  ')).toBe('descripcion minima');
  });

  it('ignora la tilde de la enie igual que cualquier otra marca', () => {
    expect(normalizarTexto('Año')).toBe('ano');
  });

  it('devuelve cadena vacia ante nulos', () => {
    expect(normalizarTexto(null)).toBe('');
    expect(normalizarTexto(undefined)).toBe('');
  });
});

describe('escaparLike (D-18)', () => {
  it('escapa %, _ y \\ como literales', () => {
    expect(escaparLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });

  it('no toca el resto', () => {
    expect(escaparLike('nsr e1')).toBe('nsr e1');
  });
});

describe('tokenizarBusqueda', () => {
  it('separa en tokens normalizados sin vacios', () => {
    expect(tokenizarBusqueda('  NSR   é1 ')).toEqual(['nsr', 'e1']);
  });

  it('devuelve lista vacia si no hay texto', () => {
    expect(tokenizarBusqueda('   ')).toEqual([]);
  });
});
