/**
 * Retencion minima (src/server/retencion.ts y GET /api/cron/retencion), con PGlite:
 *  - borra por umbrales y SOLO lo vencido (nunca una fila reciente ni un aviso sin leer reciente);
 *  - es idempotente, respeta el tamano de lote y avisa si queda trabajo;
 *  - deja UNA fila compacta de auditoria, y solo si borro algo;
 *  - no toca las tablas inmutables;
 *  - la ruta falla cerrada (503 sin secreto o con uno de menos de 16 caracteres, 401 con secreto ausente o errado)
 *    y el proxy la deja pasar sin sesion.
 */
import { count, desc, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  auditoria,
  campoHistorial,
  comentario,
  edicionActiva,
  limiteTasa,
  notificacion,
  session,
  textoDescartado,
  verification,
} from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { ejecutarRetencion, UMBRALES } from '@/server/retencion';
import { getConfig, reiniciarConfig } from '@/server/config';
import { proxy } from '@/proxy';
import { nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

// La ruta pide la base con getDb(): se le entrega la de la prueba.
const dbRef: { db?: Db } = {};
vi.mock('@/db', () => ({ getDb: () => dbRef.db }));

const { GET } = await import('@/app/api/cron/retencion/route');

const AHORA = new Date('2026-11-09T19:00:00.000Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const DIA = 86_400_000;
const HORA = 3_600_000;

let e: Escenario;
let ficha: string;
let n = 0;

beforeAll(async () => {
  e = await nuevoEscenario();
  dbRef.db = e.db;
  ficha = await nuevaFicha(e);
});
afterAll(async () => {
  await e.c.cerrar();
});

async function vaciar() {
  await e.db.delete(notificacion);
  await e.db.delete(limiteTasa);
  await e.db.delete(edicionActiva);
  await e.db.delete(session);
  await e.db.delete(verification);
}

async function aviso(opc: { leidaEn?: Date | null; creadaEn: Date }) {
  n += 1;
  const [f] = await e.db
    .insert(notificacion)
    .values({
      usuarioId: e.edward.usuarioId,
      tipo: 'comentario',
      referenciaId: ficha,
      titulo: `aviso ${n}`,
      leidaEn: opc.leidaEn ?? null,
      creadaEn: opc.creadaEn,
    })
    .returning({ id: notificacion.id });
  return f!.id;
}

async function sesion(expiresAt: Date) {
  n += 1;
  await e.db.insert(session).values({ expiresAt, token: `tok-${n}`, userId: e.edward.usuarioId });
}

async function total(tabla: typeof notificacion | typeof limiteTasa | typeof edicionActiva | typeof session | typeof verification): Promise<number> {
  return (await e.db.select({ c: count() }).from(tabla))[0]!.c;
}

describe('ejecutarRetencion: umbrales', () => {
  beforeEach(vaciar);

  it('avisos: leidos de hace mas de 30 dias (desde que se leyeron) y sin leer de hace mas de 90; nada reciente', async () => {
    const vieja = await aviso({ leidaEn: hace(31 * DIA), creadaEn: hace(60 * DIA) });
    const sinLeerVieja = await aviso({ creadaEn: hace(91 * DIA) });
    const leidaReciente = await aviso({ leidaEn: hace(29 * DIA), creadaEn: hace(100 * DIA) }); // creada hace mucho, leida hace poco: se conserva
    const sinLeer = await aviso({ creadaEn: hace(89 * DIA) }); // sin leer de hace 89 dias: se conserva
    const nueva = await aviso({ creadaEn: hace(1 * HORA) });

    const r = await ejecutarRetencion(e.db, { ahora: AHORA });
    expect(r).toMatchObject({ avisosLeidos: 1, avisosSinLeer: 1, total: 2, quedaPendiente: false });
    const quedan = (await e.db.select({ id: notificacion.id }).from(notificacion)).map((x) => x.id).sort();
    expect(quedan).toEqual([leidaReciente, sinLeer, nueva].sort());
    expect(quedan).not.toContain(vieja);
    expect(quedan).not.toContain(sinLeerVieja);
  });

  it('limite de tasa: ventanas de mas de 2 dias; edicion activa: vencida hace mas de 1 hora', async () => {
    await e.db.insert(limiteTasa).values([
      { clave: 'a', ventana: hace(3 * DIA), contador: 1 },
      { clave: 'a', ventana: hace(1 * DIA), contador: 1 },
      { clave: 'b', ventana: hace(2 * HORA), contador: 4 },
    ]);
    await e.db.insert(edicionActiva).values([
      { referenciaId: ficha, campo: 'uso', usuarioId: e.edward.usuarioId, hasta: hace(2 * HORA) }, // vencida hace 2 h
      { referenciaId: ficha, campo: 'funciones', usuarioId: e.edward.usuarioId, hasta: hace(30 * 60_000) }, // vencida hace 30 min
      { referenciaId: ficha, campo: 'detalle', usuarioId: e.charles.usuarioId, hasta: new Date(AHORA.getTime() + 45_000) }, // vigente
    ]);

    const r = await ejecutarRetencion(e.db, { ahora: AHORA });
    expect(r).toMatchObject({ limiteTasa: 1, edicionesVencidas: 1, total: 2 });
    expect(await total(limiteTasa)).toBe(2);
    expect((await e.db.select({ campo: edicionActiva.campo }).from(edicionActiva)).map((x) => x.campo).sort()).toEqual(['detalle', 'funciones']);
  });

  it('sesiones vencidas hace mas de 7 dias y verificaciones vencidas hace mas de 1 dia; las vigentes y las recien vencidas se quedan', async () => {
    await sesion(hace(8 * DIA));
    await sesion(hace(6 * DIA));
    await sesion(new Date(AHORA.getTime() + DIA));
    await e.db.insert(verification).values([
      { identifier: 'x', value: '1', expiresAt: hace(2 * DIA) },
      { identifier: 'y', value: '2', expiresAt: hace(2 * HORA) },
    ]);

    const r = await ejecutarRetencion(e.db, { ahora: AHORA });
    expect(r).toMatchObject({ sesiones: 1, verificaciones: 1, total: 2 });
    expect(await total(session)).toBe(2);
    expect(await total(verification)).toBe(1);
  });

  it('los umbrales son los documentados', () => {
    expect(UMBRALES).toEqual({
      avisoLeidoMs: 30 * DIA,
      avisoSinLeerMs: 90 * DIA,
      limiteTasaMs: 2 * DIA,
      edicionVencidaMs: HORA,
      sesionVencidaMs: 7 * DIA,
      verificacionVencidaMs: DIA,
    });
  });
});

describe('ejecutarRetencion: lotes, idempotencia y auditoria', () => {
  beforeEach(vaciar);

  it('borra por lotes acotados y repite hasta vaciar lo vencido; la segunda corrida no hace nada', async () => {
    for (let i = 0; i < 7; i += 1) await aviso({ leidaEn: hace(40 * DIA), creadaEn: hace(45 * DIA) });
    const reciente = await aviso({ creadaEn: hace(HORA) });

    const r = await ejecutarRetencion(e.db, { ahora: AHORA, lote: 3 }); // 3 + 3 + 1
    expect(r.avisosLeidos).toBe(7);
    expect(r.quedaPendiente).toBe(false);
    expect((await e.db.select({ id: notificacion.id }).from(notificacion)).map((x) => x.id)).toEqual([reciente]);

    const otra = await ejecutarRetencion(e.db, { ahora: AHORA, lote: 3 });
    expect(otra).toMatchObject({ total: 0, quedaPendiente: false });
  });

  it('un lote exacto no se confunde con trabajo pendiente: el siguiente lote devuelve 0 y termina', async () => {
    for (let i = 0; i < 3; i += 1) await aviso({ leidaEn: hace(40 * DIA), creadaEn: hace(45 * DIA) });
    const r = await ejecutarRetencion(e.db, { ahora: AHORA, lote: 3 });
    expect(r).toMatchObject({ avisosLeidos: 3, quedaPendiente: false });
  });

  it('deja UNA fila de auditoria compacta por corrida, solo si borro algo', async () => {
    const filas = async () => (await e.db.select({ c: count() }).from(auditoria).where(eq(auditoria.accion, 'retencion')))[0]!.c;
    const base = await filas();

    expect((await ejecutarRetencion(e.db, { ahora: AHORA })).total).toBe(0);
    expect(await filas()).toBe(base); // sin nada que borrar: sin fila

    await aviso({ leidaEn: hace(40 * DIA), creadaEn: hace(45 * DIA) });
    await sesion(hace(9 * DIA));
    await ejecutarRetencion(e.db, { ahora: AHORA });
    expect(await filas()).toBe(base + 1);

    const [fila] = await e.db.select().from(auditoria).where(eq(auditoria.accion, 'retencion')).orderBy(desc(auditoria.id)).limit(1); // la ultima
    expect(fila).toMatchObject({ usuarioId: null, entidad: 'sistema', entidadId: 'retencion' });
    expect(fila!.detalle).toMatchObject({ avisosLeidos: 1, sesiones: 1, total: 2, quedaPendiente: false });

    await ejecutarRetencion(e.db, { ahora: AHORA }); // idempotente
    expect(await filas()).toBe(base + 1);
  });

  it('no toca las tablas inmutables ni los datos de negocio', async () => {
    const cuentas = async () => ({
      historial: (await e.db.select({ c: count() }).from(campoHistorial))[0]!.c,
      comentarios: (await e.db.select({ c: count() }).from(comentario))[0]!.c,
      descartados: (await e.db.select({ c: count() }).from(textoDescartado))[0]!.c,
    });
    const antes = await cuentas();
    await aviso({ leidaEn: hace(400 * DIA), creadaEn: hace(400 * DIA) });
    await ejecutarRetencion(e.db, { ahora: new Date(AHORA.getTime() + 400 * DIA) }); // muy en el futuro: todo es viejo
    expect(await cuentas()).toEqual(antes);
  });
});

describe('GET /api/cron/retencion', () => {
  // La ruta usa el reloj real: las fechas de estas pruebas se cuentan desde ahora, no desde AHORA.
  const haceReal = (ms: number) => new Date(Date.now() - ms);
  const SECRETO = 'secreto-del-cron-0123456789';
  const peticion = (cabeceras: Record<string, string> = {}) => new Request('http://localhost:3000/api/cron/retencion', { headers: cabeceras });

  beforeEach(async () => {
    await vaciar();
    reiniciarConfig();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    reiniciarConfig();
  });

  it('sin CRON_SECRET definido responde 503 y NO ejecuta nada (falla cerrado), aunque llegue un Bearer', async () => {
    await aviso({ leidaEn: haceReal(60 * DIA), creadaEn: haceReal(61 * DIA) });
    vi.stubEnv('CRON_SECRET', '');
    const r = await GET(peticion({ authorization: `Bearer ${SECRETO}` }));
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await total(notificacion)).toBe(1);
  });

  it('con secreto ausente, errado o con otro esquema responde 401 y no borra', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    await aviso({ leidaEn: haceReal(60 * DIA), creadaEn: haceReal(61 * DIA) });
    for (const cabeceras of <Array<Record<string, string>>>[{}, { authorization: 'Bearer otro-secreto-0123456789' }, { authorization: SECRETO }, { authorization: `Basic ${SECRETO}` }, { authorization: 'Bearer ' }]) {
      const r = await GET(peticion(cabeceras));
      expect(r.status, JSON.stringify(cabeceras)).toBe(401);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(await total(notificacion)).toBe(1);
  });

  it('con el secreto correcto ejecuta la retencion y responde los conteos y los ms', async () => {
    vi.stubEnv('CRON_SECRET', SECRETO);
    await aviso({ leidaEn: haceReal(60 * DIA), creadaEn: haceReal(61 * DIA) });
    await aviso({ creadaEn: haceReal(HORA) });
    const r = await GET(peticion({ authorization: `Bearer ${SECRETO}` }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({ ok: true, avisosLeidos: 1, quedaPendiente: false, ms: expect.any(Number) });
    expect(await total(notificacion)).toBe(1);
  });

  it('un CRON_SECRET demasiado corto falla cerrado (503, no ejecuta nada) y NO tumba la configuracion global', async () => {
    await aviso({ leidaEn: haceReal(60 * DIA), creadaEn: haceReal(61 * DIA) });
    vi.stubEnv('CRON_SECRET', 'corto');
    expect(() => getConfig()).not.toThrow(); // el resto de la aplicacion sigue arrancando
    const r = await GET(peticion({ authorization: 'Bearer corto' }));
    expect(r.status).toBe(503);
    expect((await r.json()).mensaje).toContain('secreto no configurado');
    expect(await total(notificacion)).toBe(1);
  });

  it('el proxy la deja pasar sin cookie ni Origin (GET), con cabeceras de seguridad', () => {
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    const r = proxy(new NextRequest(new URL('http://localhost:3000/api/cron/retencion')));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
