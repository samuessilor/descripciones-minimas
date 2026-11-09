/** `crearReferencia` (12.4, 6.3, CA-02, F1, F10): duplicado normalizado, carreras, similar, permisos. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campoHistorial, referencia } from '@/db/esquema';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { asignarAAduana, nuevoEscenario, nuevaFicha, versionDe, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function err(p: Promise<unknown>): Promise<ErrorAccion> {
  try {
    await p;
  } catch (x) {
    if (x instanceof ErrorAccion) return x;
    throw x;
  }
  throw new Error('se esperaba un ErrorAccion');
}

describe('crear', () => {
  it('crea en borrador, a nombre del creador, con fecha de hoy y los hechos iniciales en el historial', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: '  1GA0612A00 ', nombreProducto: 'NSR E1', tipoProducto: 'INSUMO' });
    const [f] = await e.db.select().from(referencia).where(eq(referencia.id, r.id));
    expect(f).toMatchObject({
      codigo: '1GA0612A00',
      codigoNorm: '1GA0612A00',
      nombreProducto: 'NSR E1',
      tipoProducto: 'INSUMO',
      estado: 'BORRADOR',
      creadaPor: e.edward.usuarioId,
      diasPausa: 0,
    });
    expect(f!.fechaSolicitud).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const hechos = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, r.id));
    expect(hechos.map((h) => [h.campo, h.versionCampo]).sort()).toEqual([
      ['codigo', 1],
      ['fecha_solicitud', 1],
      ['nombre_producto', 1],
      ['tipo_producto', 1],
    ]);
    expect(f!.textoBusqueda).toBe('1ga0612a00 1ga0612a00 nsr e1');
  });

  it('acepta una fecha de solicitud anterior y rechaza la futura o invalida', async () => {
    const r = await crearReferencia(e.ctx(e.edward), {
      codigo: 'FECHA-1',
      nombreProducto: 'x',
      tipoProducto: 'REPUESTO',
      fechaSolicitud: '2026-10-01',
    });
    const [f] = await e.db.select().from(referencia).where(eq(referencia.id, r.id));
    expect(f!.fechaSolicitud).toBe('2026-10-01');
    expect((await err(crearReferencia(e.ctx(e.edward), { codigo: 'FECHA-2', nombreProducto: 'x', tipoProducto: 'REPUESTO', fechaSolicitud: '2999-01-01' }))).codigo).toBe('VALIDACION');
    expect((await err(crearReferencia(e.ctx(e.edward), { codigo: 'FECHA-3', nombreProducto: 'x', tipoProducto: 'REPUESTO', fechaSolicitud: '2026-02-30' }))).codigo).toBe('VALIDACION');
  });

  it('exige codigo, nombre y tipo validos', async () => {
    for (const mala of [
      { codigo: '', nombreProducto: 'x', tipoProducto: 'INSUMO' },
      { codigo: 'A', nombreProducto: '  ', tipoProducto: 'INSUMO' },
      { codigo: 'A', nombreProducto: 'x', tipoProducto: 'INSTRUMENTO' },
      { codigo: '- . /', nombreProducto: 'x', tipoProducto: 'INSUMO' },
    ]) {
      expect((await err(crearReferencia(e.ctx(e.edward), mala))).codigo, JSON.stringify(mala)).toBe('VALIDACION');
    }
  });

  it('solo admin y solicitante crean; la aduana y el lector no (PA-24)', async () => {
    for (const quien of [e.brian, e.lector]) {
      expect((await err(crearReferencia(e.ctx(quien), { codigo: 'NOPE-1', nombreProducto: 'x', tipoProducto: 'INSUMO' }))).codigo).toBe('SIN_PERMISO');
    }
    expect((await crearReferencia(e.ctx(e.admin), { codigo: 'ADMIN-1', nombreProducto: 'x', tipoProducto: 'INSUMO' })).id).toBeTruthy();
  });
});

describe('duplicados (D-27, RV-33, CA-02)', () => {
  it('B32 10-KIT5, B3210-KIT5 y B32-10-KIT5 son la misma referencia: DUPLICADO con id y estado', async () => {
    const primera = await crearReferencia(e.ctx(e.edward), { codigo: 'B32 10-KIT5', nombreProducto: 'Chuck', tipoProducto: 'REPUESTO' });
    for (const variante of ['B3210-KIT5', 'B32-10-KIT5', 'b32_10.kit5']) {
      const x = await err(crearReferencia(e.ctx(e.charles), { codigo: variante, nombreProducto: 'Otro', tipoProducto: 'REPUESTO' }));
      expect(x.codigo).toBe('DUPLICADO');
      expect(x.detalle).toMatchObject({ id: primera.id, estado: 'BORRADOR', archivada: false });
      expect(x.message).toContain('Ya existe la referencia B32 10-KIT5');
    }
  });

  it('el codigo de una ficha archivada no se libera: DUPLICADO con el aviso de archivada', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'ARCH-1', nombreProducto: 'x', tipoProducto: 'INSUMO' });
    await e.db.update(referencia).set({ archivadaEn: new Date(), archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, r.id));
    const x = await err(crearReferencia(e.ctx(e.edward), { codigo: 'arch 1', nombreProducto: 'x', tipoProducto: 'INSUMO' }));
    expect(x.codigo).toBe('DUPLICADO');
    expect(x.message).toBe('Esa referencia existe pero está archivada. Pide a un administrador o a la supervisora general que la restaure.');
    expect(x.detalle).toMatchObject({ id: r.id, archivada: true });
  });

  it('dos creaciones simultaneas del mismo codigo dejan UNA sola ficha', async () => {
    const resultados = await Promise.allSettled([
      crearReferencia(e.ctx(e.edward), { codigo: 'CARRERA-1', nombreProducto: 'x', tipoProducto: 'INSUMO' }),
      crearReferencia(e.ctx(e.charles), { codigo: 'CARRERA 1', nombreProducto: 'y', tipoProducto: 'INSUMO' }),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rechazo.reason as ErrorAccion).codigo).toBe('DUPLICADO');
    const filas = await e.db.select().from(referencia).where(eq(referencia.codigoNorm, 'CARRERA1'));
    expect(filas).toHaveLength(1);
  });

  it('lista "posibles duplicados" sin bloquear: prefijo, contiene y ceros a la izquierda', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: '10254-KIT', nombreProducto: 'Filtro', tipoProducto: 'REPUESTO' });
    await crearReferencia(e.ctx(e.edward), { codigo: '00777', nombreProducto: 'Con ceros', tipoProducto: 'REPUESTO' });
    const r1 = await crearReferencia(e.ctx(e.edward), { codigo: '10254-KIT2', nombreProducto: 'Filtro 2', tipoProducto: 'REPUESTO' });
    expect(r1.posiblesDuplicados.map((p) => p.codigo)).toContain('10254-KIT');
    const r2 = await crearReferencia(e.ctx(e.edward), { codigo: '777', nombreProducto: 'Sin ceros', tipoProducto: 'REPUESTO' });
    expect(r2.posiblesDuplicados.map((p) => p.codigo)).toContain('00777');
    const r3 = await crearReferencia(e.ctx(e.edward), { codigo: 'ZZZ-UNICO-99', nombreProducto: 'Nada parecido', tipoProducto: 'REPUESTO' });
    expect(r3.posiblesDuplicados).toHaveLength(0);
  });

  it('los comodines LIKE del codigo se tratan como texto', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: 'ABCD', nombreProducto: 'x', tipoProducto: 'INSUMO' });
    const r = await crearReferencia(e.ctx(e.edward), { codigo: '%_%_', nombreProducto: 'y', tipoProducto: 'INSUMO' });
    expect(r.posiblesDuplicados).toHaveLength(0);
  });
});

describe('Crear similar (F10, CA 12.4)', () => {
  it('copia los campos compartidos y NUNCA codigo, nombre, valor, cantidad, partida ni clasificacion', async () => {
    const origen = await nuevaFicha(e, { tipo: 'REPUESTO', codigo: 'ORIGEN-1', nombre: 'Motor demo' });
    const g = async (campo: string, valor: unknown, quien = e.edward) =>
      guardarCampo(e.ctx(quien), { referenciaId: origen, campo, valor, versionEsperada: await versionDe(e.db, origen, campo) });
    await g('maquina_destino', 'Biseladora Mei 641');
    await g('proveedor', 'Proveedor SA');
    await g('marca', { texto: 'ACME' });
    await g('pais_origen', 'CN');
    await g('fabricante', 'Fabrica SA');
    await g('reembolsable', 'No aplica');
    await g('tipo_empaque', 'Paquete');
    await g('cantidad_empaque', '10 unidades');
    await g('requiere_rim', 'SI', e.admin); // lo responde la aduana (o el admin): nunca se copia
    await g('descripcion_factura', 'Segun factura');
    await asignarAAduana(e, origen, e.brian);
    await guardarCampo(e.ctx(e.brian), { referenciaId: origen, campo: 'partida_arancelaria', valor: '8501.31.20.00', versionEsperada: 0 });

    const r = await crearReferencia(e.ctx(e.charles), {
      codigo: 'SIMILAR-1',
      nombreProducto: 'Motor demo 2',
      tipoProducto: 'REPUESTO',
      similarDe: origen,
    });
    const [f] = await e.db.select().from(referencia).where(eq(referencia.id, r.id));
    const claves = Object.keys(f!.datos).sort();
    expect(claves).toEqual(
      [
        'cantidad_empaque',
        'codigo',
        'fabricante',
        'fecha_solicitud',
        'maquina_destino',
        'marca',
        'nombre_producto',
        'pais_origen',
        'proveedor',
        'reembolsable',
        'tipo_empaque',
        'tipo_producto',
      ].sort(),
    );
    expect(f!.datos.maquina_destino!.v).toBe('Biseladora Mei 641');
    expect(f!.datos.maquina_destino!.a).toBe(e.charles.usuarioId); // el autor es quien copia
    expect(f!.datos.tipo_empaque!.v).toBe('Paquete');
    expect(f!.datos.cantidad_empaque!.v).toBe('10 unidades');
    expect(f!.datos.reembolsable!.v).toBe('No aplica');
    expect(f!.datos.requiere_rim).toBeUndefined();
    expect(f!.datos.codigo!.v).toBe('SIMILAR-1');
    expect(f!.partida).toBeNull();
  });

  it('no copia a un campo oculto por el nuevo tipo y respeta la visibilidad de la ficha origen', async () => {
    const origen = await nuevaFicha(e, { tipo: 'REPUESTO' });
    await guardarCampo(e.ctx(e.edward), { referenciaId: origen, campo: 'maquina_destino', valor: 'Prensa', versionEsperada: 0 });
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'SIMILAR-INS', nombreProducto: 'Insumo', tipoProducto: 'INSUMO', similarDe: origen });
    const [f] = await e.db.select().from(referencia).where(eq(referencia.id, r.id));
    expect(f!.datos.maquina_destino).toBeUndefined();
    // Un id inexistente es NO_ENCONTRADO y no deja una ficha a medias.
    const antes = await e.db.select().from(referencia);
    const x = await err(crearReferencia(e.ctx(e.edward), { codigo: 'SIMILAR-MAL', nombreProducto: 'x', tipoProducto: 'INSUMO', similarDe: '00000000-0000-4000-8000-000000000000' }));
    expect(x.codigo).toBe('NO_ENCONTRADO');
    expect(await e.db.select().from(referencia)).toHaveLength(antes.length);
  });
});
