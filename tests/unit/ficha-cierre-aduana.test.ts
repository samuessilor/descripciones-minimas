/**
 * Criterio para releer la zona de la aduana tras un guardado propio aplicado en local (cierre-aduana.ts): solo cuando
 * cambia la lista de campos que faltan, que es lo unico de lo que depende el resumen de cierre (advertencia A1).
 */
import { describe, expect, it } from 'vitest';
import { cambiaElResumenDeCierre } from '@/componentes/ficha/cierre-aduana';
import { camposObligatoriosCliente, CAMPOS, TIPOS_PRODUCTO, type TipoProducto } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';

const TIPO = 'INSUMO' as const;
const completitud = (valores: Record<string, unknown>, tipo: TipoProducto = TIPO) => calcularCompletitud({ tipo, valores });
const OBLIGATORIO = camposObligatoriosCliente(TIPO).find((c) => c.soloSi === undefined)!.clave;
// Un campo del area que es OPCIONAL para algun tipo (la matriz de campos decide cual).
const OPCIONAL = (() => {
  for (const tipo of TIPOS_PRODUCTO) {
    const c = CAMPOS.find((x) => x.grupo === 'C' && x.reglas[tipo] === 'P' && x.soloSi === undefined && x.tipoDato === 'texto_largo');
    if (c) return { tipo, clave: c.clave };
  }
  throw new Error('No hay un campo opcional del area en la matriz');
})();

describe('cambiaElResumenDeCierre', () => {
  it('llenar un campo obligatorio que estaba vacio cambia lo que falta: hay que releer', () => {
    expect(cambiaElResumenDeCierre(completitud({}), completitud({ [OBLIGATORIO]: 'x' }))).toBe(true);
  });

  it('vaciar un obligatorio que estaba lleno tambien lo cambia', () => {
    expect(cambiaElResumenDeCierre(completitud({ [OBLIGATORIO]: 'x' }), completitud({ [OBLIGATORIO]: '' }))).toBe(true);
  });

  it('retocar el texto de un obligatorio ya lleno NO cambia lo que falta: no se relee', () => {
    expect(cambiaElResumenDeCierre(completitud({ [OBLIGATORIO]: 'x' }), completitud({ [OBLIGATORIO]: 'xy' }))).toBe(false);
  });

  it('editar un campo opcional NO cambia lo que falta: no se relee', () => {
    expect(cambiaElResumenDeCierre(completitud({}, OPCIONAL.tipo), completitud({ [OPCIONAL.clave]: 'algo' }, OPCIONAL.tipo))).toBe(false);
  });

  it('cambia aunque el conteo sea igual si lo que falta es otro campo (se llena uno y se vacia otro)', () => {
    const [a, b] = camposObligatoriosCliente(TIPO).filter((c) => c.soloSi === undefined).map((c) => c.clave);
    const antes = completitud({ [a!]: 'x' });
    const despues = completitud({ [b!]: 'x' });
    expect(antes.area.faltan).toBe(despues.area.faltan);
    expect(cambiaElResumenDeCierre(antes, despues)).toBe(true);
  });
});
