/**
 * H3 · Outbox y despachador de correo (SPEC 14, P-04 en su parte logica): envio, reintentos con espera
 * creciente, recuperacion de filas `enviando` vencidas, tope de intentos, idempotencia del encolado y
 * atomicidad con la accion. PGlite es una sola conexion: la carrera real de dos despachadores vive en
 * tests/db-real/colaboracion-outbox.test.ts.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { correoDev, entregaCorreo, usuario } from '@/db/esquema';
import { BLOQUEO_ENVIO_MS, ESPERAS_REINTENTO_MS, MAX_INTENTOS_CORREO } from '@/dominio/colaboracion';
import { crearMailerConsola, crearMailerMemoria, fallaSimulada } from '@/server/correo/consola';
import { contarCola, despachar } from '@/server/correo/despachar';
import { encolarCorreo } from '@/server/correo/outbox';
import { renderizarAviso } from '@/server/correo/plantillas';
import type { Mailer, MensajeCorreo } from '@/server/correo/tipos';
import { nuevoEscenario, type Escenario } from './ayudas';

let e: Escenario;
const T0 = new Date('2026-10-21T15:00:00.000Z');
const min = (n: number) => n * 60_000;
const en = (base: Date, ms: number) => new Date(base.getTime() + ms);

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

let n = 0;
async function encolar(para = 'brian@prueba.invalid', opciones: { proximoIntento?: Date } = {}): Promise<string> {
  n += 1;
  const contenido = renderizarAviso('pendiente', {
    nombre: 'Brian',
    quien: 'Edward',
    enlace: `http://localhost:3000/referencias/00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    contacto: 'el administrador',
    pedido: 'clasificar',
  });
  const { id } = await encolarCorreo(e.db, {
    destinatario: para,
    plantilla: 'pendiente',
    claveIdempotencia: `prueba:${n}:${Math.random()}`,
    contenido,
    proximoIntento: opciones.proximoIntento ?? T0,
  });
  return id;
}

async function fila(id: string) {
  const [f] = await e.db.select().from(entregaCorreo).where(eq(entregaCorreo.id, id));
  return f!;
}

function fallador(mensaje = 'Resend (HTTP 503): service_unavailable'): Mailer & { llamadas: MensajeCorreo[] } {
  const llamadas: MensajeCorreo[] = [];
  return {
    nombre: 'resend',
    llamadas,
    async enviar(m) {
      llamadas.push(m);
      throw new Error(mensaje);
    },
  };
}

describe('envio normal', () => {
  it('pendiente -> enviado, con el payload guardado, el enlace y la clave de idempotencia', async () => {
    const id = await encolar();
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
    expect(r).toMatchObject({ tomados: 1, enviados: 1, fallidos: 0, abandonados: 0 });
    const f = await fila(id);
    expect(f.estado).toBe('enviado');
    expect(f.intentos).toBe(1);
    expect(f.enviadoEn).not.toBeNull();
    expect(f.ultimoError).toBeNull();
    expect(f.bloqueadoHasta).toBeNull();
    const m = mailer.enviados[0]!;
    expect(m.para).toBe('brian@prueba.invalid');
    expect(m.asunto).toBe(f.asunto);
    expect(m.texto).toBe(f.cuerpoTexto);
    expect(m.html).toBe(f.cuerpoHtml);
    expect(m.claveIdempotencia).toBe(f.claveIdempotencia);
    expect(m.enlace).toMatch(/^http:\/\/localhost:3000\/referencias\//);
  });

  it('un correo enviado no sale otra vez aunque el despachador corra muchas veces', async () => {
    const id = await encolar();
    const mailer = crearMailerMemoria();
    await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
    const conteo = mailer.enviados.length;
    for (let i = 0; i < 4; i++) await despachar({ db: e.db, mailer, ahora: en(T0, min(10 + i)) });
    await despachar({ db: e.db, mailer, ahora: en(T0, min(10)), ids: [id] });
    expect(mailer.enviados.length).toBeGreaterThanOrEqual(conteo);
    expect(mailer.enviados.filter((m) => m.claveIdempotencia === (mailer.enviados[0]?.claveIdempotencia ?? ''))).toHaveLength(1);
    expect((await fila(id)).intentos).toBe(1);
  });

  it('dos despachadores seguidos: el segundo no encuentra nada que enviar', async () => {
    const id = await encolar('charles@prueba.invalid');
    const m1 = crearMailerMemoria();
    const m2 = crearMailerMemoria();
    const [a, b] = await Promise.all([despachar({ db: e.db, mailer: m1, ahora: T0, ids: [id] }), despachar({ db: e.db, mailer: m2, ahora: T0, ids: [id] })]);
    expect(a.enviados + b.enviados).toBe(1);
    expect(m1.enviados.length + m2.enviados.length).toBe(1);
    expect((await fila(id)).intentos).toBe(1);
  });

  it('encolar dos veces la misma clave no duplica la fila (idempotencia del outbox)', async () => {
    const contenido = renderizarAviso('recordatorio', { nombre: 'A', quien: 'B', enlace: 'http://localhost:3000/', contacto: 'x' });
    const a = await encolarCorreo(e.db, { destinatario: 'a@x.invalid', plantilla: 'recordatorio', claveIdempotencia: 'clave-unica-1', contenido });
    const b = await encolarCorreo(e.db, { destinatario: 'a@x.invalid', plantilla: 'recordatorio', claveIdempotencia: 'clave-unica-1', contenido });
    expect(a.creado).toBe(true);
    expect(b.creado).toBe(false);
    expect(b.id).toBe(a.id);
  });

  it('la fila de correo nace con la accion: si la transaccion falla no queda nada en la cola', async () => {
    const antes = (await e.db.select().from(entregaCorreo)).length;
    const contenido = renderizarAviso('pendiente', { nombre: 'A', quien: 'B', enlace: 'http://localhost:3000/', contacto: 'x' });
    await expect(
      e.db.transaction(async (tx) => {
        await encolarCorreo(tx, { destinatario: 'a@x.invalid', plantilla: 'pendiente', claveIdempotencia: 'se-revierte', contenido });
        throw new Error('falla la accion despues de encolar');
      }),
    ).rejects.toThrow();
    expect((await e.db.select().from(entregaCorreo)).length).toBe(antes);
  });
});

describe('caida del proveedor: reintentos con espera creciente (P-04)', () => {
  it('falla -> fallido, espera 5 min, no reintenta antes, y despues sale; el pendiente nunca se pierde', async () => {
    const id = await encolar();
    const roto = fallador();
    const r1 = await despachar({ db: e.db, mailer: roto, ahora: T0, ids: [id] });
    expect(r1).toMatchObject({ tomados: 1, enviados: 0, fallidos: 1 });
    let f = await fila(id);
    expect(f.estado).toBe('fallido');
    expect(f.intentos).toBe(1);
    expect(f.ultimoError).toContain('503');
    expect(f.proximoIntento.getTime()).toBe(T0.getTime() + ESPERAS_REINTENTO_MS[0]);

    // 4 minutos despues: todavia no toca.
    const antes = await despachar({ db: e.db, mailer: roto, ahora: en(T0, min(4)) });
    expect(antes.tomados).toBe(0);
    // A los 6 minutos el proveedor volvio.
    const bueno = crearMailerMemoria();
    const r2 = await despachar({ db: e.db, mailer: bueno, ahora: en(T0, min(6)) });
    expect(r2.enviados).toBe(1);
    f = await fila(id);
    expect(f.estado).toBe('enviado');
    expect(f.intentos).toBe(2);
    expect(f.ultimoError).toBeNull();
    expect(bueno.enviados[0]?.claveIdempotencia).toBe(f.claveIdempotencia); // la misma clave hacia el proveedor
    expect(bueno.enviados[0]?.html).toBe(f.cuerpoHtml); // exactamente el mismo cuerpo
  });

  it('seis intentos en total con esperas 5 min, 30 min, 2 h, 12 h y 24 h; el sexto fallo abandona', async () => {
    const id = await encolar();
    const roto = fallador('SMTP: connect ECONNREFUSED');
    let ahora = T0;
    for (let intento = 1; intento <= MAX_INTENTOS_CORREO; intento++) {
      const r = await despachar({ db: e.db, mailer: roto, ahora, ids: [id] });
      expect(r.tomados).toBe(1);
      const f = await fila(id);
      expect(f.intentos).toBe(intento);
      if (intento < MAX_INTENTOS_CORREO) {
        expect(f.estado).toBe('fallido');
        const espera = ESPERAS_REINTENTO_MS[intento - 1]!;
        expect(f.proximoIntento.getTime()).toBe(ahora.getTime() + espera);
        ahora = en(ahora, espera);
      } else {
        expect(f.estado).toBe('abandonado');
        expect(f.ultimoError).toContain('ECONNREFUSED');
      }
    }
    expect(ESPERAS_REINTENTO_MS).toEqual([min(5), min(30), min(120), min(720), min(1440)]);
    // Una fila abandonada no vuelve a intentarse.
    const mas = await despachar({ db: e.db, mailer: crearMailerMemoria(), ahora: en(ahora, min(100_000)), ids: [id] });
    expect(mas.tomados).toBe(0);
    expect(roto.llamadas).toHaveLength(MAX_INTENTOS_CORREO);
  });

  it('un proveedor que no responde cuenta como fallo (tiempo maximo) y no deja la fila colgada', async () => {
    const id = await encolar();
    const colgado: Mailer = { nombre: 'smtp', enviar: () => new Promise<void>(() => {}) };
    const r = await despachar({ db: e.db, mailer: colgado, ahora: T0, ids: [id], tiempoMaxEnvioMs: 40 });
    expect(r.fallidos).toBe(1);
    const f = await fila(id);
    expect(f.estado).toBe('fallido');
    expect(f.ultimoError).toContain('no respondió');
  });

  it('la falla simulada de desarrollo hace fallar al mailer de consola y se recupera al apagarla', async () => {
    const id = await encolar('lucia@prueba.invalid');
    const mailer = crearMailerConsola(e.db, { silencioso: true });
    fallaSimulada.poner(true);
    try {
      const r = await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
      expect(r.fallidos).toBe(1);
    } finally {
      fallaSimulada.poner(false);
    }
    const r2 = await despachar({ db: e.db, mailer, ahora: en(T0, min(6)), ids: [id] });
    expect(r2.enviados).toBe(1);
    const [dev] = await e.db.select().from(correoDev).where(eq(correoDev.destinatario, 'lucia@prueba.invalid'));
    expect(dev?.enlace).toMatch(/\/referencias\//);
  });
});

describe('fila "enviando" vencida (P-04)', () => {
  async function forzar(id: string, valores: Partial<typeof entregaCorreo.$inferInsert>) {
    await e.db.update(entregaCorreo).set(valores).where(eq(entregaCorreo.id, id));
  }

  it('con el bloqueo VIGENTE nadie mas la toma', async () => {
    const id = await encolar();
    await forzar(id, { estado: 'enviando', intentos: 1, bloqueadoHasta: en(T0, BLOQUEO_ENVIO_MS) });
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: en(T0, min(1)), ids: [id] });
    expect(r.tomados).toBe(0);
    expect(mailer.enviados).toHaveLength(0);
    expect((await fila(id)).estado).toBe('enviando');
  });

  it('con el bloqueo VENCIDO se recupera y se envia', async () => {
    const id = await encolar();
    await forzar(id, { estado: 'enviando', intentos: 1, bloqueadoHasta: en(T0, -1000) });
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
    expect(r).toMatchObject({ tomados: 1, enviados: 1, recuperados: 1 });
    const f = await fila(id);
    expect(f.estado).toBe('enviado');
    expect(f.intentos).toBe(2);
  });

  it('si ya agoto los intentos pasa a abandonado en vez de reintentarse sin fin, y no se envia', async () => {
    const id = await encolar();
    await forzar(id, { estado: 'enviando', intentos: MAX_INTENTOS_CORREO, bloqueadoHasta: en(T0, -1000) });
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
    expect(r.tomados).toBe(0);
    expect(r.abandonados).toBe(1);
    expect(mailer.enviados).toHaveLength(0);
    const f = await fila(id);
    expect(f.estado).toBe('abandonado');
    expect(f.ultimoError).toContain('agotaron');
  });

  it('el reclamo dura 2 minutos: durante el envio la fila queda "enviando" con el bloqueo puesto', async () => {
    const id = await encolar();
    let visto: { estado: string; bloqueo: number | null } | null = null;
    const espia: Mailer = {
      nombre: 'smtp',
      async enviar() {
        const f = await fila(id);
        visto = { estado: f.estado, bloqueo: f.bloqueadoHasta ? f.bloqueadoHasta.getTime() : null };
      },
    };
    await despachar({ db: e.db, mailer: espia, ahora: T0, ids: [id] });
    expect(visto).toEqual({ estado: 'enviando', bloqueo: T0.getTime() + BLOQUEO_ENVIO_MS });
  });
});

describe('destinatario que ya no puede recibir', () => {
  it('desactivado o con correo invalido: no se envia y queda abandonado con el motivo', async () => {
    const id = await encolar('brenda@prueba.invalid');
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.email, 'brenda@prueba.invalid'));
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: T0, ids: [id] });
    expect(r.abandonados).toBe(1);
    expect(mailer.enviados).toHaveLength(0);
    expect((await fila(id)).ultimoError).toContain('ya no tiene acceso');
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.email, 'brenda@prueba.invalid'));
  });
});

describe('cola', () => {
  it('cuenta por estado y procesa hasta el limite por pasada', async () => {
    for (let i = 0; i < 5; i++) await encolar('lucia@prueba.invalid');
    const mailer = crearMailerMemoria();
    const r = await despachar({ db: e.db, mailer, ahora: T0, limite: 3 });
    expect(r.tomados).toBe(3);
    const cola = await contarCola(e.db);
    expect(cola.enviado).toBeGreaterThanOrEqual(3);
    const r2 = await despachar({ db: e.db, mailer, ahora: T0, limite: 50 });
    expect(r2.tomados).toBeGreaterThan(0);
    const vencidas = (await e.db.select().from(entregaCorreo)).filter((f) => f.estado === 'pendiente' && f.proximoIntento.getTime() <= T0.getTime());
    expect(vencidas).toHaveLength(0);
  });
});
