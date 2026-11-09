import { describe, expect, it } from 'vitest';
import { construirTextoBusqueda, prefijoPartida } from '@/dominio/busqueda';

describe('texto de busqueda (6.4, D-18)', () => {
  it('concatena codigo, nombre, descripcion, marca, proveedor, fabricante, partida y maquina, normalizado', () => {
    const t = construirTextoBusqueda({
      codigo: 'B32 10-KIT5',
      nombreProducto: 'Chuck inferior PEQUEÑO',
      partida: '8466.20.00.00',
      valores: {
        descripcion_factura: 'Chuck Inferior',
        marca: { texto: 'ACME' },
        proveedor: 'Proveedor Ñandú',
        fabricante: 'Fábrica SA',
        maquina_destino: 'Biseladora Mei 641',
      },
    });
    expect(t).toBe(
      'b32 10-kit5 b3210kit5 chuck inferior pequeno chuck inferior acme proveedor nandu fabrica sa 8466.20.00.00 biseladora mei 641',
    );
  });

  it('el codigo normalizado permite encontrar variantes sin separadores', () => {
    const t = construirTextoBusqueda({ codigo: '10254-KIT', nombreProducto: 'Filtro absoluto', partida: null, valores: {} });
    expect(t.split(' ')).toContain('10254kit');
  });

  it('tolera campos vacios y marca "sin marca"', () => {
    const t = construirTextoBusqueda({
      codigo: 'X1',
      nombreProducto: 'Algo',
      partida: null,
      valores: { marca: { sin_marca: true } },
    });
    expect(t).toBe('x1 x1 algo sin marca');
  });
});

describe('prefijo de partida (L3)', () => {
  it('quita puntos, espacios y guiones y deja solo digitos', () => {
    expect(prefijoPartida('8421.39')).toBe('842139');
    expect(prefijoPartida('8421-39-90-00')).toBe('8421399000');
    expect(prefijoPartida(' 8421 ')).toBe('8421');
  });

  it('lo que no es partida da vacio (el filtro se ignora)', () => {
    expect(prefijoPartida('')).toBe('');
    expect(prefijoPartida('84a1')).toBe('');
    expect(prefijoPartida('12345678901')).toBe('');
  });
});
