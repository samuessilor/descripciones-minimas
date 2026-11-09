/** Semillas (6.3, Apendice A, 17.3): datos maestros idempotentes y datos de desarrollo marcados. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  campoHistorial,
  catalogoItem,
  organizacion,
  partidaArancelaria,
  referencia,
  restriccionPlantilla,
  usuario,
} from '@/db/esquema';
import { PARTIDAS, RESTRICCIONES, sembrarDatosMaestros } from '@/db/semillas/datos-maestros';
import { sembrarDesarrollo, USUARIOS_DESARROLLO } from '@/server/semillas';
import { cargarActorPorId } from '@/server/politicas/actor';
import { listarReferencias, vistaFicha } from '@/server/politicas/referencias';
import { nuevaBd } from './ayudas';
import type { Conexion } from '@/db/conexion';

let c: Conexion;
beforeAll(async () => {
  c = await nuevaBd();
});
afterAll(async () => {
  await c.cerrar();
});

describe('datos maestros', () => {
  it('cargan catalogos, restricciones y las 7 partidas del Apendice A, cada una con su restriccion', async () => {
    const items = await c.db.select().from(catalogoItem);
    const por = (cat: string) => items.filter((i) => i.catalogo === cat).map((i) => i.valor);
    expect(por('unidad_medida')).toEqual(expect.arrayContaining(['Litros', 'Kilogramos', 'Galones', 'Gramos', 'Unidades', 'Paquete']));
    expect(por('aspecto_fisico')).toEqual(expect.arrayContaining(['Líquido', 'Sólido', 'Polvo', 'Gel', 'Pasta', 'Gas', 'Otro']));
    expect(por('sugerencia_empaque')).toEqual(expect.arrayContaining(['Bidón', 'Galón', 'Bolsa']));

    expect(await c.db.select().from(restriccionPlantilla)).toHaveLength(4);
    const partidas = await c.db.select().from(partidaArancelaria);
    expect(partidas.map((p) => p.codigo).sort()).toEqual(PARTIDAS.map((p) => p.codigo).sort());
    expect(partidas.every((p) => p.origen === 'semilla' && p.restriccionId && p.descripcion)).toBe(true);
  });

  it('es idempotente: ejecutarlo de nuevo no duplica nada', async () => {
    const antes = {
      items: (await c.db.select().from(catalogoItem)).length,
      restricciones: (await c.db.select().from(restriccionPlantilla)).length,
      partidas: (await c.db.select().from(partidaArancelaria)).length,
    };
    await sembrarDatosMaestros(c.db);
    await sembrarDatosMaestros(c.db);
    expect((await c.db.select().from(catalogoItem)).length).toBe(antes.items);
    expect((await c.db.select().from(restriccionPlantilla)).length).toBe(antes.restricciones);
    expect((await c.db.select().from(partidaArancelaria)).length).toBe(antes.partidas);
  });

  it('CA-22: el motor 8501.31.20.00 trae su restriccion del catalogo (RETIE, RETIQ, RAEE)', async () => {
    const [p] = await c.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '8501.31.20.00'));
    const [r] = await c.db.select().from(restriccionPlantilla).where(eq(restriccionPlantilla.id, p!.restriccionId!));
    expect(r!.codigo).toBe('RES-8501.31.20.00');
    expect(r!.texto).toContain('RETIQ');
    expect(p!.descripcion).toBe('Motores eléctricos');
  });
  it('las restricciones conservan el texto original, errores incluidos', () => {
    expect(RESTRICCIONES.find((r) => r.codigo === 'RES-SIN')!.texto).toBe(
      'Sin Restricciones\n(Siempre y cuando la mercancía sea nueva, no sea saldo ni presente condiciones especiales de mercado)',
    );
    expect(RESTRICCIONES.find((r) => r.codigo === 'RES-8501.31.20.00')!.texto).toContain('Para está subpartida');
    expect(RESTRICCIONES.find((r) => r.codigo === 'RES-8501.31.20.00')!.texto).toContain('Excluído de RETIQ  ya que');
  });

  it('la base rechaza una partida con formato invalido', async () => {
    await expect(c.db.insert(partidaArancelaria).values({ codigo: '8421399000', origen: 'aduana' })).rejects.toThrow();
  });
});

describe('semillas de desarrollo', () => {
  beforeAll(async () => {
    await sembrarDesarrollo(c.db);
  });

  it('crean organizaciones y usuarios claramente marcados como DESARROLLO, con correos .invalid', async () => {
    const orgs = await c.db.select().from(organizacion);
    expect(orgs.every((o) => o.nombre.includes('[DESARROLLO]'))).toBe(true);
    const us = await c.db.select().from(usuario);
    expect(us).toHaveLength(USUARIOS_DESARROLLO.length);
    expect(us.every((u) => u.email.endsWith('@desarrollo.invalid') && u.nombre.includes('[DESARROLLO]'))).toBe(true);
    expect(us.some((u) => u.organizacionTipo === 'agencia' && u.rol === 'aduana')).toBe(true);
  });

  it('crean 3 referencias de ejemplo sinteticas (TEST-000n) y es idempotente', async () => {
    await sembrarDesarrollo(c.db);
    const refs = await c.db.select().from(referencia).orderBy(referencia.codigo);
    expect(refs.map((r) => r.codigo)).toEqual(['TEST-0001', 'TEST-0002', 'TEST-0003']);
    expect(refs.every((r) => r.nombreProducto.includes('(ejemplo)'))).toBe(true);
    expect(refs.map((r) => r.estado)).toEqual(['BORRADOR', 'EN_GESTION', 'BORRADOR']);
  });

  it('el historial es completo y la agencia A ve solo la referencia enviada a ella (B nada)', async () => {
    const todas = await c.db.select().from(referencia);
    for (const r of todas) {
      const hechos = await c.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, r.id));
      expect(new Set(hechos.map((h) => h.campo)).size, r.codigo).toBe(Object.keys(r.datos).length);
    }
    const [a] = await c.db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'aduana-a@desarrollo.invalid'));
    const [b] = await c.db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'aduana-b@desarrollo.invalid'));
    const actorA = (await cargarActorPorId(c.db, a!.id))!;
    const actorB = (await cargarActorPorId(c.db, b!.id))!;
    expect((await listarReferencias(c.db, actorA, { ahora: new Date() })).map((x) => x.codigo)).toEqual(['TEST-0002']);
    expect(await listarReferencias(c.db, actorB, { ahora: new Date() })).toEqual([]);
  });

  it('el insumo de ejemplo calcula semaforo amarillo con faltantes visibles', async () => {
    const [r] = await c.db.select().from(referencia).where(eq(referencia.codigo, 'TEST-0001'));
    const [admin] = await c.db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'admin@desarrollo.invalid'));
    const v = await vistaFicha(c.db, (await cargarActorPorId(c.db, admin!.id))!, r!.id, new Date());
    expect(v.color).toBe('amarillo');
    expect(v.completitud.secciones.producto.estado).toBe('verde');
    expect(v.completitud.aduana.faltan).toBeGreaterThan(0);
    expect(v.campos.requiere_rim!.valor).toBe('SI');
    expect(v.campos.cantidad_rim!.valor).toEqual({ valor: '156', expresion: '13x12' });
  });
});
