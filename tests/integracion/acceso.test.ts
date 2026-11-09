/**
 * Acceso por enlace magico de punta a punta contra Better Auth + PGlite (13.1, 10.6):
 * invitacion sin registro abierto, enlace hasheado de un solo uso, anti-enumeracion, limites de tasa,
 * sesiones por rol y -- P-12 -- revocacion de sesiones al desactivar (CA-29).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, limiteTasa, session, usuario, verification } from '@/db/esquema';
import { desactivarUsuario, invitarUsuario } from '@/server/acciones/usuarios';
import { ErrorAccion } from '@/server/acciones/resultado';
import { actorDesdeCabeceras, confirmarEnlace, solicitarEnlace, type DepsAcceso } from '@/server/acceso';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { crearMailerMemoria } from '@/server/correo/consola';
import { REGLAS_TASA } from '@/server/limite-tasa';
import { nuevoEscenario, type Escenario } from './ayudas';

let e: Escenario;
let deps: DepsAcceso;
let mailer: ReturnType<typeof crearMailerMemoria>;

const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });

beforeAll(async () => {
  e = await nuevoEscenario();
  mailer = crearMailerMemoria();
  const auth = crearAuth({ db: e.db, config, mailer });
  deps = { db: e.db, auth, config }; // reloj real: Better Auth tambien usa el real
});
afterAll(async () => {
  await e.c.cerrar();
});

function tokenDelUltimoCorreo(): string {
  const m = mailer.enviados.at(-1);
  if (!m?.enlace) throw new Error('no hay correo con enlace');
  const t = new URL(m.enlace).searchParams.get('token');
  if (!t) throw new Error('el enlace no trae token');
  return t;
}

/** `Cookie:` de una peticion posterior a partir de los Set-Cookie de la respuesta. */
function cabecerasConCookie(setCookie: string[]): Headers {
  const h = new Headers();
  h.set('cookie', setCookie.map((c) => c.split(';')[0]).join('; '));
  return h;
}

async function entrar(email: string): Promise<{ headers: Headers; setCookie: string[] }> {
  await e.db.delete(limiteTasa); // los limites de tasa se prueban aparte; aqui no estorban
  await solicitarEnlace(deps, { email, ip: null });
  const r = await confirmarEnlace(deps, { token: tokenDelUltimoCorreo(), headers: new Headers() });
  if (!r.ok) throw new Error(`no se pudo entrar: ${r.motivo}`);
  return { headers: cabecerasConCookie(r.setCookie), setCookie: r.setCookie };
}

describe('solicitar y confirmar el enlace', () => {
  it('envia el correo solo a un usuario activo, con enlace propio a /entrar/confirmar (no el GET del plugin)', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    await solicitarEnlace(deps, { email: '  EDWARD@prueba.invalid ', siguiente: '/referencias/abc', ip: '10.0.0.1' });
    expect(mailer.enviados).toHaveLength(1);
    const m = mailer.enviados[0]!;
    expect(m.para).toBe('edward@prueba.invalid');
    expect(m.asunto).toBe('Tu enlace para entrar a Descripciones mínimas');
    const url = new URL(m.enlace!);
    expect(url.origin + url.pathname).toBe('http://localhost:3000/entrar/confirmar');
    expect(url.searchParams.get('siguiente')).toBe('/referencias/abc');
    expect(m.texto).toContain(m.enlace);
    expect(m.html).toContain('Abrir en la plataforma');
    // Sin datos de la mercancia ni referencias en el correo (D-23).
    expect(m.texto).not.toMatch(/TEST-|codigo|valor/i);
  });

  it('el token se guarda HASHEADO (no en claro) con la vigencia configurada', async () => {
    const token = tokenDelUltimoCorreo();
    const filas = await e.db.select().from(verification);
    const fila = filas.at(-1)!;
    expect(fila.identifier.startsWith('magic-link:')).toBe(true);
    expect(fila.identifier).not.toContain(token);
    expect(fila.value).not.toContain(token);
    const minutos = (fila.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(28);
    expect(minutos).toBeLessThanOrEqual(30.1);
  });

  it('anti-enumeracion: correo desconocido o inactivo responde igual y no envia nada', async () => {
    mailer.enviados.length = 0;
    await e.db.delete(limiteTasa);
    await expect(solicitarEnlace(deps, { email: 'nadie@prueba.invalid', ip: null })).resolves.toBeUndefined();
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, e.lector.usuarioId));
    await expect(solicitarEnlace(deps, { email: 'lucia@prueba.invalid', ip: null })).resolves.toBeUndefined();
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, e.lector.usuarioId));
    expect(mailer.enviados).toHaveLength(0);
    const fallidos = await e.db.select().from(auditoria).where(eq(auditoria.accion, 'login_fallido'));
    expect(fallidos.length).toBeGreaterThanOrEqual(2);
  });

  it('un correo marcado invalido no recibe nada', async () => {
    mailer.enviados.length = 0;
    await e.db.delete(limiteTasa);
    await e.db.update(usuario).set({ correoInvalido: true }).where(eq(usuario.id, e.charles.usuarioId));
    await solicitarEnlace(deps, { email: 'charles@prueba.invalid', ip: null });
    await e.db.update(usuario).set({ correoInvalido: false }).where(eq(usuario.id, e.charles.usuarioId));
    expect(mailer.enviados).toHaveLength(0);
  });

  it('confirmar crea la sesion, sigue al destino y el enlace es de UN solo uso', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    await solicitarEnlace(deps, { email: 'edward@prueba.invalid', siguiente: '/referencias', ip: null });
    const token = tokenDelUltimoCorreo();
    const r = await confirmarEnlace(deps, { token, siguiente: '/referencias', headers: new Headers() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.siguiente).toBe('/referencias');
    const cookie = r.setCookie.join('\n');
    expect(cookie).toMatch(/session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // APP_URL de prueba es http

    // Segundo uso del mismo enlace: ya se uso (el doble clic o un escaner no crean otra sesion).
    const otra = await confirmarEnlace(deps, { token, headers: new Headers() });
    expect(otra).toEqual({ ok: false, motivo: 'usado' });
  });

  it('un enlace vencido se distingue de uno usado', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    await solicitarEnlace(deps, { email: 'edward@prueba.invalid', ip: null });
    const token = tokenDelUltimoCorreo();
    await e.db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, `magic-link:${(await import('node:crypto')).createHash('sha256').update(token).digest('base64url')}`));
    expect(await confirmarEnlace(deps, { token, headers: new Headers() })).toEqual({ ok: false, motivo: 'vencido' });
  });

  it('un token inventado no entra', async () => {
    expect(await confirmarEnlace(deps, { token: 'a'.repeat(32), headers: new Headers() })).toEqual({ ok: false, motivo: 'usado' });
    expect(await confirmarEnlace(deps, { token: 'x', headers: new Headers() })).toEqual({ ok: false, motivo: 'invalido' });
  });

  it('un siguiente externo se ignora (redireccion abierta)', async () => {
    await e.db.delete(limiteTasa);
    await solicitarEnlace(deps, { email: 'edward@prueba.invalid', siguiente: 'https://evil.example', ip: null });
    const m = mailer.enviados.at(-1)!;
    expect(new URL(m.enlace!).searchParams.get('siguiente')).toBeNull();
    const r = await confirmarEnlace(deps, { token: tokenDelUltimoCorreo(), siguiente: '//evil.example', headers: new Headers() });
    expect(r.ok && r.siguiente).toBe('/');
  });

  it('el login deja auditoria y actualiza el ultimo ingreso', async () => {
    await entrar('charles@prueba.invalid');
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId));
    expect(u!.ultimoIngreso).not.toBeNull();
    const filas = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'login'), eq(auditoria.usuarioId, e.charles.usuarioId)));
    expect(filas.length).toBeGreaterThanOrEqual(1);
  });
});

describe('limites de tasa (13.3, 10.6)', () => {
  /** Reloj propio de este bloque: el limite usa `deps.ahora`, Better Auth sigue con el real. */
  const conReloj = (t: number): DepsAcceso => ({ ...deps, ahora: () => new Date(t) });

  it('espera de 30 s entre solicitudes del mismo correo y 5 por 15 min, igual para correos que no existen', async () => {
    const base = Date.UTC(2026, 11, 1, 10, 0, 0); // inicio exacto de una ventana de 15 min
    for (const email of ['brian@prueba.invalid', 'inexistente@prueba.invalid']) {
      await solicitarEnlace(conReloj(base), { email, ip: null }); // 1.a
      // Inmediatamente otra vez: dentro de los 30 s. Se rechaza y NO gasta el cupo del correo (regresion de la
      // revision de H1: si no, un tercero agotaria el cupo de otra persona solo insistiendo).
      await expect(solicitarEnlace(conReloj(base), { email, ip: null })).rejects.toMatchObject({ codigo: 'LIMITE_TASA' });
      for (const seg of [31, 62, 93, 124]) {
        await solicitarEnlace(conReloj(base + seg * 1000), { email, ip: null }); // 2.a a 5.a solicitudes aceptadas
      }
      const err = (await solicitarEnlace(conReloj(base + 155_000), { email, ip: null }).catch((x) => x)) as ErrorAccion; // 6.a
      expect(err).toBeInstanceOf(ErrorAccion);
      expect(err.codigo).toBe('LIMITE_TASA');
      expect(err.message).toMatch(/^Hiciste muchas solicitudes\. Espera \d+ minutos? y vuelve a intentar\.$/);
    }
  });

  it('el limite se reinicia en la ventana siguiente', async () => {
    const base = Date.UTC(2026, 11, 3, 10, 0, 0);
    for (let i = 0; i < 6; i++) await solicitarEnlace(conReloj(base + i * 31_000), { email: 'ventana@prueba.invalid', ip: null }).catch(() => undefined);
    await expect(solicitarEnlace(conReloj(base + 6 * 31_000), { email: 'ventana@prueba.invalid', ip: null })).rejects.toMatchObject({ codigo: 'LIMITE_TASA' });
    await expect(solicitarEnlace(conReloj(base + 16 * 60_000), { email: 'ventana@prueba.invalid', ip: null })).resolves.toBeUndefined();
  });

  it('tambien limita por IP', async () => {
    const base = Date.UTC(2026, 11, 2, 10, 0, 0);
    let rechazado = false;
    for (let i = 0; i < REGLAS_TASA.enlacePorIp.max + 1 && !rechazado; i++) {
      try {
        await solicitarEnlace(conReloj(base + i * 1000), { email: `persona${i}@prueba.invalid`, ip: '203.0.113.9' });
      } catch (x) {
        rechazado = (x as ErrorAccion).codigo === 'LIMITE_TASA';
      }
    }
    expect(rechazado).toBe(true);
  });
});

describe('sesion y Actor', () => {
  it('con la cookie de la sesion se resuelve el Actor con rol y organizacion', async () => {
    const { headers } = await entrar('brian@prueba.invalid');
    const actor = await actorDesdeCabeceras(deps, headers);
    expect(actor).toMatchObject({ usuarioId: e.brian.usuarioId, rol: 'aduana', organizacionTipo: 'agencia', organizacionId: e.orgA });
    expect(actor?.sesionId).toBeTruthy();
  });

  it('sin cookie o con una cookie manipulada no hay Actor', async () => {
    expect(await actorDesdeCabeceras(deps, new Headers())).toBeNull();
    const { setCookie } = await entrar('edward@prueba.invalid');
    const mala = new Headers({ cookie: setCookie.map((c) => c.split(';')[0]!.replace(/=.{6}/, '=XXXXXX')).join('; ') });
    expect(await actorDesdeCabeceras(deps, mala)).toBeNull();
  });

  it('limite de inactividad: pasadas 8 h sin actividad la sesion deja de valer y se borra', async () => {
    const { headers } = await entrar('edward@prueba.invalid');
    const actor = await actorDesdeCabeceras(deps, headers);
    expect(actor).not.toBeNull();
    await e.db.update(session).set({ ultimaActividad: new Date(Date.now() - 9 * 3_600_000) }).where(eq(session.id, actor!.sesionId!));
    expect(await actorDesdeCabeceras(deps, headers)).toBeNull();
    const quedan = await e.db.select().from(session).where(eq(session.id, actor!.sesionId!));
    expect(quedan).toHaveLength(0);
  });

  it('tope absoluto por rol: externos 72 h, internos 7 dias', async () => {
    const ext = await entrar('brian@prueba.invalid');
    const int = await entrar('edward@prueba.invalid');
    const aExt = await actorDesdeCabeceras(deps, ext.headers);
    const aInt = await actorDesdeCabeceras(deps, int.headers);
    const cien = new Date(Date.now() - 100 * 3_600_000);
    // Creadas hace 100 h pero con actividad reciente: la absoluta decide.
    await e.db.update(session).set({ createdAt: cien }).where(eq(session.id, aExt!.sesionId!));
    await e.db.update(session).set({ createdAt: cien }).where(eq(session.id, aInt!.sesionId!));
    expect(await actorDesdeCabeceras(deps, ext.headers)).toBeNull(); // 100 h > 72 h
    expect(await actorDesdeCabeceras(deps, int.headers)).not.toBeNull(); // 100 h < 168 h
    await e.db.update(session).set({ createdAt: new Date(Date.now() - 200 * 3_600_000) }).where(eq(session.id, aInt!.sesionId!));
    expect(await actorDesdeCabeceras(deps, int.headers)).toBeNull(); // 200 h > 168 h
  });

  it('la sesion creada lleva el tope absoluto segun el tipo de organizacion', async () => {
    await entrar('brian@prueba.invalid');
    await entrar('edward@prueba.invalid');
    const filas = await e.db.select().from(session);
    const deBrian = filas.filter((s) => s.userId === e.brian.usuarioId).at(-1)!;
    const deEdward = filas.filter((s) => s.userId === e.edward.usuarioId).at(-1)!;
    const horas = (s: typeof deBrian) => Math.round((s.expiresAt.getTime() - s.createdAt.getTime()) / 3_600_000);
    expect(horas(deBrian)).toBe(72);
    expect(horas(deEdward)).toBe(168);
  });
});

describe('P-12: desactivar a un usuario revoca sus sesiones (RV-16, CA-29)', () => {
  it('las sesiones abiertas dejan de funcionar en la siguiente peticion, en todos sus navegadores', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Para desactivar', email: 'desactivar@prueba.invalid', rol: 'solicitante', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    const uid = u!.id;

    const nav1 = await entrar('desactivar@prueba.invalid');
    const nav2 = await entrar('desactivar@prueba.invalid');
    expect((await actorDesdeCabeceras(deps, nav1.headers))?.usuarioId).toBe(uid);
    expect((await actorDesdeCabeceras(deps, nav2.headers))?.usuarioId).toBe(uid);

    // Un enlace pendiente emitido ANTES de desactivar.
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    await solicitarEnlace(deps, { email: 'desactivar@prueba.invalid', ip: null });
    const tokenPendiente = tokenDelUltimoCorreo();

    const r = await desactivarUsuario(e.ctx(e.admin), { usuarioId: uid });
    expect(r.sesionesCerradas).toBe(2);

    expect(await e.db.select().from(session).where(eq(session.userId, uid))).toHaveLength(0);
    expect(await actorDesdeCabeceras(deps, nav1.headers)).toBeNull();
    expect(await actorDesdeCabeceras(deps, nav2.headers)).toBeNull();

    // No obtiene una sesion nueva: ni con el enlace pendiente, ni pidiendo otro.
    const conPendiente = await confirmarEnlace(deps, { token: tokenPendiente, headers: new Headers() });
    expect(conPendiente.ok).toBe(false);
    expect(await e.db.select().from(session).where(eq(session.userId, uid))).toHaveLength(0);
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    await solicitarEnlace(deps, { email: 'desactivar@prueba.invalid', ip: null });
    expect(mailer.enviados).toHaveLength(0);
  });

  it('aunque alguien conserve una sesion viva en la base, getActor relee activo=false y la rechaza', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Inactivo directo', email: 'directo@prueba.invalid', rol: 'solicitante', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    const nav = await entrar('directo@prueba.invalid');
    expect(await actorDesdeCabeceras(deps, nav.headers)).not.toBeNull();
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, u!.id)); // sin borrar sesiones a proposito
    expect(await actorDesdeCabeceras(deps, nav.headers)).toBeNull();
  });
});

describe('invitacion: sin registro abierto', () => {
  it('Better Auth no crea usuarios por su cuenta; solo un admin invita', async () => {
    const antes = await e.db.select().from(usuario);
    await solicitarEnlace(deps, { email: 'desconocido@prueba.invalid', ip: null });
    expect(await e.db.select().from(usuario)).toHaveLength(antes.length);
    // Aun llamando al plugin directamente, no existe el usuario y no hay forma de crearlo.
    await expect(deps.auth.api.signInMagicLink({ body: { email: 'forzado@prueba.invalid' }, headers: new Headers() })).resolves.toBeDefined();
    const ultimo = mailer.enviados.at(-1);
    expect(ultimo?.para).not.toBe('forzado@prueba.invalid');
    expect(await e.db.select().from(usuario)).toHaveLength(antes.length);
  });

  it('un admin invita y el invitado puede entrar; un no admin no puede invitar', async () => {
    await expect(
      invitarUsuario(e.ctx(e.edward), { nombre: 'Intruso', email: 'intruso@prueba.invalid', organizacionId: e.orgInterna, rol: 'admin' }),
    ).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    const inv = await invitarUsuario(e.ctx(e.admin), {
      nombre: 'Invitada Nueva',
      email: 'Invitada.Nueva@Prueba.invalid',
      organizacionId: e.orgA,
      rol: 'aduana',
    });
    expect(inv.email).toBe('invitada.nueva@prueba.invalid');
    const { headers } = await entrar('invitada.nueva@prueba.invalid');
    expect((await actorDesdeCabeceras(deps, headers))?.rol).toBe('aduana');
  });
});
