/**
 * Acceso por usuario y contrasena de punta a punta contra Better Auth + PGlite (13.1, 10.6):
 * sin registro abierto, anti-enumeracion, limites de intentos, sesiones por rol, revocacion al desactivar (CA-29),
 * y el ciclo de contrasenas: crear cuenta, restablecer (admin) y cambiar la propia.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, auditoria, limiteTasa, organizacion, session, usuario } from '@/db/esquema';
import { actualizarPreferencias, cambiarMiClave } from '@/server/acciones/cuenta';
import { desactivarUsuario, crearCuenta, restablecerClave } from '@/server/acciones/usuarios';
import { actorDesdeCabeceras, iniciarSesion, type DepsAcceso } from '@/server/acceso';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { REGLAS_TASA } from '@/server/limite-tasa';
import { ErrorAccion } from '@/server/acciones/resultado';
import { nuevoEscenario, type Escenario } from './ayudas';
import { CLAVE_PRUEBA, conCredenciales } from './ayudas-acceso';

let e: Escenario;
let deps: DepsAcceso;

const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });

beforeAll(async () => {
  e = await nuevoEscenario();
  deps = { db: e.db, auth: crearAuth({ db: e.db, config }), config }; // reloj real: Better Auth tambien usa el real
  await conCredenciales(e.db, e.edward.usuarioId, 'edward');
  await conCredenciales(e.db, e.charles.usuarioId, 'charles');
  await conCredenciales(e.db, e.brian.usuarioId, 'brian');
  await conCredenciales(e.db, e.lector.usuarioId, 'lucia');
  await conCredenciales(e.db, e.admin.usuarioId, 'admin');
});
afterAll(async () => {
  await e.c.cerrar();
});

/** `Cookie:` de una peticion posterior a partir de los Set-Cookie de la respuesta. */
function cabecerasConCookie(setCookie: string[]): Headers {
  const h = new Headers();
  h.set('cookie', setCookie.map((c) => c.split(';')[0]).join('; '));
  return h;
}

async function entrar(usuarioTexto: string, clave: string = CLAVE_PRUEBA): Promise<{ headers: Headers; setCookie: string[] }> {
  await e.db.delete(limiteTasa); // los limites se prueban aparte; aqui no estorban
  const r = await iniciarSesion(deps, { usuario: usuarioTexto, clave, headers: new Headers() });
  if (!r.ok) throw new Error('no se pudo entrar');
  return { headers: cabecerasConCookie(r.setCookie), setCookie: r.setCookie };
}

describe('iniciar sesion con usuario y contrasena', () => {
  it('entra, crea la sesion con cookie segura y sigue al destino', async () => {
    await e.db.delete(limiteTasa);
    const r = await iniciarSesion(deps, { usuario: 'edward', clave: CLAVE_PRUEBA, siguiente: '/referencias', headers: new Headers() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.siguiente).toBe('/referencias');
    const cookie = r.setCookie.join('\n');
    expect(cookie).toMatch(/session_token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // APP_URL de prueba es http
  });

  it('el usuario no distingue mayusculas ni espacios en los bordes; tambien acepta el correo de la cuenta', async () => {
    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: '  EDWARD ', clave: CLAVE_PRUEBA, headers: new Headers() })).ok).toBe(true);
    expect((await iniciarSesion(deps, { usuario: 'edward@prueba.invalid', clave: CLAVE_PRUEBA, headers: new Headers() })).ok).toBe(true);
  });

  it('la contrasena SI distingue mayusculas', async () => {
    await e.db.delete(limiteTasa);
    expect(await iniciarSesion(deps, { usuario: 'edward', clave: CLAVE_PRUEBA.toUpperCase(), headers: new Headers() })).toEqual({ ok: false, motivo: 'credenciales' });
  });

  it('anti-enumeracion: clave mala, usuario desconocido y usuario inactivo responden exactamente igual', async () => {
    await e.db.delete(limiteTasa);
    const mala = await iniciarSesion(deps, { usuario: 'edward', clave: 'otra-clave-distinta', headers: new Headers() });
    const desconocido = await iniciarSesion(deps, { usuario: 'nadie', clave: CLAVE_PRUEBA, headers: new Headers() });
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, e.lector.usuarioId));
    const inactivo = await iniciarSesion(deps, { usuario: 'lucia', clave: CLAVE_PRUEBA, headers: new Headers() });
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, e.lector.usuarioId));
    expect(mala).toEqual({ ok: false, motivo: 'credenciales' });
    expect(desconocido).toEqual(mala);
    expect(inactivo).toEqual(mala);
    const fallidos = await e.db.select().from(auditoria).where(eq(auditoria.accion, 'login_fallido'));
    const motivos = fallidos.map((f) => (f.detalle as { motivo?: string }).motivo);
    expect(motivos).toEqual(expect.arrayContaining(['clave_incorrecta', 'usuario_desconocido', 'inactivo']));
  });

  it('una organizacion desactivada deja sin acceso a sus cuentas', async () => {
    await e.db.delete(limiteTasa);
    await e.db.update(organizacion).set({ activa: false }).where(eq(organizacion.id, e.orgA));
    const r = await iniciarSesion(deps, { usuario: 'brian', clave: CLAVE_PRUEBA, headers: new Headers() });
    await e.db.update(organizacion).set({ activa: true }).where(eq(organizacion.id, e.orgA));
    expect(r.ok).toBe(false);
  });

  it('un siguiente externo se ignora (redireccion abierta)', async () => {
    await e.db.delete(limiteTasa);
    const r = await iniciarSesion(deps, { usuario: 'edward', clave: CLAVE_PRUEBA, siguiente: '//evil.example', headers: new Headers() });
    expect(r.ok && r.siguiente).toBe('/');
  });

  it('el login deja auditoria y actualiza el ultimo ingreso', async () => {
    await entrar('charles');
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId));
    expect(u!.ultimoIngreso).not.toBeNull();
    const filas = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'login'), eq(auditoria.usuarioId, e.charles.usuarioId)));
    expect(filas.length).toBeGreaterThanOrEqual(1);
  });

  it('una contrasena enorme se rechaza sin llegar a verificarse', async () => {
    await e.db.delete(limiteTasa);
    expect(await iniciarSesion(deps, { usuario: 'edward', clave: 'x'.repeat(5000), headers: new Headers() })).toEqual({ ok: false, motivo: 'credenciales' });
  });
});

describe('limites de intentos (13.3, 10.6)', () => {
  /** Reloj propio de este bloque: el limite usa `deps.ahora`, Better Auth sigue con el real. */
  const conReloj = (t: number): DepsAcceso => ({ ...deps, ahora: () => new Date(t) });
  const intento = (d: DepsAcceso, usuarioTexto: string, clave: string, ip: string | null = null) =>
    iniciarSesion(d, { usuario: usuarioTexto, clave, ip, headers: new Headers() });

  it('10 fallos por usuario en 15 min: el 11.o se rechaza AUNQUE la contrasena sea correcta', async () => {
    await e.db.delete(limiteTasa);
    const base = Date.UTC(2026, 11, 1, 10, 0, 0); // inicio exacto de una ventana de 15 min
    for (let i = 0; i < REGLAS_TASA.accesoFallidoPorUsuario.max; i++) {
      expect(await intento(conReloj(base + i * 1000), 'brian', 'mala-clave-xx')).toEqual({ ok: false, motivo: 'credenciales' });
    }
    const err = (await intento(conReloj(base + 11_000), 'brian', CLAVE_PRUEBA).catch((x) => x)) as ErrorAccion;
    expect(err).toBeInstanceOf(ErrorAccion);
    expect(err.codigo).toBe('LIMITE_TASA');
    expect(err.message).toMatch(/^Demasiados intentos\. Espera \d+ minutos? y vuelve a intentar\.$/);
  });

  it('el limite se reinicia en la ventana siguiente', async () => {
    await e.db.delete(limiteTasa);
    const base = Date.UTC(2026, 11, 3, 10, 0, 0);
    for (let i = 0; i < REGLAS_TASA.accesoFallidoPorUsuario.max; i++) await intento(conReloj(base + i * 1000), 'brian', 'mala-clave-xx');
    await expect(intento(conReloj(base + 20_000), 'brian', CLAVE_PRUEBA)).rejects.toMatchObject({ codigo: 'LIMITE_TASA' });
    expect((await intento(conReloj(base + 16 * 60_000), 'brian', CLAVE_PRUEBA)).ok).toBe(true);
  });

  it('entrar bien NO cuenta: una cuenta compartida por un area admite muchos ingresos seguidos', async () => {
    await e.db.delete(limiteTasa);
    const base = Date.UTC(2026, 11, 4, 10, 0, 0);
    for (let i = 0; i < REGLAS_TASA.accesoFallidoPorUsuario.max + 5; i++) {
      expect((await intento(conReloj(base + i * 1000), 'edward', CLAVE_PRUEBA)).ok).toBe(true);
    }
  });

  it('el limite es por usuario: los fallos de uno no frenan a otro', async () => {
    await e.db.delete(limiteTasa);
    const base = Date.UTC(2026, 11, 5, 10, 0, 0);
    for (let i = 0; i < REGLAS_TASA.accesoFallidoPorUsuario.max; i++) await intento(conReloj(base + i * 1000), 'charles', 'mala-clave-xx');
    expect((await intento(conReloj(base + 30_000), 'edward', CLAVE_PRUEBA)).ok).toBe(true);
  });

  it('tambien limita por IP', async () => {
    await e.db.delete(limiteTasa);
    const base = Date.UTC(2026, 11, 2, 10, 0, 0);
    let rechazado = false;
    for (let i = 0; i < REGLAS_TASA.accesoPorIp.max + 1 && !rechazado; i++) {
      try {
        await intento(conReloj(base + i * 1000), `persona${i}`, 'x-clave-cualquiera', '203.0.113.9');
      } catch (x) {
        rechazado = (x as ErrorAccion).codigo === 'LIMITE_TASA';
      }
    }
    expect(rechazado).toBe(true);
  });
});

describe('sesion y Actor', () => {
  it('con la cookie de la sesion se resuelve el Actor con rol, organizacion y usuario', async () => {
    const { headers } = await entrar('brian');
    const actor = await actorDesdeCabeceras(deps, headers);
    expect(actor).toMatchObject({ usuarioId: e.brian.usuarioId, rol: 'aduana', organizacionTipo: 'agencia', organizacionId: e.orgA, username: 'brian' });
    expect(actor?.sesionId).toBeTruthy();
  });

  it('sin cookie o con una cookie manipulada no hay Actor', async () => {
    expect(await actorDesdeCabeceras(deps, new Headers())).toBeNull();
    const { setCookie } = await entrar('edward');
    const mala = new Headers({ cookie: setCookie.map((c) => c.split(';')[0]!.replace(/=.{6}/, '=XXXXXX')).join('; ') });
    expect(await actorDesdeCabeceras(deps, mala)).toBeNull();
  });

  it('limite de inactividad: pasadas 8 h sin actividad la sesion deja de valer y se borra', async () => {
    const { headers } = await entrar('edward');
    const actor = await actorDesdeCabeceras(deps, headers);
    expect(actor).not.toBeNull();
    await e.db.update(session).set({ ultimaActividad: new Date(Date.now() - 9 * 3_600_000) }).where(eq(session.id, actor!.sesionId!));
    expect(await actorDesdeCabeceras(deps, headers)).toBeNull();
    const quedan = await e.db.select().from(session).where(eq(session.id, actor!.sesionId!));
    expect(quedan).toHaveLength(0);
  });

  it('tope absoluto por rol: externos 72 h, internos 7 dias', async () => {
    const ext = await entrar('brian');
    const int = await entrar('edward');
    const aExt = await actorDesdeCabeceras(deps, ext.headers);
    const aInt = await actorDesdeCabeceras(deps, int.headers);
    const cien = new Date(Date.now() - 100 * 3_600_000);
    await e.db.update(session).set({ createdAt: cien }).where(eq(session.id, aExt!.sesionId!));
    await e.db.update(session).set({ createdAt: cien }).where(eq(session.id, aInt!.sesionId!));
    expect(await actorDesdeCabeceras(deps, ext.headers)).toBeNull(); // 100 h > 72 h
    expect(await actorDesdeCabeceras(deps, int.headers)).not.toBeNull(); // 100 h < 168 h
    await e.db.update(session).set({ createdAt: new Date(Date.now() - 200 * 3_600_000) }).where(eq(session.id, aInt!.sesionId!));
    expect(await actorDesdeCabeceras(deps, int.headers)).toBeNull(); // 200 h > 168 h
  });

  it('la sesion creada lleva el tope absoluto segun el tipo de organizacion', async () => {
    await entrar('brian');
    await entrar('edward');
    const filas = await e.db.select().from(session);
    const deBrian = filas.filter((s) => s.userId === e.brian.usuarioId).at(-1)!;
    const deEdward = filas.filter((s) => s.userId === e.edward.usuarioId).at(-1)!;
    const horas = (s: typeof deBrian) => Math.round((s.expiresAt.getTime() - s.createdAt.getTime()) / 3_600_000);
    expect(horas(deBrian)).toBe(72);
    expect(horas(deEdward)).toBe(168);
  });
});

describe('P-12: desactivar a un usuario revoca sus sesiones (RV-16, CA-29)', () => {
  it('las sesiones abiertas dejan de funcionar en la siguiente peticion y no obtiene otra', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Para desactivar', email: 'desactivar@prueba.invalid', rol: 'solicitante', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    const uid = u!.id;
    await conCredenciales(e.db, uid, 'desactivar');

    const nav1 = await entrar('desactivar');
    const nav2 = await entrar('desactivar');
    expect((await actorDesdeCabeceras(deps, nav1.headers))?.usuarioId).toBe(uid);
    expect((await actorDesdeCabeceras(deps, nav2.headers))?.usuarioId).toBe(uid);

    const r = await desactivarUsuario(e.ctx(e.admin), { usuarioId: uid });
    expect(r.sesionesCerradas).toBe(2);

    expect(await e.db.select().from(session).where(eq(session.userId, uid))).toHaveLength(0);
    expect(await actorDesdeCabeceras(deps, nav1.headers)).toBeNull();
    expect(await actorDesdeCabeceras(deps, nav2.headers)).toBeNull();

    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: 'desactivar', clave: CLAVE_PRUEBA, headers: new Headers() })).ok).toBe(false);
    expect(await e.db.select().from(session).where(eq(session.userId, uid))).toHaveLength(0);
  });

  it('aunque alguien conserve una sesion viva en la base, getActor relee activo=false y la rechaza', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Inactivo directo', email: 'directo@prueba.invalid', rol: 'solicitante', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    await conCredenciales(e.db, u!.id, 'directo');
    const nav = await entrar('directo');
    expect(await actorDesdeCabeceras(deps, nav.headers)).not.toBeNull();
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, u!.id)); // sin borrar sesiones a proposito
    expect(await actorDesdeCabeceras(deps, nav.headers)).toBeNull();
  });
});

describe('cuentas: sin registro abierto; las crea un administrador', () => {
  it('Better Auth no registra a nadie por su cuenta', async () => {
    const antes = await e.db.select().from(usuario);
    await expect(
      deps.auth.api.signUpEmail({ body: { email: 'forzado@prueba.invalid', password: 'una-clave-larga-123', name: 'Forzado' }, headers: new Headers() }),
    ).rejects.toBeDefined();
    expect(await e.db.select().from(usuario)).toHaveLength(antes.length);
  });

  it('un admin crea la cuenta con contrasena temporal que funciona; un no admin no puede', async () => {
    await expect(
      crearCuenta(e.ctx(e.edward), { nombre: 'Intruso', usuario: 'intruso', organizacionId: e.orgInterna, rol: 'admin' }),
    ).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    const nueva = await crearCuenta(e.ctx(e.admin), { nombre: 'Área Prueba', usuario: ' Area.Prueba ', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles', encargado: ' Edgar ' });
    expect(nueva.usuario).toBe('area.prueba');
    expect(nueva.claveTemporal).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    // En la base solo hay el hash, nunca la contrasena.
    const [fila] = await e.db.select().from(account).where(eq(account.userId, nueva.id));
    expect(fila?.password).toBeTruthy();
    expect(fila?.password).not.toContain(nueva.claveTemporal);
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, nueva.id));
    expect(u).toMatchObject({ username: 'area.prueba', area: 'Consumibles', email: 'area.prueba@sin-correo.invalid', debeCambiarClave: false, encargado: 'Edgar' });
    const aud = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'crear_cuenta'), eq(auditoria.entidadId, nueva.id)));
    expect(JSON.stringify(aud[0]?.detalle)).not.toContain(nueva.claveTemporal);

    const { headers } = await entrar('area.prueba', nueva.claveTemporal);
    const actorNuevo = await actorDesdeCabeceras(deps, headers);
    // Cambiar la contrasena de entrega ya no es obligatorio: entra sin indicador de cambio pendiente y opera de una vez.
    expect(actorNuevo).toMatchObject({ rol: 'solicitante', area: 'Consumibles', debeCambiarClave: false });
    const ctxNuevo = e.ctx({ ...actorNuevo!, sesionId: actorNuevo!.sesionId! });
    await expect(actualizarPreferencias(ctxNuevo, { atajosTeclado: false })).resolves.toEqual({ ok: true });

    // Cambiarla es voluntario: con 6 caracteres se rechaza y con 7 se acepta.
    await expect(cambiarMiClave(ctxNuevo, { actual: nueva.claveTemporal, nueva: 'abcdef', repetir: 'abcdef' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    const r = await cambiarMiClave(ctxNuevo, { actual: nueva.claveTemporal, nueva: 'abcdefg', repetir: 'abcdefg' });
    expect(r.eraInicial).toBe(false);
  });

  it('el mecanismo de guardia sigue vivo: con el indicador activado a mano, cambiar la clave lo apaga', async () => {
    const nueva = await crearCuenta(e.ctx(e.admin), { nombre: 'Guardia', usuario: 'guardia.prueba', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' });
    await e.db.update(usuario).set({ debeCambiarClave: true }).where(eq(usuario.id, nueva.id));
    const { headers } = await entrar('guardia.prueba', nueva.claveTemporal);
    const actorNuevo = await actorDesdeCabeceras(deps, headers);
    expect(actorNuevo?.debeCambiarClave).toBe(true);

    const ctxNuevo = e.ctx({ ...actorNuevo!, sesionId: actorNuevo!.sesionId! });
    const r = await cambiarMiClave(ctxNuevo, { actual: nueva.claveTemporal, nueva: 'clave-propia-2026', repetir: 'clave-propia-2026' });
    expect(r.eraInicial).toBe(true);
    const [despues] = await e.db.select().from(usuario).where(eq(usuario.id, nueva.id));
    expect(despues?.debeCambiarClave).toBe(false);
    expect((await actorDesdeCabeceras(deps, headers))?.debeCambiarClave).toBe(false);
  });

  it('rechaza un usuario repetido o con formato invalido, y una agencia solo admite el rol aduana', async () => {
    await expect(crearCuenta(e.ctx(e.admin), { nombre: 'Otra', usuario: 'EDWARD', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' })).rejects.toMatchObject({ codigo: 'DUPLICADO' });
    for (const malo of ['ab', 'con espacio', 'Ñandú', '-empieza', 'x'.repeat(41)]) {
      await expect(crearCuenta(e.ctx(e.admin), { nombre: 'Mala', usuario: malo, organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    }
    await expect(crearCuenta(e.ctx(e.admin), { nombre: 'Agencia', usuario: 'agencia-z', organizacionId: e.orgA, rol: 'solicitante' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });
});

describe('restablecer la contrasena de otra cuenta (admin)', () => {
  it('genera una nueva, la anterior deja de servir y se cierran las sesiones abiertas', async () => {
    const viejo = await entrar('charles');
    expect(await actorDesdeCabeceras(deps, viejo.headers)).not.toBeNull();

    await expect(restablecerClave(e.ctx(e.edward), { usuarioId: e.charles.usuarioId })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    const r = await restablecerClave(e.ctx(e.admin), { usuarioId: e.charles.usuarioId });
    expect(r.sesionesCerradas).toBeGreaterThanOrEqual(1);
    expect(r.claveTemporal).not.toBe(CLAVE_PRUEBA);
    const [marcada] = await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId));
    expect(marcada?.debeCambiarClave).toBe(false); // la restablecida es temporal pero ya no se obliga a cambiarla

    expect(await actorDesdeCabeceras(deps, viejo.headers)).toBeNull();
    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: 'charles', clave: CLAVE_PRUEBA, headers: new Headers() })).ok).toBe(false);
    expect((await iniciarSesion(deps, { usuario: 'charles', clave: r.claveTemporal, headers: new Headers() })).ok).toBe(true);
    const aud = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'restablecer_clave'), eq(auditoria.entidadId, e.charles.usuarioId)));
    expect(aud).toHaveLength(1);
    expect(JSON.stringify(aud[0]?.detalle)).not.toContain(r.claveTemporal);
    await conCredenciales(e.db, e.charles.usuarioId, 'charles'); // devuelve la clave de prueba al resto del archivo
  });
});

describe('cambiar mi propia contrasena', () => {
  const ctxCon = async (usuarioTexto: string, actor: typeof e.edward) => {
    const { headers } = await entrar(usuarioTexto);
    const a = await actorDesdeCabeceras(deps, headers);
    return e.ctx({ ...actor, sesionId: a!.sesionId! });
  };

  it('exige la actual, valida la nueva y cierra mis OTRAS sesiones (no la actual)', async () => {
    const otra = await entrar('edward');
    const ctx = await ctxCon('edward', e.edward);
    await e.db.delete(limiteTasa);

    await expect(cambiarMiClave(ctx, { actual: 'no-es-la-actual', nueva: 'nueva-clave-2026', repetir: 'nueva-clave-2026' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(cambiarMiClave(ctx, { actual: CLAVE_PRUEBA, nueva: 'corta', repetir: 'corta' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(cambiarMiClave(ctx, { actual: CLAVE_PRUEBA, nueva: 'nueva-clave-2026', repetir: 'distinta-clave-2026' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(cambiarMiClave(ctx, { actual: CLAVE_PRUEBA, nueva: CLAVE_PRUEBA, repetir: CLAVE_PRUEBA })).rejects.toMatchObject({ codigo: 'VALIDACION' });

    const r = await cambiarMiClave(ctx, { actual: CLAVE_PRUEBA, nueva: 'nueva-clave-2026', repetir: 'nueva-clave-2026' });
    expect(r.otrasSesionesCerradas).toBeGreaterThanOrEqual(1);
    expect(await actorDesdeCabeceras(deps, otra.headers)).toBeNull();
    expect(await e.db.select().from(session).where(eq(session.id, ctx.actor.sesionId!))).toHaveLength(1); // la actual sigue

    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: 'edward', clave: CLAVE_PRUEBA, headers: new Headers() })).ok).toBe(false);
    expect((await iniciarSesion(deps, { usuario: 'edward', clave: 'nueva-clave-2026', headers: new Headers() })).ok).toBe(true);
    await conCredenciales(e.db, e.edward.usuarioId, 'edward');
  });

  it('limita los intentos de adivinar la contrasena actual (5 por 15 min)', async () => {
    const ctx = await ctxCon('lucia', e.lector);
    await e.db.delete(limiteTasa);
    const T = new Date(Date.UTC(2026, 11, 6, 10, 0, 0));
    const c = { ...ctx, ahora: T };
    for (let i = 0; i < REGLAS_TASA.cambiarClave.max; i++) {
      await expect(cambiarMiClave(c, { actual: 'adivinando-123', nueva: 'nueva-clave-2026', repetir: 'nueva-clave-2026' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    }
    await expect(cambiarMiClave(c, { actual: CLAVE_PRUEBA, nueva: 'nueva-clave-2026', repetir: 'nueva-clave-2026' })).rejects.toMatchObject({ codigo: 'LIMITE_TASA' });
  });
});
