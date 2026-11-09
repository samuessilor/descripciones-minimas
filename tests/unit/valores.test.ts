import { describe, expect, it } from 'vitest';
import { getCampo } from '@/dominio/campos';
import { estaVacio, normalizarValor, textoDeValor, valoresIguales } from '@/dominio/valores';

const ctx = { hoy: '2026-10-21' };
const campo = (k: string) => {
  const c = getCampo(k);
  if (!c) throw new Error(`campo ${k} no existe`);
  return c;
};

describe('normalizarValor: texto', () => {
  it('recorta espacios y guarda el texto', () => {
    expect(normalizarValor(campo('uso'), '  limpieza de lentes  ', ctx)).toEqual({
      ok: true,
      valor: 'limpieza de lentes',
    });
  });

  it('texto vacio equivale a vaciar el campo (null)', () => {
    expect(normalizarValor(campo('uso'), '   ', ctx)).toEqual({ ok: true, valor: null });
    expect(normalizarValor(campo('uso'), null, ctx)).toEqual({ ok: true, valor: null });
  });

  it('respeta el maximo de caracteres de la matriz (descripcion segun factura: 500)', () => {
    const largo = 'a'.repeat(501);
    const r = normalizarValor(campo('descripcion_factura'), largo, ctx);
    expect(r.ok).toBe(false);
    expect(normalizarValor(campo('descripcion_factura'), 'a'.repeat(500), ctx).ok).toBe(true);
  });

  it('rechaza tipos que no son texto', () => {
    expect(normalizarValor(campo('uso'), 12, ctx).ok).toBe(false);
    expect(normalizarValor(campo('uso'), { a: 1 }, ctx).ok).toBe(false);
  });

  it('conserva saltos de linea de la materia constitutiva (texto libre multilinea)', () => {
    const r = normalizarValor(campo('materia_constitutiva'), 'Agua 80%\nAlcohol 20%', ctx);
    expect(r).toEqual({ ok: true, valor: 'Agua 80%\nAlcohol 20%' });
  });
});

describe('normalizarValor: marca, pais, tipo, si/no', () => {
  it('marca como texto o como "no tiene marca"', () => {
    expect(normalizarValor(campo('marca'), { texto: ' NAGA ' }, ctx)).toEqual({ ok: true, valor: { texto: 'NAGA' } });
    expect(normalizarValor(campo('marca'), 'NAGA', ctx)).toEqual({ ok: true, valor: { texto: 'NAGA' } });
    expect(normalizarValor(campo('marca'), { sin_marca: true }, ctx)).toEqual({
      ok: true,
      valor: { sin_marca: true },
    });
    expect(normalizarValor(campo('marca'), { texto: '  ' }, ctx)).toEqual({ ok: true, valor: null });
  });

  it('pais por codigo ISO2 o "No se conoce"', () => {
    expect(normalizarValor(campo('pais_origen'), 'fr', ctx)).toEqual({ ok: true, valor: 'FR' });
    expect(normalizarValor(campo('pais_origen'), 'NO_SE_CONOCE', ctx)).toEqual({ ok: true, valor: 'NO_SE_CONOCE' });
    expect(normalizarValor(campo('pais_origen'), 'ZZ', ctx).ok).toBe(false);
    expect(normalizarValor(campo('pais_origen'), 'Francia', ctx).ok).toBe(false);
  });

  it('tipo de producto solo admite los cuatro', () => {
    expect(normalizarValor(campo('tipo_producto'), 'EQUIPO', ctx)).toEqual({ ok: true, valor: 'EQUIPO' });
    expect(normalizarValor(campo('tipo_producto'), 'INSTRUMENTO', ctx).ok).toBe(false);
  });

  it('clasificacion finalizada es SI o NO sin valor por defecto', () => {
    expect(normalizarValor(campo('clasificacion_finalizada'), 'SI', ctx)).toEqual({ ok: true, valor: 'SI' });
    expect(normalizarValor(campo('clasificacion_finalizada'), 'NO', ctx)).toEqual({ ok: true, valor: 'NO' });
    expect(normalizarValor(campo('clasificacion_finalizada'), 'TAL VEZ', ctx).ok).toBe(false);
  });
});

describe('normalizarValor: numeros', () => {
  it('valor unitario guarda cadena decimal exacta', () => {
    expect(normalizarValor(campo('valor_unitario'), '137,74', ctx)).toEqual({ ok: true, valor: '137.74' });
  });

  it('valor unitario ambiguo devuelve las opciones y no guarda', () => {
    const r = normalizarValor(campo('valor_unitario'), '1.374', ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalle?.codigo).toBe('AMBIGUO');
    expect(normalizarValor(campo('valor_unitario'), { texto: '1.374', desambiguar: 'entero' }, ctx)).toEqual({
      ok: true,
      valor: '1374',
    });
  });

  it('cantidad a radicar guarda resultado y expresion', () => {
    expect(normalizarValor(campo('cantidad_a_radicar'), '13x12', ctx)).toEqual({
      ok: true,
      valor: { valor: '156', expresion: '13x12' },
    });
    expect(normalizarValor(campo('cantidad_a_radicar'), 'abc', ctx).ok).toBe(false);
  });
});

describe('normalizarValor: fecha de fabricacion, partida, clasificadores', () => {
  it('fecha valida, no futura', () => {
    expect(normalizarValor(campo('fecha_fabricacion'), { fecha: '2026-01-05' }, ctx)).toEqual({
      ok: true,
      valor: { fecha: '2026-01-05' },
    });
    expect(normalizarValor(campo('fecha_fabricacion'), { fecha: '2026-10-22' }, ctx).ok).toBe(false);
    expect(normalizarValor(campo('fecha_fabricacion'), { fecha: '2026-13-45' }, ctx).ok).toBe(false);
    expect(normalizarValor(campo('fecha_fabricacion'), { fecha: '2026-02-30' }, ctx).ok).toBe(false);
  });

  it('"Por confirmar" con nota es un valor valido', () => {
    expect(
      normalizarValor(campo('fecha_fabricacion'), { por_confirmar: true, nota: 'Confirmar en la pre-inspeccion' }, ctx),
    ).toEqual({ ok: true, valor: { por_confirmar: true, nota: 'Confirmar en la pre-inspeccion' } });
  });

  it('partida se normaliza a NNNN.NN.NN.NN y rechaza lo demas', () => {
    expect(normalizarValor(campo('partida_arancelaria'), '8421399000', ctx)).toEqual({
      ok: true,
      valor: '8421.39.90.00',
    });
    expect(normalizarValor(campo('partida_arancelaria'), '8421', ctx).ok).toBe(false);
  });

  it('clasificador: usuario o nombre libre con organizacion', () => {
    const id = '3f1c2e9a-0000-4000-8000-000000000001';
    expect(normalizarValor(campo('primer_clasificador'), { usuario_id: id }, ctx)).toEqual({
      ok: true,
      valor: { usuario_id: id },
    });
    expect(
      normalizarValor(campo('primer_clasificador'), { nombre: ' Ana Perez ', organizacion: 'Agencia X' }, ctx),
    ).toEqual({ ok: true, valor: { nombre: 'Ana Perez', organizacion: 'Agencia X' } });
    expect(normalizarValor(campo('primer_clasificador'), { nombre: 'Ana' }, ctx).ok).toBe(false);
    expect(normalizarValor(campo('primer_clasificador'), { usuario_id: 'no-uuid' }, ctx).ok).toBe(false);
  });
});

describe('estaVacio / valoresIguales / textoDeValor', () => {
  it('detecta vacios sin confundir valores validos', () => {
    expect(estaVacio(null)).toBe(true);
    expect(estaVacio(undefined)).toBe(true);
    expect(estaVacio('')).toBe(true);
    expect(estaVacio({ texto: '' })).toBe(true);
    expect(estaVacio({ sin_marca: true })).toBe(false);
    expect(estaVacio('NO_SE_CONOCE')).toBe(false);
    expect(estaVacio({ por_confirmar: true, nota: '' })).toBe(false);
    expect(estaVacio('0')).toBe(false);
  });

  it('compara valores JSON por contenido, no por referencia ni orden de claves', () => {
    expect(valoresIguales({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(valoresIguales({ valor: '156', expresion: '13x12' }, { valor: '156', expresion: '13*12' })).toBe(false);
    expect(valoresIguales(null, null)).toBe(true);
    expect(valoresIguales('a', 'b')).toBe(false);
  });

  it('textoDeValor entrega texto plano para busqueda y exportacion', () => {
    expect(textoDeValor({ texto: 'NAGA' })).toBe('NAGA');
    expect(textoDeValor({ sin_marca: true })).toBe('Sin marca');
    expect(textoDeValor('abc')).toBe('abc');
    expect(textoDeValor(null)).toBe('');
  });
});

describe('descripciones minimas (texto libre de la aduana)', () => {
  const ctx = { hoy: '2026-10-27' };

  it('conserva las lineas, unifica los saltos y recorta los extremos', () => {
    expect(normalizarValor('descripciones_minimas', '  Producto: motor\r\nMarca: NAGA\rPotencia: 400 W  ', ctx)).toEqual({
      ok: true,
      valor: 'Producto: motor\nMarca: NAGA\nPotencia: 400 W',
    });
  });

  it('vacio o solo espacios es vaciar el campo', () => {
    expect(normalizarValor('descripciones_minimas', ' \n ', ctx)).toEqual({ ok: true, valor: null });
  });

  it('tiene un maximo de 5000 caracteres', () => {
    expect(normalizarValor('descripciones_minimas', 'x'.repeat(5000), ctx).ok).toBe(true);
    expect(normalizarValor('descripciones_minimas', 'x'.repeat(5001), ctx)).toMatchObject({ ok: false, mensaje: 'Máximo 5000 caracteres.' });
  });
});
describe('normalizarValor: «No aplica», proveedor vinculado y respuesta del area (reunion 2026-10-29)', () => {
  it('«No aplica» solo lo admiten los campos que lo declaran', () => {
    for (const k of ['aspecto_fisico', 'descripciones_minimas', 'restricciones', 'observaciones_aduana']) {
      expect(normalizarValor(campo(k), { no_aplica: true }, ctx), k).toEqual({ ok: true, valor: { no_aplica: true } });
    }
    expect(normalizarValor(campo('uso'), { no_aplica: true }, ctx).ok).toBe(false);
    expect(estaVacio({ no_aplica: true })).toBe(false);
    expect(textoDeValor({ no_aplica: true })).toBe('No aplica');
  });

  it('el tipo de empaque es una lista fija: acepta Bidón, Paquete y Unidad, y rechaza «No aplica» y valores fuera de la lista', () => {
    for (const v of ['Bidón', 'Paquete', 'Unidad']) {
      expect(normalizarValor(campo('tipo_empaque'), v, ctx), v).toEqual({ ok: true, valor: v });
    }
    expect(normalizarValor(campo('tipo_empaque'), '  Paquete ', ctx)).toEqual({ ok: true, valor: 'Paquete' });
    expect(normalizarValor(campo('tipo_empaque'), { no_aplica: true }, ctx)).toMatchObject({ ok: false, mensaje: 'Este campo no admite «No aplica».' });
    for (const v of ['Caja', 'Bidón de 20 kg', 'bidón', 'No aplica', 'unidad']) {
      expect(normalizarValor(campo('tipo_empaque'), v, ctx), v).toMatchObject({ ok: false, mensaje: 'Elige una opción de la lista.' });
    }
    expect(normalizarValor(campo('tipo_empaque'), '   ', ctx)).toEqual({ ok: true, valor: null });
  });

  it('el contenido por empaque es texto libre con maximo de 60 caracteres y no admite «No aplica»', () => {
    expect(normalizarValor(campo('cantidad_empaque'), ' 20 litros ', ctx)).toEqual({ ok: true, valor: '20 litros' });
    expect(normalizarValor(campo('cantidad_empaque'), 'x'.repeat(61), ctx).ok).toBe(false);
    expect(normalizarValor(campo('cantidad_empaque'), { no_aplica: true }, ctx).ok).toBe(false);
  });

  it('el proveedor admite texto o «el mismo fabricante»', () => {
    expect(normalizarValor(campo('proveedor'), ' Proveedor SA ', ctx)).toEqual({ ok: true, valor: 'Proveedor SA' });
    expect(normalizarValor(campo('proveedor'), { mismo_fabricante: true }, ctx)).toEqual({ ok: true, valor: { mismo_fabricante: true } });
    expect(normalizarValor(campo('proveedor'), '', ctx)).toEqual({ ok: true, valor: null });
    expect(estaVacio({ mismo_fabricante: true })).toBe(false);
  });

  it('la respuesta del area guarda la solicitud que contesta', () => {
    const conSolicitud = { ...ctx, valores: { descripciones_minimas: ' ¿AC o DC? ' } };
    expect(normalizarValor(campo('respuesta_area'), ' DC ', conSolicitud)).toEqual({ ok: true, valor: { texto: 'DC', sobre: '¿AC o DC?' } });
    expect(normalizarValor(campo('respuesta_area'), '  ', conSolicitud)).toEqual({ ok: true, valor: null });
    expect(textoDeValor({ texto: 'DC', sobre: '¿AC o DC?' })).toBe('DC');
  });

  it('RIM es Sí/No y la cantidad acepta operaciones', () => {
    expect(normalizarValor(campo('requiere_rim'), 'Sí', ctx)).toEqual({ ok: true, valor: 'SI' });
    expect(normalizarValor(campo('cantidad_rim'), '13x12', ctx)).toMatchObject({ ok: true, valor: { valor: '156' } });
  });
});
