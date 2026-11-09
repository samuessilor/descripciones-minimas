import { describe, expect, it } from 'vitest';
import { aplicarGuardado, type GuardadoCampo } from '@/componentes/ficha/guardado-local';
import { camposObligatoriosCliente } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';
import { etiquetaFicha } from '@/dominio/estado';
import type { FichaVista } from '@/server/politicas/referencias';

const AHORA = new Date('2026-11-09T15:00:00Z');
const TIPO = 'INSUMO' as const;
// Un campo obligatorio del area que no alimenta ninguna columna promovida.
const OBLIGATORIO = camposObligatoriosCliente(TIPO).find((c) => !['codigo', 'nombre_producto', 'tipo_producto', 'fecha_solicitud'].includes(c.clave))!.clave;

function fichaCon(valores: Record<string, unknown>, extra: Partial<FichaVista> = {}): FichaVista {
  const completitud = calcularCompletitud({ tipo: TIPO, valores });
  return {
    id: '00000000-0000-4000-8000-000000000001',
    codigo: 'X-1',
    nombreProducto: 'Producto',
    tipoProducto: TIPO,
    estado: 'EN_GESTION',
    archivada: false,
    version: 7,
    fechaSolicitud: '2026-11-01',
    diasEnGestion: 3,
    partida: null,
    creadaPor: 'Edward',
    creadaEn: '2026-11-01T10:00:00.000Z',
    actualizadaEn: '2026-11-08T10:00:00.000Z',
    campos: Object.fromEntries(
      Object.entries(valores).map(([clave, valor]) => [clave, { clave, valor, version: 1, autor: 'Carla', propio: false, instante: '2026-11-08T10:00:00.000Z' }]),
    ),
    completitud,
    etiqueta: 'En gestión',
    color: 'amarillo',
    ...extra,
  };
}

const guardado = (extra: Partial<GuardadoCampo> = {}): GuardadoCampo => ({
  campo: OBLIGATORIO,
  valor: 'Un valor',
  version: 1,
  versionFicha: 8,
  escrito: true,
  ...extra,
});

describe('aplicarGuardado: un guardado propio se ve sin volver a pedir la ficha', () => {
  it('pone el valor, la version del campo y la de la ficha, y recalcula los indicadores de seccion como el servidor', () => {
    const antes = fichaCon({});
    const despues = aplicarGuardado(antes, 7, guardado(), AHORA)!;
    expect(despues).not.toBeNull();
    expect(despues.version).toBe(8);
    expect(despues.actualizadaEn).toBe(AHORA.toISOString());
    expect(despues.campos[OBLIGATORIO]).toMatchObject({ valor: 'Un valor', version: 1, autor: 'Tú', propio: true });
    // Lo mismo que calcularia el servidor con los valores vigentes (calcularCompletitud es la misma funcion).
    expect(despues.completitud).toEqual(calcularCompletitud({ tipo: TIPO, valores: { [OBLIGATORIO]: 'Un valor' } }));
    expect(despues.completitud.area.faltan).toBe(antes.completitud.area.faltan - 1);
    // La ficha de partida no se muta.
    expect(antes.version).toBe(7);
    expect(antes.campos[OBLIGATORIO]).toBeUndefined();
  });

  it('llenar el ultimo obligatorio de una seccion la deja «Completa» sin refrescar', () => {
    const obligatorios = camposObligatoriosCliente(TIPO);
    const valores = Object.fromEntries(obligatorios.map((c) => [c.clave, 'x']));
    const falta = obligatorios.find((c) => !['codigo', 'nombre_producto', 'tipo_producto', 'fecha_solicitud'].includes(c.clave))!;
    delete valores[falta.clave];
    const antes = fichaCon(valores);
    expect(antes.completitud.secciones[falta.seccion].faltan).toBeGreaterThan(0);
    const despues = aplicarGuardado(antes, 7, guardado({ campo: falta.clave }), AHORA)!;
    expect(despues.completitud.secciones[falta.seccion].faltantes).not.toContain(falta.clave);
    expect(despues.completitud.secciones[falta.seccion].faltan).toBe(antes.completitud.secciones[falta.seccion].faltan - 1);
  });

  it('un valor vacio se guarda como null (el campo sigue existiendo con su version) y vuelve a faltar', () => {
    const antes = fichaCon({ [OBLIGATORIO]: 'algo' });
    const despues = aplicarGuardado(antes, 7, guardado({ valor: '  ', version: 2 }), AHORA)!;
    expect(despues.campos[OBLIGATORIO]).toMatchObject({ valor: null, version: 2 });
    expect(despues.completitud.area.faltan).toBe(antes.completitud.area.faltan + 1);
  });

  it('la etiqueta se recalcula con las mismas reglas del dominio, y «Reabierta» (que solo sabe el servidor) se conserva', () => {
    const antes = fichaCon({});
    const despues = aplicarGuardado(antes, 7, guardado(), AHORA)!;
    expect(despues.etiqueta).toBe(
      etiquetaFicha({
        estado: 'EN_GESTION',
        archivada: false,
        reabierta: false,
        finalizada: despues.completitud.finalizada,
        tresSeccionesVerdes: despues.completitud.tresSeccionesVerdes,
        esperaRespuesta: despues.completitud.aduana.faltantes.includes('respuesta_area'),
      }),
    );
    const reabierta = fichaCon({}, { etiqueta: 'Reabierta' });
    expect(aplicarGuardado(reabierta, 7, guardado(), AHORA)!.etiqueta).toBe('Reabierta');
  });

  it('si alguien mas escribio entre medias (la version de la ficha salta) NO lo aplica: hay que releer', () => {
    expect(aplicarGuardado(fichaCon({}), 7, guardado({ versionFicha: 9 }), AHORA)).toBeNull();
    // Una respuesta atrasada tambien: no es la version que se esperaba.
    expect(aplicarGuardado(fichaCon({}), 7, guardado({ versionFicha: 7 }), AHORA)).toBeNull();
  });

  it('dos guardados seguidos se encadenan: cada uno espera la version que dejo el anterior', () => {
    const uno = aplicarGuardado(fichaCon({}), 7, guardado({ versionFicha: 8 }), AHORA)!;
    const otro = camposObligatoriosCliente(TIPO).find((c) => c.clave !== OBLIGATORIO && !['codigo', 'nombre_producto', 'tipo_producto', 'fecha_solicitud'].includes(c.clave))!.clave;
    const dos = aplicarGuardado(uno, uno.version, guardado({ campo: otro, versionFicha: 9 }), AHORA)!;
    expect(dos.version).toBe(9);
    expect(Object.keys(dos.campos).sort()).toEqual([OBLIGATORIO, otro].sort());
  });

  it('los campos que alimentan columnas del servidor (nombre, tipo, codigo, partida, fecha) siempre piden releer', () => {
    for (const campo of ['nombre_producto', 'tipo_producto', 'codigo', 'partida_arancelaria', 'fecha_solicitud']) {
      expect(aplicarGuardado(fichaCon({}), 7, guardado({ campo }), AHORA), campo).toBeNull();
    }
  });

  it('un valor identico al vigente (no escribio nada) no cambia la ficha; si ademas la version no coincide, hay que releer', () => {
    const antes = fichaCon({ [OBLIGATORIO]: 'igual' });
    expect(aplicarGuardado(antes, 7, guardado({ escrito: false, versionFicha: 7 }), AHORA)).toBe(antes);
    expect(aplicarGuardado(antes, 7, guardado({ escrito: false, versionFicha: 9 }), AHORA)).toBeNull();
  });
});
