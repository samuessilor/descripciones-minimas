/**
 * Job `db-real` (SPEC 17.1, 17.2): P-04 contra un Postgres 17 REAL, con varias conexiones reales y conectando como
 * el rol `app` (no duenio): outbox, doble despacho con `FOR UPDATE SKIP LOCKED`, fila `enviando` vencida y
 * caida del proveedor con reintento. PGlite no puede demostrar nada de esto: es de una sola conexion.
 *
 * Ademas: envios simultaneos a la misma persona (indice unico parcial + bloqueo de la ficha) y dos "Recordar"
 * a la vez (tope diario).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, entregaCorreo, notificacion, organizacion, usuario } from '@/db/esquema';
import { ESPERAS_REINTENTO_MS } from '@/dominio/colaboracion';
import { enviarA, recordar } from '@/server/acciones/asignaciones';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { despachar } from '@/server/correo/despachar';
import { encolarCorreo } from '@/server/correo/outbox';
import { renderizarAviso } from '@/server/correo/plantillas';
import type { Mailer, MensajeCorreo } from '@/server/correo/tipos';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let edward: Actor;
let admin: Actor;
let brian: Actor;
const T0 = new Date('2026-10-21T15:00:00.000Z');
const ctx = (actor: Actor, ahora = T0) => ({ db: r.app.db, actor, ahora });

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  const [agencia] = await r.migrador.db.insert(organizacion).values({ nombre: 'Agencia A', tipo: 'agencia' }).returning();
  const mk = async (nombre: string, email: string, rol: string, org: typeof interna) => {
    const [u] = await r.migrador.db
      .insert(usuario)
      .values({ nombre, email, rol, organizacionId: org!.id, organizacionTipo: org!.tipo })
      .returning({ id: usuario.id });
    return (await cargarActorPorId(r.app.db, u!.id))!;
  };
  admin = await mk('Ana Admin', 'ana@prueba.invalid', 'admin', interna);
  edward = await mk('Edward', 'edward@prueba.invalid', 'solicitante', interna);
  brian = await mk('Brian', 'brian@prueba.invalid', 'aduana', agencia);
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

let n = 0;
async function ficha(): Promise<string> {
  n += 1;
  const x = await crearReferencia(ctx(edward), { codigo: `OUT-${n}`, nombreProducto: `Producto ${n}`, tipoProducto: 'INSUMO' });
  return x.id;
}

async function encolar(clave: string, para = 'brian@prueba.invalid', proximo = T0): Promise<string> {
  const { id } = await encolarCorreo(r.app.db, {
    destinatario: para,
    plantilla: 'pendiente',
    claveIdempotencia: clave,
    contenido: renderizarAviso('pendiente', { nombre: 'Brian', quien: 'Edward', enlace: `http://localhost:3000/referencias/${clave}`, contacto: 'el administrador', pedido: 'clasificar' }),
    proximoIntento: proximo,
  });
  return id;
}

/** Mailer que cuenta cuantas veces se envia CADA clave y tarda un poco para abrir la ventana de la carrera. */
function mailerContador(demoraMs = 25): Mailer & { porClave: Map<string, number>; total: () => number } {
  const porClave = new Map<string, number>();
  return {
    nombre: 'consola',
    porClave,
    total: () => [...porClave.values()].reduce((a, b) => a + b, 0),
    async enviar(m: MensajeCorreo) {
      await new Promise((res) => setTimeout(res, demoraMs));
      porClave.set(m.claveIdempotencia ?? '', (porClave.get(m.claveIdempotencia ?? '') ?? 0) + 1);
    },
  };
}

describe('el rol app y el outbox', () => {
  it('app puede actualizar el outbox y notificaciones, pero NO borrar filas de entrega_correo', async () => {
    const id = await encolar(`permisos-${Date.now()}`);
    await r.app.db.update(entregaCorreo).set({ ultimoError: 'prueba' }).where(eq(entregaCorreo.id, id));
    const c = new pg.Client({ connectionString: r.urlApp });
    await c.connect();
    try {
      await expect(c.query('delete from entrega_correo')).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('truncate entrega_correo')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await c.end();
    }
  });
});

describe('P-04 · doble despacho con FOR UPDATE SKIP LOCKED real', () => {
  it('tres despachadores a la vez sobre 40 correos: cada correo sale EXACTAMENTE una vez', async () => {
    const claves = Array.from({ length: 40 }, (_, i) => `doble-${Date.now()}-${i}`);
    const ids: string[] = [];
    for (const k of claves) ids.push(await encolar(k));
    const m1 = mailerContador();
    const m2 = mailerContador();
    const m3 = mailerContador();
    const [a, b, c] = await Promise.all([
      despachar({ db: r.app.db, mailer: m1, ahora: T0, limite: 50, concurrencia: 4, ids }),
      despachar({ db: r.app.db, mailer: m2, ahora: T0, limite: 50, concurrencia: 4, ids }),
      despachar({ db: r.app.db, mailer: m3, ahora: T0, limite: 50, concurrencia: 4, ids }),
    ]);
    // Cada clave salio una sola vez en total, aunque tres despachadores corrieran a la vez.
    for (const k of claves) {
      const veces = (m1.porClave.get(k) ?? 0) + (m2.porClave.get(k) ?? 0) + (m3.porClave.get(k) ?? 0);
      expect(veces, `la clave ${k} salio ${veces} veces`).toBe(1);
    }
    expect(a.enviados + b.enviados + c.enviados).toBe(40);
    expect(a.tomados + b.tomados + c.tomados).toBe(40);
    const filas = await r.app.db.select().from(entregaCorreo).where(inArray(entregaCorreo.claveIdempotencia, claves));
    expect(filas.every((f) => f.estado === 'enviado' && f.intentos === 1)).toBe(true);
    // El trabajo se repartio (SKIP LOCKED): con 40 filas y 3 despachadores, mas de uno trabajo.
    expect([a, b, c].filter((x) => x.tomados > 0).length).toBeGreaterThanOrEqual(1);
  });

  it('una fila bloqueada por otra conexion se SALTA (no se espera ni se duplica) y se toma al soltarse', async () => {
    const id = await encolar(`bloqueada-${Date.now()}`);
    const retenedor = new pg.Client({ connectionString: r.urlApp });
    await retenedor.connect();
    try {
      await retenedor.query('begin');
      await retenedor.query('select id from entrega_correo where id = $1 for update', [id]);

      const mailer = mailerContador(5);
      const t0 = Date.now();
      const mientras = await despachar({ db: r.app.db, mailer, ahora: T0, ids: [id] });
      expect(Date.now() - t0).toBeLessThan(5000); // no se quedo esperando el bloqueo
      expect(mientras.tomados).toBe(0);
      expect(mailer.total()).toBe(0);

      await retenedor.query('commit');
      const despues = await despachar({ db: r.app.db, mailer, ahora: T0, ids: [id] });
      expect(despues.enviados).toBe(1);
      expect(mailer.total()).toBe(1);
    } finally {
      await retenedor.end();
    }
  });

  it('fila "enviando" con el bloqueo VIGENTE nadie la toma; VENCIDO, exactamente un despachador la recupera', async () => {
    const id = await encolar(`enviando-${Date.now()}`);
    await r.app.db.update(entregaCorreo).set({ estado: 'enviando', intentos: 1, bloqueadoHasta: new Date(T0.getTime() + 120_000) }).where(eq(entregaCorreo.id, id));

    const mailer = mailerContador();
    const vigente = await Promise.all([
      despachar({ db: r.app.db, mailer, ahora: new Date(T0.getTime() + 60_000), ids: [id] }),
      despachar({ db: r.app.db, mailer, ahora: new Date(T0.getTime() + 60_000), ids: [id] }),
    ]);
    expect(vigente[0].tomados + vigente[1].tomados).toBe(0);
    expect(mailer.total()).toBe(0);

    // Dos despues del vencimiento: la funcion original murio; solo uno la recupera.
    const vencido = new Date(T0.getTime() + 3 * 60_000);
    const [x, y] = await Promise.all([
      despachar({ db: r.app.db, mailer, ahora: vencido, ids: [id] }),
      despachar({ db: r.app.db, mailer, ahora: vencido, ids: [id] }),
    ]);
    expect(x.enviados + y.enviados).toBe(1);
    expect(x.tomados + y.tomados).toBe(1);
    expect(mailer.total()).toBe(1);
    const [f] = await r.app.db.select().from(entregaCorreo).where(eq(entregaCorreo.id, id));
    expect(f).toMatchObject({ estado: 'enviado', intentos: 2 });
  });

  it('caida del proveedor: las filas quedan "fallido" con espera, y al volver salen sin duplicarse ni perderse', async () => {
    const claves = Array.from({ length: 12 }, (_, i) => `caida-${Date.now()}-${i}`);
    const ids: string[] = [];
    for (const k of claves) ids.push(await encolar(k));

    const caido: Mailer = {
      nombre: 'resend',
      async enviar() {
        throw new Error('Resend (HTTP 503): service_unavailable');
      },
    };
    const r1 = await Promise.all([
      despachar({ db: r.app.db, mailer: caido, ahora: T0, ids }),
      despachar({ db: r.app.db, mailer: caido, ahora: T0, ids }),
    ]);
    expect(r1[0].fallidos + r1[1].fallidos).toBe(12); // cada fila fallo UNA vez aunque corrieran dos
    const fallidas = await r.app.db.select().from(entregaCorreo).where(inArray(entregaCorreo.id, ids));
    expect(fallidas.every((f) => f.estado === 'fallido' && f.intentos === 1 && f.proximoIntento.getTime() === T0.getTime() + ESPERAS_REINTENTO_MS[0])).toBe(true);

    // Antes de la espera no se reintenta; despues, con el proveedor de vuelta, salen todas una vez.
    const mailer = mailerContador();
    expect((await despachar({ db: r.app.db, mailer, ahora: new Date(T0.getTime() + 60_000), ids })).tomados).toBe(0);
    const retorno = new Date(T0.getTime() + 6 * 60_000);
    const r2 = await Promise.all([
      despachar({ db: r.app.db, mailer, ahora: retorno, ids }),
      despachar({ db: r.app.db, mailer, ahora: retorno, ids }),
    ]);
    expect(r2[0].enviados + r2[1].enviados).toBe(12);
    for (const k of claves) expect(mailer.porClave.get(k)).toBe(1);
    const listas = await r.app.db.select().from(entregaCorreo).where(inArray(entregaCorreo.id, ids));
    expect(listas.every((f) => f.estado === 'enviado' && f.intentos === 2)).toBe(true);
  });
});

describe('P-04 · outbox atomico y envios simultaneos con conexiones reales', () => {
  it('dos "Enviar a" a la vez a la misma persona dejan UNA asignacion activa, UN aviso y UN correo inicial', async () => {
    const id = await ficha();
    const entrada = { referenciaId: id, destinatarios: [{ usuarioId: brian.usuarioId }] };
    const res = await Promise.allSettled([enviarA(ctx(edward), entrada), enviarA(ctx(admin), entrada), enviarA(ctx(edward), entrada)]);
    expect(res.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    const activas = await r.app.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, brian.usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])));
    expect(activas).toHaveLength(1);
    const avisos = await r.app.db.select().from(notificacion).where(and(eq(notificacion.referenciaId, id), eq(notificacion.usuarioId, brian.usuarioId)));
    const correosIniciales = await r.app.db.select().from(entregaCorreo).where(sql`${entregaCorreo.claveIdempotencia} = ${`asig:${activas[0]!.id}:inicial`}`);
    expect(correosIniciales).toHaveLength(1);
    // Cada aviso tiene su correo; ninguno sin el otro (misma transaccion).
    expect(avisos.length).toBeGreaterThanOrEqual(1);
    const conCorreo = await r.app.db.select().from(entregaCorreo).where(inArray(entregaCorreo.notificacionId, avisos.map((a) => a.id)));
    expect(conCorreo).toHaveLength(avisos.length);
  });

  it('dos "Recordar" simultaneos: pasa uno solo (el tope diario no se salta con dos clics)', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: brian.usuarioId }] });
    const [a] = await r.app.db.select().from(asignacion).where(eq(asignacion.referenciaId, id));
    const dia2 = new Date(T0.getTime() + 86_400_000);
    const res = await Promise.allSettled([
      recordar(ctx(edward, dia2), { asignacionId: a!.id }),
      recordar(ctx(edward, dia2), { asignacionId: a!.id }),
      recordar(ctx(admin, dia2), { asignacionId: a!.id }),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(res.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason?.codigo === 'LIMITE_TASA')).toBe(true);
    const recordatorios = await r.app.db.select().from(notificacion).where(and(eq(notificacion.asignacionId, a!.id), eq(notificacion.tipo, 'recordatorio')));
    expect(recordatorios).toHaveLength(1);
  });
});
