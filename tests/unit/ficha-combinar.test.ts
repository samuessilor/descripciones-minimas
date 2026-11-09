/** «Combinar» de un choque: reglas puras del formulario de la ficha. */
import { describe, expect, it } from 'vitest';
import { combinarTextos } from '@/componentes/ficha/formato';

describe('combinarTextos', () => {
  it('en un campo de varias lineas separa con salto de linea', () => {
    expect(combinarTextos({ tipoDato: 'texto_largo' }, 'Uso de Edward', 'Uso de Charles')).toBe('Uso de Edward\nUso de Charles');
  });
  it('en un campo de una linea no pega los textos: los separa con « / »', () => {
    expect(combinarTextos({ tipoDato: 'texto' }, 'Fabricante de Edward', 'Fabricante de Charles')).toBe('Fabricante de Edward / Fabricante de Charles');
    expect(combinarTextos({ tipoDato: 'marca' }, 'NAGA', 'NAGA Pro')).toBe('NAGA / NAGA Pro');
  });
  it('si uno de los dos esta vacio no deja separadores sueltos', () => {
    expect(combinarTextos({ tipoDato: 'texto' }, '', 'solo mio')).toBe('solo mio');
    expect(combinarTextos({ tipoDato: 'texto' }, 'solo otro', '  ')).toBe('solo otro');
  });
});
