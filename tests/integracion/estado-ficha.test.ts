/** Presencia y sondeo (D-17, CA-15): latidos de edicion y `estadoFicha`. */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { edicionActiva } from '@/db/esquema';
import { estadoFicha, latidoEdicion, terminarEdicion, VIGENCIA_LATIDO_MS } from '@/server/acciones/estado-ficha';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { cargarReferenciaLigera, cargarReferenciaVisible } from '@/server/politicas/referencias';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('estadoFicha y presencia', () => {
  it('devuelve version de la ficha, estado y quien edita; NO el contenido de la ficha', async () => {
    const f = await nuevaFicha(e);
    const antes = await estadoFicha(e.ctx(e.edward), { referenciaId: f });
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'x', versionEsperada: 0 });
    const despues = await estadoFicha(e.ctx(e.edward), { referenciaId: f });
    expect(despues.version).toBe(antes.version + 1);
    expect(despues.estado).toBe('BORRADOR');
    expect(despues.editando).toEqual([]);
    // El sondeo es la consulta mas repetida: la respuesta no lleva el contenido (antes traia la version de cada campo).
    expect(Object.keys(despues).sort()).toEqual(['actualizadaEn', 'editando', 'estado', 'version']);
  });

  it('la lectura ligera trae solo las columnas del sondeo (sin datos ni texto de busqueda) y respeta el acceso', async () => {
    const f = await nuevaFicha(e);
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'algo de contenido', versionEsperada: 0 });
    const ligera = await cargarReferenciaLigera(e.db, e.edward, f, new Date());
    expect(Object.keys(ligera).sort()).toEqual(['actualizadaEn', 'archivadaEn', 'creadaPor', 'estado', 'id', 'version']);
    const completa = await cargarReferenciaVisible(e.db, e.edward, f, new Date());
    expect(ligera).toEqual({
      id: completa.id,
      version: completa.version,
      estado: completa.estado,
      actualizadaEn: completa.actualizadaEn,
      archivadaEn: completa.archivadaEn,
      creadaPor: completa.creadaPor,
    });
    // La aduana sin asignacion no la ve: misma respuesta 404 que la lectura completa.
    await expect(cargarReferenciaLigera(e.db, e.brian, f, new Date())).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
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

  it('el latido vence a los VIGENCIA_LATIDO_MS (90 s): ya no aparece', async () => {
    expect(VIGENCIA_LATIDO_MS).toBe(90_000);
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

  describe('limpieza de latidos vencidos (como limite-tasa: al azar, no en cada latido)', () => {
    afterEach(() => vi.restoreAllMocks());
    const filasDe = (ficha: string) => e.db.select().from(edicionActiva).where(eq(edicionActiva.referenciaId, ficha));

    it('si toca (5 %), un latido barre los vencidos de TODA la tabla, tambien los de fichas abandonadas; si no, no borra nada', async () => {
      const f1 = await nuevaFicha(e);
      const f2 = await nuevaFicha(e);
      const t0 = new Date('2026-10-21T15:00:00Z');
      await latidoEdicion(e.ctx(e.charles, t0), { referenciaId: f1, campo: 'uso' });
      // Charles se va a otra ficha una hora despues: la fila vencida de f1 ya no recibira ningun latido.
      const luego = new Date(t0.getTime() + 3_600_000);

      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      await latidoEdicion(e.ctx(e.charles, luego), { referenciaId: f2, campo: 'uso' });
      expect(await filasDe(f1)).toHaveLength(1);
      // Aunque siga ahi, para los demas nunca cuenta como «editando».
      expect((await estadoFicha(e.ctx(e.edward, luego), { referenciaId: f1 })).editando).toEqual([]);

      vi.spyOn(Math, 'random').mockReturnValue(0.01);
      await latidoEdicion(e.ctx(e.charles, luego), { referenciaId: f2, campo: 'funciones' });
      expect(await filasDe(f1)).toHaveLength(0);
      expect((await filasDe(f2)).map((x) => x.campo).sort()).toEqual(['funciones', 'uso']); // los vigentes se quedan
    });
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
