/** Catalogos (H5): valores de lista, restricciones y partidas. Nada se borra; todo queda auditado. */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, catalogoItem, partidaArancelaria, referencia, restriccionPlantilla } from '@/db/esquema';
import { ErrorAccion } from '@/server/acciones/resultado';
import { activarItemCatalogo, guardarItemCatalogo, guardarPartida, guardarRestriccion, moverItemCatalogo } from '@/server/acciones/catalogos-admin';
import { listarItemsCatalogo, listarPaisesAdmin, listarPartidas, listarRestricciones, opcionesParaPartida } from '@/server/politicas/administracion-catalogos';
import { opcionesDeCatalogo } from '@/server/politicas/catalogos';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { nuevaFicha, nuevoEscenario, versionDe, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof ErrorAccion ? err.codigo : `otro:${String(err)}`;
  }
  return 'OK';
}

const auditorias = (accion: string) => e.db.select().from(auditoria).where(eq(auditoria.accion, accion as never));

describe('permisos', () => {
  it('los demas roles no escriben ni leen la administracion de catalogos', async () => {
    const [res] = await e.db.select().from(restriccionPlantilla).limit(1);
    for (const actor of [e.edward, e.brian, e.lector]) {
      const ctx = e.ctx(actor);
      expect(await codigoDe(guardarItemCatalogo(ctx, { catalogo: 'unidad_medida', valor: 'Metros' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(activarItemCatalogo(ctx, { id: res!.id, activo: false })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(moverItemCatalogo(ctx, { id: res!.id, direccion: 'arriba' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(guardarRestriccion(ctx, { codigo: 'RES-X', texto: 'Texto de prueba' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(guardarPartida(ctx, { modo: 'crear', codigo: '1111.11.11.11' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(listarItemsCatalogo(e.db, actor, 'unidad_medida')), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(listarPaisesAdmin(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(listarRestricciones(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(listarPartidas(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(opcionesParaPartida(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
    }
    expect((await e.db.select().from(catalogoItem).where(eq(catalogoItem.valor, 'Metros'))).length).toBe(0);
  });
});

describe('valores de lista', () => {
  it('agrega al final, no duplica (ignora mayusculas) y reactiva en vez de repetir', async () => {
    const antes = await listarItemsCatalogo(e.db, e.admin, 'unidad_medida');
    const r = await guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'unidad_medida', valor: ' Metros ' });
    expect(r.creado).toBe(true);
    const despues = await listarItemsCatalogo(e.db, e.admin, 'unidad_medida');
    expect(despues.map((x) => x.valor).at(-1)).toBe('Metros');
    expect(despues).toHaveLength(antes.length + 1);

    const otra = await guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'unidad_medida', valor: 'metros' });
    expect(otra).toEqual({ id: r.id, creado: false });
    expect(await listarItemsCatalogo(e.db, e.admin, 'unidad_medida')).toHaveLength(antes.length + 1);

    await activarItemCatalogo(e.ctx(e.admin), { id: r.id, activo: false });
    await guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'unidad_medida', valor: 'METROS' });
    expect((await e.db.select().from(catalogoItem).where(eq(catalogoItem.id, r.id)))[0]!.activo).toBe(true);
  });

  it('un valor inactivo deja de ofrecerse pero se conserva y se sigue contando donde se uso', async () => {
    const ficha = await nuevaFicha(e);
    await guardarCampo(e.ctx(e.edward), { referenciaId: ficha, campo: 'unidad_medida', valor: 'Litros', versionEsperada: await versionDe(e.db, ficha, 'unidad_medida') });
    const litros = (await listarItemsCatalogo(e.db, e.admin, 'unidad_medida')).find((x) => x.valor === 'Litros')!;
    expect(litros.usos).toBeGreaterThanOrEqual(1);

    await activarItemCatalogo(e.ctx(e.admin), { id: litros.id, activo: false });
    expect(await opcionesDeCatalogo(e.db, 'unidad_medida')).not.toContain('Litros');
    const sigue = (await listarItemsCatalogo(e.db, e.admin, 'unidad_medida')).find((x) => x.valor === 'Litros')!;
    expect(sigue).toMatchObject({ activo: false });
    expect(sigue.usos).toBeGreaterThanOrEqual(1);
    const [f] = await e.db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, ficha));
    expect(f!.datos.unidad_medida?.v).toBe('Litros'); // lo ya guardado no cambia

    await activarItemCatalogo(e.ctx(e.admin), { id: litros.id, activo: true });
    expect(await opcionesDeCatalogo(e.db, 'unidad_medida')).toContain('Litros');
  });

  it('no deja una lista sin ningun valor activo', async () => {
    const items = await listarItemsCatalogo(e.db, e.admin, 'aspecto_fisico');
    for (const it of items.slice(1)) await activarItemCatalogo(e.ctx(e.admin), { id: it.id, activo: false });
    expect(await codigoDe(activarItemCatalogo(e.ctx(e.admin), { id: items[0]!.id, activo: false }))).toBe('VALIDACION');
    for (const it of items.slice(1)) await activarItemCatalogo(e.ctx(e.admin), { id: it.id, activo: true });
  });

  it('sube y baja un valor renumerando la lista, y en los extremos no hace nada', async () => {
    const antes = (await listarItemsCatalogo(e.db, e.admin, 'sugerencia_empaque')).map((x) => x.valor);
    const segundo = (await listarItemsCatalogo(e.db, e.admin, 'sugerencia_empaque'))[1]!;
    await moverItemCatalogo(e.ctx(e.admin), { id: segundo.id, direccion: 'arriba' });
    const despues = (await listarItemsCatalogo(e.db, e.admin, 'sugerencia_empaque')).map((x) => x.valor);
    expect(despues[0]).toBe(antes[1]);
    expect(despues[1]).toBe(antes[0]);
    const primero = (await listarItemsCatalogo(e.db, e.admin, 'sugerencia_empaque'))[0]!;
    await moverItemCatalogo(e.ctx(e.admin), { id: primero.id, direccion: 'arriba' });
    expect((await listarItemsCatalogo(e.db, e.admin, 'sugerencia_empaque')).map((x) => x.valor)).toEqual(despues);
    expect((await opcionesDeCatalogo(e.db, 'sugerencia_empaque'))).toEqual(despues);
  });

  it('valida el valor y el catalogo, y audita cada cambio', async () => {
    expect(await codigoDe(guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'unidad_medida', valor: '   ' }))).toBe('VALIDACION');
    expect(await codigoDe(guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'otro', valor: 'x' }))).toBe('VALIDACION');
    expect(await codigoDe(guardarItemCatalogo(e.ctx(e.admin), { catalogo: 'unidad_medida', valor: 'x'.repeat(101) }))).toBe('VALIDACION');
    expect((await auditorias('guardar_catalogo')).length).toBeGreaterThanOrEqual(5);
  });
});

describe('paises', () => {
  it('sin datos suficientes empiezan Francia y China; con datos, los mas usados', async () => {
    const vacio = await listarPaisesAdmin(e.db, e.admin);
    expect(vacio.todos.length).toBeGreaterThan(200);
    expect(vacio.principales.map((p) => p.codigo).sort()).toEqual(['CN', 'FR']);
    for (const [pais, n] of [['CO', 3], ['DE', 1]] as const) {
      for (let i = 0; i < n; i++) {
        const f = await nuevaFicha(e);
        await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'pais_origen', valor: pais, versionEsperada: 0 });
      }
    }
    const con = await listarPaisesAdmin(e.db, e.admin);
    expect(con.principales[0]).toMatchObject({ codigo: 'CO', usos: 3 });
    expect(con.principales.map((p) => p.codigo)).toContain('DE');
  });
});

describe('restricciones', () => {
  it('crea, edita el texto conservando el anterior en la auditoria, y valida', async () => {
    const r = await guardarRestriccion(e.ctx(e.admin), { codigo: 'res-prueba-1', texto: 'Texto original de la restriccion.' });
    expect(r.creada).toBe(true);
    expect((await e.db.select().from(restriccionPlantilla).where(eq(restriccionPlantilla.id, r.id)))[0]).toMatchObject({ codigo: 'RES-PRUEBA-1', activa: true });

    await guardarRestriccion(e.ctx(e.admin), { id: r.id, codigo: 'RES-PRUEBA-1', texto: 'Texto nuevo de la restriccion.' });
    expect((await e.db.select().from(restriccionPlantilla).where(eq(restriccionPlantilla.id, r.id)))[0]!.texto).toBe('Texto nuevo de la restriccion.');
    const a = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'guardar_restriccion'), eq(auditoria.entidadId, r.id)));
    expect(a.some((x) => (x.detalle as { textoAnterior?: string }).textoAnterior === 'Texto original de la restriccion.')).toBe(true);

    expect(await codigoDe(guardarRestriccion(e.ctx(e.admin), { codigo: 'RES-PRUEBA-1', texto: 'Otra con el mismo codigo.' }))).toBe('DUPLICADO');
    expect(await codigoDe(guardarRestriccion(e.ctx(e.admin), { codigo: 'mal codigo!', texto: 'Texto largo suficiente.' }))).toBe('VALIDACION');
    expect(await codigoDe(guardarRestriccion(e.ctx(e.admin), { codigo: 'RES-CORTA', texto: 'x' }))).toBe('VALIDACION');
  });

  it('no desactiva una restriccion que usa una partida activa', async () => {
    const lista = await listarRestricciones(e.db, e.admin);
    const usada = lista.find((x) => x.partidas > 0)!;
    expect(await codigoDe(guardarRestriccion(e.ctx(e.admin), { id: usada.id, codigo: usada.codigo, texto: usada.texto, activa: false }))).toBe('VALIDACION');
    const libre = lista.find((x) => x.codigo === 'RES-PRUEBA-1')!;
    await guardarRestriccion(e.ctx(e.admin), { id: libre.id, codigo: libre.codigo, texto: libre.texto, activa: false });
    expect((await listarRestricciones(e.db, e.admin)).find((x) => x.id === libre.id)!.activa).toBe(false);
  });
});

describe('partidas', () => {
  it('crea con formato canonico, no duplica, edita y filtra', async () => {
    const op = await opcionesParaPartida(e.db, e.admin);
    const restriccion = op.restricciones.find((r) => r.codigo === 'RES-SIN')!;

    const r = await guardarPartida(e.ctx(e.admin), { modo: 'crear', codigo: '8413 70 00 00', descripcion: 'Bombas centrifugas', restriccionId: restriccion.id });
    expect(r.codigo).toBe('8413.70.00.00');
    const [p] = await e.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '8413.70.00.00'));
    expect(p).toMatchObject({ descripcion: 'Bombas centrifugas', restriccionId: restriccion.id, activa: true, creadaPor: e.admin.usuarioId });

    expect(await codigoDe(guardarPartida(e.ctx(e.admin), { modo: 'crear', codigo: '8413.70.00.00' }))).toBe('DUPLICADO');
    expect(await codigoDe(guardarPartida(e.ctx(e.admin), { modo: 'editar', codigo: '9999.99.99.99' }))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(guardarPartida(e.ctx(e.admin), { modo: 'crear', codigo: '1234' }))).toBe('VALIDACION');
    expect(await codigoDe(guardarPartida(e.ctx(e.admin), { modo: 'crear', codigo: 'ab8421399000cd' }))).toBe('VALIDACION');

    await guardarPartida(e.ctx(e.admin), { modo: 'editar', codigo: '8413.70.00.00', descripcion: 'Bombas', restriccionId: null, activa: false });
    const [q] = await e.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '8413.70.00.00'));
    expect(q).toMatchObject({ descripcion: 'Bombas', restriccionId: null, activa: false });

    const encontrada = await listarPartidas(e.db, e.admin, { q: '8413' });
    expect(encontrada.map((x) => x.codigo)).toEqual(['8413.70.00.00']);
    expect((await listarPartidas(e.db, e.admin, { q: 'bombas' })).map((x) => x.codigo)).toEqual(['8413.70.00.00']);
    expect(await listarPartidas(e.db, e.admin, { q: '%' })).toHaveLength(0);
    expect((await auditorias('guardar_partida')).length).toBe(2);
  });

  it('solo se asigna una restriccion activa', async () => {
    const libre = (await listarRestricciones(e.db, e.admin)).find((x) => x.codigo === 'RES-PRUEBA-1')!;
    expect(await codigoDe(guardarPartida(e.ctx(e.admin), { modo: 'crear', codigo: '7777.77.77.77', restriccionId: libre.id }))).toBe('VALIDACION');
    expect((await e.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '7777.77.77.77'))).length).toBe(0);
  });
});
