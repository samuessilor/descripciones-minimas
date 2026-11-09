/**
 * Buscador con lupa (SPEC 10.3, 12.4, D-18): tokens AND normalizados, LIKE escapado, solo lo visible para el
 * actor, maximo 8, orden por cercania y limite de 120 por minuto.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referencia } from '@/db/esquema';
import { buscar, MAX_SUGERENCIAS } from '@/server/acciones/buscar';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
const ids: Record<string, string> = {};

beforeAll(async () => {
  e = await nuevoEscenario();
  ids.exacta = await nuevaFicha(e, { codigo: 'ZK-100', nombre: 'Filtro HEPA' });
  ids.prefijo = await nuevaFicha(e, { codigo: 'ZK-1000-B', nombre: 'Otra cosa' });
  ids.contiene = await nuevaFicha(e, { codigo: 'XZK-100Z', nombre: 'Algo mas' });
  ids.nombre = await nuevaFicha(e, { codigo: 'QQ-1', nombre: 'Camara de vacio' });
  ids.tilde = await nuevaFicha(e, { codigo: 'QQ-2', nombre: 'Cámara de vacío grande' });
  ids.porcentaje = await nuevaFicha(e, { codigo: 'AB%CD', nombre: 'Con porcentaje' });
  ids.otro = await nuevaFicha(e, { codigo: 'ABXCD', nombre: 'Sin porcentaje' });
  ids.guion = await nuevaFicha(e, { codigo: 'A_1', nombre: 'Con guion bajo' });
  ids.letra = await nuevaFicha(e, { codigo: 'AX1', nombre: 'Con letra' });
  ids.codigoSeparadores = await nuevaFicha(e, { codigo: 'B32 10-KIT5', nombre: 'Kit con separadores' });
  ids.agencia = await nuevaFicha(e, { codigo: 'AGENCIA-77', nombre: 'Para la agencia A' });
  await asignarAAduana(e, ids.agencia!, e.brian);
  ids.archivada = await nuevaFicha(e, { codigo: 'ARCH-9', nombre: 'Vieja' });
  await e.db.update(referencia).set({ archivadaEn: new Date(), archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, ids.archivada!));
  // Marca y proveedor tambien se buscan.
  await guardarCampo(e.ctx(e.edward), { referenciaId: ids.exacta!, campo: 'marca', valor: { texto: 'NAGA Chemicals' }, versionEsperada: 0 });
});
afterAll(async () => {
  await e.c.cerrar();
});

const ver = (r: { resultados: Array<{ codigo: string }> }) => r.resultados.map((x) => x.codigo);

describe('buscar', () => {
  it('menos de 2 caracteres: no consulta nada', async () => {
    expect((await buscar(e.ctx(e.edward), { q: 'z' })).resultados).toEqual([]);
    expect((await buscar(e.ctx(e.edward), { q: '   ' })).total).toBe(0);
  });

  it('ordena: codigo exacto > prefijo de codigo > contiene', async () => {
    const r = await buscar(e.ctx(e.edward), { q: 'zk-100' });
    expect(ver(r).slice(0, 3)).toEqual(['ZK-100', 'ZK-1000-B', 'XZK-100Z']);
    expect(r.resultados[0]).toMatchObject({ exacta: true, coincideEn: 'codigo', color: 'amarillo' });
    expect(r.exactaId).toBe(ids.exacta);
  });

  it('ignora mayusculas, tildes y separadores del codigo', async () => {
    expect(ver(await buscar(e.ctx(e.edward), { q: 'CAMARA DE VACIO' }))).toEqual(expect.arrayContaining(['QQ-1', 'QQ-2']));
    expect(ver(await buscar(e.ctx(e.edward), { q: 'camara de vacío grande' }))).toEqual(['QQ-2']);
    // B32 10-KIT5 se encuentra escribiendo el codigo sin espacios ni guion.
    expect(ver(await buscar(e.ctx(e.edward), { q: 'b3210kit5' }))).toEqual(['B32 10-KIT5']);
  });

  it('busca tambien por marca (todos los tokens deben estar)', async () => {
    expect(ver(await buscar(e.ctx(e.edward), { q: 'naga chem' }))).toEqual(['ZK-100']);
    expect(ver(await buscar(e.ctx(e.edward), { q: 'naga inexistente' }))).toEqual([]);
  });

  it('Enter con UNA coincidencia exacta navega directo; con varias por nombre no', async () => {
    expect((await buscar(e.ctx(e.edward), { q: 'Filtro HEPA' })).exactaId).toBe(ids.exacta); // nombre exacto
    // Dos fichas con el mismo nombre: no hay "la" ficha, se abre el listado.
    await nuevaFicha(e, { codigo: 'DUP-1', nombre: 'Nombre repetido' });
    await nuevaFicha(e, { codigo: 'DUP-2', nombre: 'Nombre repetido' });
    const r = await buscar(e.ctx(e.edward), { q: 'nombre repetido' });
    expect(r.exactaId).toBeNull();
    expect(r.exactasPorNombre).toBe(2);
  });

  it('los comodines de LIKE se buscan como texto: "%" y "_" no traen toda la base (D-18, RV-25)', async () => {
    expect(ver(await buscar(e.ctx(e.edward), { q: 'b%' }))).toEqual(['AB%CD']);
    expect(ver(await buscar(e.ctx(e.edward), { q: 'a_' }))).toEqual(['A_1']);
    expect((await buscar(e.ctx(e.edward), { q: '%%' })).total).toBe(0);
    expect((await buscar(e.ctx(e.edward), { q: "x\\" })).total).toBe(0);
    // Una inyeccion clasica es solo texto.
    expect((await buscar(e.ctx(e.edward), { q: "' OR 1=1 --" })).total).toBe(0);
  });

  it('maximo 8 resultados, pero el total dice cuantos hay', async () => {
    for (let i = 1; i <= 12; i++) await nuevaFicha(e, { codigo: `LOTE-${String(i).padStart(2, '0')}`, nombre: `Pieza del lote ${i}` });
    const r = await buscar(e.ctx(e.edward), { q: 'lote' });
    expect(r.resultados).toHaveLength(MAX_SUGERENCIAS);
    expect(r.total).toBe(12);
  });

  it('encuentra la partida escrita sin puntos o con guiones', async () => {
    const id = await nuevaFicha(e, { codigo: 'PART-1', nombre: 'Con partida' });
    await e.db.update(referencia).set({ partida: '8421.39.90.00' }).where(eq(referencia.id, id));
    expect(ver(await buscar(e.ctx(e.edward), { q: '8421399000' }))).toEqual(['PART-1']);
    expect(ver(await buscar(e.ctx(e.edward), { q: '842139' }))).toEqual(['PART-1']);
    expect(ver(await buscar(e.ctx(e.edward), { q: '8421-39-90-00' }))).toEqual(['PART-1']);
    expect((await buscar(e.ctx(e.edward), { q: '8421399001' })).total).toBe(0);
  });

  it('nunca muestra las archivadas', async () => {
    expect(ver(await buscar(e.ctx(e.admin), { q: 'ARCH-9' }))).toEqual([]);
  });

  it('aislamiento de agencia: solo lo asignado a su organizacion', async () => {
    expect(ver(await buscar(e.ctx(e.brian), { q: 'AGENCIA-77' }))).toEqual(['AGENCIA-77']);
    expect((await buscar(e.ctx(e.brianB), { q: 'AGENCIA-77' })).total).toBe(0);
    expect((await buscar(e.ctx(e.brian), { q: 'ZK-100' })).total).toBe(0); // lo que no le asignaron no existe
    expect((await buscar(e.ctx(e.brian), { q: 'zk' })).exactaId).toBeNull();
    expect(ver(await buscar(e.ctx(e.lector), { q: 'AGENCIA-77' }))).toEqual(['AGENCIA-77']); // los internos ven todo
  });

  it('120 por minuto y por persona', async () => {
    const t = new Date('2026-10-21T16:00:00Z');
    for (let i = 0; i < 120; i++) await buscar(e.ctx(e.charles, t), { q: 'zk' });
    await expect(buscar(e.ctx(e.charles, t), { q: 'zk' })).rejects.toMatchObject({ codigo: 'LIMITE_TASA' });
    // Otra persona no se ve afectada.
    await expect(buscar(e.ctx(e.edward, t), { q: 'zk' })).resolves.toBeTruthy();
  });

  it('rechaza una consulta absurdamente larga con VALIDACION, no con un error interno', async () => {
    await expect(buscar(e.ctx(e.edward), { q: 'a'.repeat(5000) })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });
});
