import { describe, expect, it } from 'vitest';
import { parsearComposicion, serializarComposicion, sumarComposicion } from '@/componentes/ficha/composicion';

describe('composicion con porcentajes (02-ux-ui 4.5)', () => {
  it('separa componente y rango o valor puntual', () => {
    expect(parsearComposicion('1-metoxi-2-propanol, 50 - 75 %')).toEqual([{ componente: '1-metoxi-2-propanol', desde: '50', hasta: '75' }]);
    expect(parsearComposicion('Tensioactivos anionicos (6 %)')).toEqual([{ componente: 'Tensioactivos anionicos', desde: '6', hasta: '' }]);
    expect(parsearComposicion('Alcoholes C8-10: 2,5 a 10 %')).toEqual([{ componente: 'Alcoholes C8-10', desde: '2,5', hasta: '10' }]);
  });

  it('una linea sin porcentaje se queda como componente, y las vacias se descartan', () => {
    expect(parsearComposicion('Agua\n\n  \nMezcla de alcoholes (ejemplo)')).toEqual([
      { componente: 'Agua', desde: '', hasta: '' },
      { componente: 'Mezcla de alcoholes (ejemplo)', desde: '', hasta: '' },
    ]);
  });

  it('ida y vuelta: el texto libre se puede ver como tabla y volver sin perder nada', () => {
    const texto = 'Agua, 80 %\nAlcohol isopropilico, 10 - 20 %\nColorante';
    expect(serializarComposicion(parsearComposicion(texto))).toBe(texto);
  });

  it('serializar ignora filas totalmente vacias y escribe un valor igual en desde y hasta como puntual', () => {
    expect(
      serializarComposicion([
        { componente: '', desde: '', hasta: '' },
        { componente: 'Sal', desde: '5', hasta: '5' },
        { componente: 'Agua', desde: '', hasta: '80' },
      ]),
    ).toBe('Sal, 5 %\nAgua, 80 %');
  });

  it('un numero con una coma decimal se conserva tal cual lo escribio la persona', () => {
    expect(serializarComposicion([{ componente: 'X', desde: '2,5', hasta: '' }])).toBe('X, 2,5 %');
  });

  describe('suma suave: solo error si los minimos pasan de 100 %', () => {
    it('sin porcentajes no dice nada', () => {
      expect(sumarComposicion([{ componente: 'Agua', desde: '', hasta: '' }]).nivel).toBe('ninguno');
    });
    it('los minimos que pasan de 100 % son error', () => {
      const r = sumarComposicion([
        { componente: 'A', desde: '60', hasta: '' },
        { componente: 'B', desde: '50', hasta: '' },
      ]);
      expect(r.nivel).toBe('error');
      expect(r.minimos).toBe(110);
      expect(r.mensaje).toContain('más de 100 %');
    });
    it('los maximos bajo 100 % solo informan (puede ser agua u otros)', () => {
      const r = sumarComposicion([{ componente: 'A', desde: '50', hasta: '75' }]);
      expect(r.nivel).toBe('info');
      expect(r.mensaje).toContain('Falta completar hasta 100 %');
    });
    it('rangos que permiten llegar a 100 % quedan bien', () => {
      const r = sumarComposicion([
        { componente: 'A', desde: '50', hasta: '75' },
        { componente: 'B', desde: '5', hasta: '30' },
      ]);
      expect(r.nivel).toBe('ok');
      expect(r.minimos).toBe(55);
      expect(r.maximos).toBe(105);
    });
    it('entiende la coma decimal', () => {
      expect(sumarComposicion([{ componente: 'A', desde: '2,5', hasta: '10' }]).minimos).toBeCloseTo(2.5);
    });
  });
});
