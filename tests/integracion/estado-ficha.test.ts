/** Presencia y sondeo (D-17, CA-15): latidos de edicion y `estadoFicha`. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estadoFicha, latidoEdicion, terminarEdicion, VIGENCIA_LATIDO_MS } from '@/server/acciones/estado-ficha';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('estadoFicha y presencia', () => {
  it('devuelve version de la ficha, estado y version de cada campo', async () => {
    const f = await nuevaFicha(e);
    const antes = await estadoFicha(e.ctx(e.edward), { referenciaId: f });
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'x', versionEsperada: 0 });
    const despues = await estadoFicha(e.ctx(e.edward), { referenciaId: f });
    expect(despues.version).toBe(antes.version + 1);
    expect(despues.camposVersion.uso).toBe(1);
    expect(despues.estado).toBe('BORRADOR');
    expect(despues.editando).toEqual([]);
  });

  it('"Brian esta escribiendo": los demas ven el campo enfocado; uno no se ve a si mismo', async () => {
    const f = await nuevaFicha(e);
    const t0 = new Date('2026-10-21T15:00:00Z');
    await latidoEdicion(e.ctx(e.charles, t0), { referenciaId: f, campo: 'uso' });
    const vistoPorEdward = await estadoFicha(e.ctx(e.edward, new Date(t0.getTime() + 10_000)), { referenciaId: f });
    expect(vistoPorEdward.editando).toMatchObject([{ campo: 'uso', usuario: 'Charles' }]);
    const vistoPorCharles = await estadoFicha(e.ctx(e.charles, new Date(t0.getTime() + 10_000)), { referenciaId: f });
    expect(vistoPorCharles.editando).toEqual([]);
  });

  it('el latido vence a los 45 s: ya no aparece', async () => {
    const f = await nuevaFicha(e);
    const t0 = new Date('2026-10-21T15:00:00Z');
    await latidoEdicion(e.ctx(e.charles, t0), { referenciaId: f, campo: 'uso' });
    const justo = await estadoFicha(e.ctx(e.edward, new Date(t0.getTime() + VIGENCIA_LATIDO_MS - 1000)), { referenciaId: f });
    expect(justo.editando).toHaveLength(1);
    const despues = await estadoFicha(e.ctx(e.edward, new Date(t0.getTime() + VIGENCIA_LATIDO_MS + 1000)), { referenciaId: f });
    expect(despues.editando).toEqual([]);
  });

  it('es un aviso, no un candado: otra persona puede guardar el mismo campo', async () => {
    const f = await nuevaFicha(e);
    await latidoEdicion(e.ctx(e.charles), { referenciaId: f, campo: 'uso' });
    const r = await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', valor: 'Edward guarda igual', versionEsperada: 0 });
    expect(r.escrito).toBe(true);
  });

  it('al guardar (o terminar) deja de figurar como editando', async () => {
    const f = await nuevaFicha(e);
    await latidoEdicion(e.ctx(e.charles), { referenciaId: f, campo: 'uso' });
    await latidoEdicion(e.ctx(e.charles), { referenciaId: f, campo: 'funciones' });
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'listo', versionEsperada: 0 });
    await terminarEdicion(e.ctx(e.charles), { referenciaId: f, campo: 'funciones' });
    const v = await estadoFicha(e.ctx(e.edward), { referenciaId: f });
    expect(v.editando).toEqual([]);
  });

  it('solo se emite latido para campos que el actor puede escribir en una ficha abierta', async () => {
    const f = await nuevaFicha(e);
    await expect(latidoEdicion(e.ctx(e.lector), { referenciaId: f, campo: 'uso' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(latidoEdicion(e.ctx(e.edward), { referenciaId: f, campo: 'partida_arancelaria' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(latidoEdicion(e.ctx(e.edward), { referenciaId: f, campo: 'inventado' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });

  it('una agencia ve "Otra agencia" en la presencia de otra agencia y no consulta fichas ajenas', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await asignarAAduana(e, f, e.brianB);
    await latidoEdicion(e.ctx(e.brianB), { referenciaId: f, campo: 'observaciones_aduana' });
    const vistoPorA = await estadoFicha(e.ctx(e.brian), { referenciaId: f });
    expect(vistoPorA.editando).toMatchObject([{ campo: 'observaciones_aduana', usuario: 'Otra agencia' }]);
    const vistoPorAdmin = await estadoFicha(e.ctx(e.admin), { referenciaId: f });
    expect(vistoPorAdmin.editando).toMatchObject([{ usuario: 'Brenda' }]);

    const ajena = await nuevaFicha(e);
    await expect(estadoFicha(e.ctx(e.brian), { referenciaId: ajena })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
