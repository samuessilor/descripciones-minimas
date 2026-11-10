/**
 * Lectura de una fila del Excel del historico (`interpretarFila`): mismas reglas que la ficha, equivalencias de texto
 * (mayusculas, tildes, nombres de pais) y la diferencia entre lo que bloquea una fila (error) y lo que solo se avisa.
 */
import { describe, expect, it } from 'vitest';
import { NOTA_HISTORICO } from '@/dominio/historico-importado';
import { columnaPorEncabezado, COLUMNAS_HISTORICO, fechaDeCelda, interpretarFila, type Celda, type ContextoImportacion } from '@/dominio/plantilla-historico';

const ctx: ContextoImportacion = {
  hoy: '2026-11-10',
  catalogos: { unidad_medida: ['Litros', 'Kilogramos', 'Unidades'], aspecto_fisico: ['Líquido', 'Sólido'] },
};

const base: Record<string, Celda> = {
  codigo: 'IMP-001',
  nombre_producto: 'RESINA EPOXICA',
  tipo_producto: 'Insumo',
  fecha_solicitud: '15/03/2025',
};

const leer = (extra: Record<string, Celda> = {}) => interpretarFila(2, { ...base, ...extra }, ctx);

function valor(r: ReturnType<typeof leer>, campo: string): unknown {
  if (!r.ok) throw new Error(`la fila no es valida: ${r.errores.join(' | ')}`);
  return r.fila.valores.find(([c]) => c === campo)?.[1];
}

describe('fechaDeCelda', () => {
  it('acepta fechas de Excel, numeros de serie y textos dia/mes/año', () => {
    expect(fechaDeCelda(new Date(Date.UTC(2025, 2, 15)))).toBe('2025-03-15');
    expect(fechaDeCelda('15/03/2025')).toBe('2025-03-15');
    expect(fechaDeCelda('5-3-2025')).toBe('2025-03-05');
    expect(fechaDeCelda('2025-03-15')).toBe('2025-03-15');
    expect(fechaDeCelda(45731)).toBe('2025-03-15'); // numero de serie de Excel
  });
  it('rechaza lo que no es una fecha real', () => {
    expect(fechaDeCelda('31/02/2025')).toBeNull();
    expect(fechaDeCelda('ayer')).toBeNull();
    expect(fechaDeCelda('')).toBeNull();
    expect(fechaDeCelda(null)).toBeNull();
  });
});

describe('columnas', () => {
  it('reconoce los encabezados de la plantilla, sus alias y los de la hoja Base exportada, sin importar mayusculas ni tildes', () => {
    expect(columnaPorEncabezado('CÓDIGO')?.clave).toBe('codigo');
    expect(columnaPorEncabezado('Máquina donde se instala')?.clave).toBe('maquina_destino');
    expect(columnaPorEncabezado('¿Requiere registro de importación (RIM)?')?.clave).toBe('requiere_rim');
    expect(columnaPorEncabezado('Partida arancelaria final')?.clave).toBe('partida_arancelaria');
    expect(columnaPorEncabezado('Días en gestión')).toBeNull();
  });
  it('un encabezado por columna y los indispensables son exactamente cuatro', () => {
    expect(new Set(COLUMNAS_HISTORICO.map((c) => c.clave)).size).toBe(COLUMNAS_HISTORICO.length);
    expect(COLUMNAS_HISTORICO.filter((c) => c.requerida).map((c) => c.clave)).toEqual(['codigo', 'nombre_producto', 'tipo_producto', 'fecha_solicitud']);
  });
});

describe('interpretarFila: el codigo y las celdas que Excel estropea', () => {
  it('un codigo numerico entra con aviso (puede haber perdido ceros); una fecha o un Si/No como codigo es error', () => {
    const num = interpretarFila(2, { ...base, codigo: 123 }, ctx);
    expect(num.ok && num.fila.codigo).toBe('123');
    expect(num.ok && num.avisos.join(' ')).toContain('llegó como número');
    for (const malo of [new Date(Date.UTC(2025, 11, 10)), true]) {
      const r = interpretarFila(2, { ...base, codigo: malo }, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errores.join(' ')).toContain('Formatea la columna Código como Texto');
    }
  });

  it('limpia caracteres de control del codigo y rechaza saltos de linea y tabulaciones', () => {
    const nul = interpretarFila(2, { ...base, codigo: 'AB\u0000CD' }, ctx);
    expect(nul.ok && nul.fila.codigo).toBe('ABCD');
    for (const malo of ['AB\nCD', 'AB\tCD']) expect(interpretarFila(2, { ...base, codigo: malo }, ctx).ok).toBe(false);
  });

  it('una partida que llega como fecha es error; una celda con formula sin valor o con error de Excel no se toma por vacia', () => {
    expect(leer({ partida_arancelaria: new Date(Date.UTC(2025, 0, 1)) }).ok).toBe(false);
    const f = leer({ uso: { invalida: 'formula' }, fabricante: { invalida: '#N/A' } });
    expect(f.ok).toBe(false);
    if (!f.ok) {
      expect(f.errores.filter((e) => e.includes('fórmula sin valor calculado'))).toHaveLength(2);
      expect(f.errores.join(' ')).toContain('Uso del producto:');
    }
    // Un codigo con formula sin valor da ese error y no el de «falta el codigo».
    const c = interpretarFila(2, { ...base, codigo: { invalida: 'formula' } }, ctx);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.errores.join(' ')).not.toContain('Falta el código');
  });
});

describe('interpretarFila', () => {
  it('con solo lo indispensable es valida: avisa lo que falta y no inventa datos', () => {
    const r = leer();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fila.tipo).toBe('INSUMO');
    expect(r.fila.fechaSolicitud).toBe('2025-03-15');
    expect(r.fila.fechaClasificacion).toBe('2025-03-15');
    expect(r.fila.sinFechaClasificacion).toBe(true);
    expect(r.fila.codigoNorm).toBe('IMP001');
    expect(r.fila.faltantes).toContain('Uso del producto');
    expect(r.fila.faltantes).toContain('Partida arancelaria');
    expect(r.avisos.some((a) => a.startsWith('Le faltan'))).toBe(true);
    // Sin informacion adicional se deja constancia de donde viene la referencia.
    expect(valor(r, 'informacion_adicional')).toBe(NOTA_HISTORICO);
    // Los datos de creacion van primero y en este orden.
    expect(r.fila.valores.slice(0, 4).map(([c]) => c)).toEqual(['codigo', 'nombre_producto', 'tipo_producto', 'fecha_solicitud']);
  });

  it('entiende los valores como se escriben a mano: sin tildes, en minusculas, con el nombre del pais', () => {
    const r = leer({
      unidad_medida: 'kilogramos',
      aspecto_fisico: 'liquido',
      pais_origen: 'FRANCIA',
      reembolsable: 'si',
      tipo_empaque: 'bidon',
      cantidad_empaque: '20 litros',
      requiere_rim: 'no',
      partida_arancelaria: 8421390000,
      area_responsable: 'consumibles',
      marca: 'Sin marca',
      proveedor: 'el mismo fabricante',
    });
    expect(valor(r, 'unidad_medida')).toBe('Kilogramos');
    expect(valor(r, 'aspecto_fisico')).toBe('Líquido');
    expect(valor(r, 'pais_origen')).toBe('FR');
    expect(valor(r, 'reembolsable')).toBe('Sí');
    expect(valor(r, 'tipo_empaque')).toBe('Bidón');
    expect(valor(r, 'cantidad_empaque')).toBe('20 litros');
    expect(valor(r, 'requiere_rim')).toBe('NO');
    expect(valor(r, 'partida_arancelaria')).toBe('8421.39.00.00');
    expect(valor(r, 'area_responsable')).toBe('Consumibles');
    expect(valor(r, 'marca')).toEqual({ sin_marca: true });
    expect(valor(r, 'proveedor')).toEqual({ mismo_fabricante: true });
    if (r.ok) expect(r.fila.partida).toBe('8421.39.00.00');
  });

  it('«No aplica» solo en los campos que lo admiten', () => {
    const r = leer({ restricciones: 'No aplica', observaciones_aduana: 'N/A', descripciones_minimas: 'No es necesario por ahora', aspecto_fisico: 'no aplica' });
    expect(valor(r, 'restricciones')).toEqual({ no_aplica: true });
    expect(valor(r, 'observaciones_aduana')).toEqual({ no_aplica: true });
    expect(valor(r, 'descripciones_minimas')).toEqual({ no_aplica: true });
    expect(valor(r, 'aspecto_fisico')).toEqual({ no_aplica: true });
    // Un campo de texto comun que dice «No aplica» sigue siendo texto: ahi no hay marca.
    expect(valor(leer({ uso: 'No aplica' }), 'uso')).toBe('No aplica');
  });

  it('el contenido por empaque solo cuenta con bidon o paquete; los campos que no son del tipo se ignoran con aviso', () => {
    const r = leer({ tipo_empaque: 'Unidad', cantidad_empaque: '5', maquina_destino: 'Aspiradora', fecha_fabricacion: '01/01/2024' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fila.valores.map(([c]) => c)).not.toContain('cantidad_empaque');
    expect(r.fila.valores.map(([c]) => c)).not.toContain('maquina_destino');
    expect(r.fila.valores.map(([c]) => c)).not.toContain('fecha_fabricacion');
    expect(r.avisos.filter((a) => a.includes('se ignoró')).length).toBe(3);
  });

  it('fecha de fabricacion: fecha o «Por confirmar», solo en equipos', () => {
    const equipo = { tipo_producto: 'Equipo/Máquina' } as const;
    expect(valor(leer({ ...equipo, fecha_fabricacion: 'Por confirmar' }), 'fecha_fabricacion')).toEqual({ por_confirmar: true, nota: '' });
    expect(valor(leer({ ...equipo, fecha_fabricacion: '10/01/2024' }), 'fecha_fabricacion')).toEqual({ fecha: '2024-01-10' });
    const mala = leer({ ...equipo, fecha_fabricacion: 'pronto' });
    expect(mala.ok).toBe(false);
  });

  it('la respuesta del area solo se guarda si hay una solicitud de la aduana, y recuerda a cual contesta', () => {
    const con = leer({ descripciones_minimas: 'Cual es el amperaje?', respuesta_area: '5 A' });
    expect(valor(con, 'respuesta_area')).toEqual({ texto: '5 A', sobre: 'Cual es el amperaje?' });
    const sin = leer({ descripciones_minimas: 'No aplica', respuesta_area: '5 A' });
    expect(sin.ok && sin.fila.valores.map(([c]) => c)).not.toContain('respuesta_area');
  });

  it('errores que dejan la fila fuera, uno por celda, con el nombre de la columna', () => {
    const r = interpretarFila(7, { codigo: '', nombre_producto: '', tipo_producto: 'Cosa', fecha_solicitud: '2999-01-01', unidad_medida: 'Cajas', pais_origen: 'Narnia', reembolsable: 'tal vez', partida_arancelaria: '123' }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const t = r.errores.join('\n');
    expect(t).toContain('Falta el código');
    expect(t).toContain('Falta la descripción según factura');
    expect(t).toContain('Tipo de producto «Cosa»');
    expect(t).toContain('no puede ser futura');
    expect(t).toContain('Unidad de medida: «Cajas» no está en el catálogo');
    expect(t).toContain('País de origen: «Narnia»');
    expect(t).toContain('Reembolsable: «tal vez»');
    expect(t).toContain('Partida arancelaria final:');
    expect(r.desconocidos).toEqual([{ catalogo: 'unidad_medida', valor: 'Cajas' }]);
  });

  it('las fechas se validan entre si: la de clasificacion no puede ser anterior a la de solicitud ni futura', () => {
    expect(leer({ fecha_clasificacion: '01/03/2025' }).ok).toBe(false);
    expect(leer({ fecha_clasificacion: '2999-01-01' }).ok).toBe(false);
    const ok = leer({ fecha_clasificacion: '02/04/2025' });
    expect(ok.ok && ok.fila.fechaClasificacion).toBe('2025-04-02');
    expect(ok.ok && ok.fila.sinFechaClasificacion).toBe(false);
  });

  it('respeta los maximos de la ficha (la misma validacion de los formularios)', () => {
    const r = leer({ fabricante: 'x'.repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errores[0]).toContain('Fabricante: Máximo 200 caracteres');
  });

  it('un area que no existe es un error; un area vacia no lo es (solo se avisa)', () => {
    expect(leer({ area_responsable: 'Contabilidad' }).ok).toBe(false);
    const sin = leer();
    expect(sin.ok && sin.fila.faltantes).toContain('Área responsable');
  });
});
