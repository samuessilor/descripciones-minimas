import { describe, expect, it } from 'vitest';
import { parsearCantidad, parsearValorUnitario } from '@/dominio/cantidad';

function ok(r: ReturnType<typeof parsearCantidad>) {
  if (!r.ok) throw new Error(`se esperaba ok y fue ${r.codigo}: ${r.mensaje}`);
  return r;
}

describe('cantidad a radicar (6.3, D-32, CA-27)', () => {
  it('evalua 13*12 y guarda resultado y expresion', () => {
    const r = ok(parsearCantidad('13*12'));
    expect(r.valor).toBe('156');
    expect(r.expresion).toBe('13*12');
    expect(r.interpretacion).toBe('= 156');
  });

  it('lee x y la multiplicacion como *', () => {
    expect(ok(parsearCantidad('13x12')).valor).toBe('156');
    expect(ok(parsearCantidad('13 X 12')).valor).toBe('156');
    expect(ok(parsearCantidad('13×12')).valor).toBe('156');
  });

  it('acepta decimales con coma: 2,5*4 = 10', () => {
    expect(ok(parsearCantidad('2,5*4')).valor).toBe('10');
  });

  it('respeta precedencia y parentesis', () => {
    expect(ok(parsearCantidad('2+3*4')).valor).toBe('14');
    expect(ok(parsearCantidad('(2+3)*4')).valor).toBe('20');
    expect(ok(parsearCantidad('100/8')).valor).toBe('12.5');
  });

  it('acepta un numero simple con espacios', () => {
    expect(ok(parsearCantidad('  25000 ')).valor).toBe('25000');
  });

  it('rechaza texto, punto y coma y codigo', () => {
    for (const mala of ['abc', '1;2', '__import__', '2**3', '13*', '(1+2', 'console.log(1)', '1 2']) {
      const r = parsearCantidad(mala);
      expect(r.ok, mala).toBe(false);
      if (!r.ok) expect(r.codigo, mala).toBe('SINTAXIS');
    }
  });

  it('rechaza vacio', () => {
    const r = parsearCantidad('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('VACIO');
  });

  it('rechaza resultado cero o negativo', () => {
    for (const t of ['0', '5-5', '3-10', '-4']) {
      const r = parsearCantidad(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.codigo, t).toBe('NO_POSITIVO');
    }
  });

  it('rechaza la division por cero', () => {
    const r = parsearCantidad('5/0');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('DIVISION_CERO');
  });

  it('rechaza resultados con mas de 6 decimales exactos', () => {
    const r = parsearCantidad('10/3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('DECIMALES');
  });

  it('1.374 es ambiguo: no adivina y ofrece las dos lecturas', () => {
    const r = parsearCantidad('1.374');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codigo).toBe('AMBIGUO');
      expect(r.opciones?.map((o) => [o.clave, o.valor])).toEqual([
        ['decimal', '1.374'],
        ['entero', '1374'],
      ]);
    }
  });

  it('el usuario resuelve la ambiguedad', () => {
    expect(ok(parsearCantidad('1.374', { desambiguar: 'decimal' })).valor).toBe('1.374');
    expect(ok(parsearCantidad('1,374', { desambiguar: 'entero' })).valor).toBe('1374');
  });

  it('dos o mas separadores: el ultimo es el decimal si lo siguen 1-2 o 4-6 digitos (6.3, D-32)', () => {
    expect(ok(parsearCantidad('1.234,56')).valor).toBe('1234.56');
    expect(ok(parsearCantidad('1,234.56')).valor).toBe('1234.56');
    expect(ok(parsearCantidad('1.234,5')).valor).toBe('1234.5');
    expect(ok(parsearCantidad('1.234.567,8901')).valor).toBe('1234567.8901');
    expect(ok(parsearCantidad('1.234,56')).interpretacion).toBe('= 1234,56');
    expect(ok(parsearValorUnitario('12.345,678901')).valor).toBe('12345.678901');
  });

  it('dos o mas separadores en otro caso: se pide aclarar y no se adivina', () => {
    for (const literal of ['1.234.567', '1,234,567', '1.234,567', '1.23.456,78', '1.234.56', '1.2345,67', '12.34,56']) {
      const r = parsearCantidad(literal);
      expect(r.ok, literal).toBe(false);
      if (!r.ok) {
        expect(r.codigo, literal).toBe('MILES');
        expect(r.mensaje, literal).toMatch(/aclara|Escribe/i);
      }
    }
  });

  it('mas de 6 decimales escritos es error aunque los sobrantes sean ceros', () => {
    for (const literal of ['1,0000000', '2.5000000', '0,1234567']) {
      const r = parsearCantidad(literal);
      expect(r.ok, literal).toBe(false);
      if (!r.ok) expect(r.codigo, literal).toBe('DECIMALES');
    }
    const v = parsearValorUnitario('1,0000000');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.codigo).toBe('DECIMALES');
    expect(ok(parsearValorUnitario('1,000000')).valor).toBe('1');
  });

  it('un numero con un separador y 2 o 4 decimales no es ambiguo', () => {
    expect(ok(parsearCantidad('1.37')).valor).toBe('1.37');
    expect(ok(parsearCantidad('1,3742')).valor).toBe('1.3742');
  });
});

describe('valor unitario (6.3, CA-27)', () => {
  it('137.74 y 137,74 valen lo mismo', () => {
    const a = parsearValorUnitario('137.74');
    const b = parsearValorUnitario('137,74');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.valor).toBe('137.74');
      expect(b.valor).toBe('137.74');
      expect(b.interpretacion).toBe('= 137,74 USD');
    }
  });

  it('acepta cero y hasta 6 decimales', () => {
    const a = parsearValorUnitario('0');
    expect(a.ok).toBe(true);
    const b = parsearValorUnitario('0,123456');
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.valor).toBe('0.123456');
  });

  it('rechaza mas de 6 decimales sin redondear en silencio', () => {
    const r = parsearValorUnitario('0,1234567');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('DECIMALES');
  });

  it('1.374 pregunta cual se quiso decir y no guarda hasta elegir', () => {
    const r = parsearValorUnitario('1.374');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('AMBIGUO');
    const d = parsearValorUnitario('1.374', { desambiguar: 'decimal' });
    expect(d.ok && d.interpretacion).toBe('= 1,374 USD');
    const e = parsearValorUnitario('1.374', { desambiguar: 'entero' });
    expect(e.ok && e.valor).toBe('1374');
  });

  it('no acepta operaciones ni negativos', () => {
    const r = parsearValorUnitario('10*2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.codigo).toBe('SINTAXIS');
    const n = parsearValorUnitario('-3');
    expect(n.ok).toBe(false);
    if (!n.ok) expect(n.codigo).toBe('NEGATIVO');
  });

  it('quita ceros sobrantes del decimal pero conserva el valor exacto', () => {
    const r = parsearValorUnitario('12,50');
    expect(r.ok && r.valor).toBe('12.5');
  });
});
