/**
 * Regresiones de la revision independiente de H1 (acceso): limites de tasa de las invitaciones, bloqueo
 * dirigido de un correo ajeno y la sesion que `GET /get-session` entregaba en claro.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limiteTasa, session } from '@/db/esquema';
import { invitarUsuario } from '@/server/acciones/usuarios';
import { ErrorAccion } from '@/server/acciones/resultado';
import { confirmarEnlace, solicitarEnlace, type DepsAcceso } from '@/server/acceso';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { crearMailerMemoria } from '@/server/correo/consola';
import { REGLAS_TASA } from '@/server/limite-tasa';
import { nuevoEscenario, type Escenario } from './ayudas';

let e: Escenario;
let deps: DepsAcceso;
let mailer: ReturnType<typeof crearMailerMemoria>;
let auth: ReturnType<typeof crearAuth>;
let reloj = new Date();

const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });

beforeAll(async () => {
  e = await nuevoEscenario();
  mailer = crearMailerMemoria();
  auth = crearAuth({ db: e.db, config, mailer });
  deps = { db: e.db, auth, config, ahora: () => reloj };
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (x) {
    return x instanceof ErrorAccion ? x.codigo : `RAW:${String(x).slice(0, 100)}`;
  }
}

/** Una ventana de 15 min alineada con el reloj (las ventanas de limite_tasa son fijas). */
const T0 = Date.UTC(2026, 9, 21, 15, 0, 0);

describe('invitar a varias personas seguidas no choca con el limite por IP del admin', () => {
  it('7 invitaciones desde la misma IP: se crean 7 usuarios y salen 7 correos de bienvenida', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    reloj = new Date(T0);
    const resultados: string[] = [];
    for (let i = 0; i < 7; i++) {
      const u = await invitarUsuario(e.ctx(e.admin), {
        nombre: `Invitado ${i}`,
        email: `invitado${i}@prueba.invalid`,
        organizacionId: e.orgInterna,
        rol: 'solicitante',
      });
      resultados.push(
        await codigoDe(
          solicitarEnlace(deps, { email: u.email, ip: '203.0.113.5', plantilla: 'bienvenida', invitadoPor: e.admin.nombre }),
        ),
      );
    }
    expect(resultados).toEqual(Array(7).fill('OK'));
    expect(mailer.enviados).toHaveLength(7);
    expect(mailer.enviados.every((m) => m.asunto.length > 0 && m.para.startsWith('invitado'))).toBe(true);
  });

  it('el limite POR CORREO se mantiene: invitar dos veces al mismo correo en 30 s es LIMITE_TASA', async () => {
    await e.db.delete(limiteTasa);
    reloj = new Date(T0 + 60_000);
    await solicitarEnlace(deps, { email: 'invitado1@prueba.invalid', ip: '203.0.113.5', plantilla: 'bienvenida' });
    expect(await codigoDe(solicitarEnlace(deps, { email: 'invitado1@prueba.invalid', ip: '203.0.113.5', plantilla: 'bienvenida' }))).toBe(
      'LIMITE_TASA',
    );
  });

  it('el limite por IP sigue valiendo para quien pide un enlace de ACCESO, pero alcanza para una oficina detras de NAT', async () => {
    await e.db.delete(limiteTasa);
    const max = REGLAS_TASA.enlacePorIp.max;
    // Toda una oficina sale por la misma IP publica y pide su enlace a la misma hora: el tope no la frena
    expect(max).toBeGreaterThanOrEqual(30);
    const salidas: string[] = [];
    for (let i = 0; i < max + 2; i++) {
      reloj = new Date(T0 + i * 1000); // correos distintos: solo la IP frena, dentro de la misma ventana
      salidas.push(await codigoDe(solicitarEnlace(deps, { email: `oficina${i}@prueba.invalid`, ip: '198.51.100.9' })));
    }
    expect(salidas).toEqual([...Array<string>(max).fill('OK'), 'LIMITE_TASA', 'LIMITE_TASA']);
  });
});

describe('un tercero anonimo no puede quemar el cupo de un correo ajeno insistiendo', () => {
  it('8 solicitudes en 2 min de una IP: las rechazadas no cuentan y la victima, desde otra IP, entra', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    const atacante = '198.51.100.7';
    const salidas: string[] = [];
    for (let i = 0; i < 8; i++) {
      reloj = new Date(T0 + i * 15_000);
      salidas.push(await codigoDe(solicitarEnlace(deps, { email: 'edward@prueba.invalid', ip: atacante })));
    }
    // La espera de 30 s deja pasar a lo sumo una por ventana de 30 s: 4 en 2 min, menos que el cupo del correo (5)
    expect(salidas.filter((s) => s === 'OK').length).toBeLessThanOrEqual(4);
    expect(salidas).toContain('LIMITE_TASA');
    const antes = mailer.enviados.length;

    // Diez minutos despues, en la MISMA ventana de 15 min, la persona legitima pide su enlace desde otra IP.
    reloj = new Date(T0 + 10 * 60_000);
    expect(await codigoDe(solicitarEnlace(deps, { email: 'edward@prueba.invalid', ip: '203.0.113.99' }))).toBe('OK');
    expect(mailer.enviados.length).toBe(antes + 1);
  });

  it('una solicitud rechazada por la IP no suma al contador del correo', async () => {
    await e.db.delete(limiteTasa);
    const max = REGLAS_TASA.enlacePorIp.max;
    for (let i = 0; i < max; i++) {
      reloj = new Date(T0 + i * 1000); // agota el cupo de la IP con correos distintos
      await codigoDe(solicitarEnlace(deps, { email: `relleno${i}@prueba.invalid`, ip: '198.51.100.8' }));
    }
    for (let i = 0; i < 5; i++) {
      reloj = new Date(T0 + max * 1000 + i * 31_000);
      expect(await codigoDe(solicitarEnlace(deps, { email: 'charles@prueba.invalid', ip: '198.51.100.8' }))).toBe('LIMITE_TASA');
    }
    const filas = await e.db.select().from(limiteTasa);
    const delCorreo = filas.find((f) => f.clave === 'enlace-correo:charles@prueba.invalid');
    const delIp = filas.find((f) => f.clave === 'enlace-ip:198.51.100.8');
    expect(delIp!.contador).toBe(max + 5); // la IP si cuenta todo lo que intenta
    expect(delCorreo).toBeUndefined(); // el correo solo lo que paso la IP: nada
  });
});

describe('GET /get-session entregaba el token de sesion crudo en el cuerpo JSON', () => {
  it('Better Auth lo devuelve en claro (por eso la ruta ya no se expone por HTTP)', async () => {
    await e.db.delete(limiteTasa);
    mailer.enviados.length = 0;
    reloj = new Date();
    await solicitarEnlace(deps, { email: 'edward@prueba.invalid', ip: null });
    const token = new URL(mailer.enviados.at(-1)!.enlace!).searchParams.get('token')!;
    const r = await confirmarEnlace(deps, { token, headers: new Headers() });
    if (!r.ok) throw new Error(r.motivo);
    const cookie = r.setCookie.map((c) => c.split(';')[0]).join('; ');
    const resp = await auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie } }));
    const cuerpo = (await resp.json()) as { session?: { token?: string } };
    const [enBd] = await e.db.select({ token: session.token }).from(session).where(eq(session.token, cuerpo.session?.token ?? ''));
    expect(enBd?.token).toBe(cuerpo.session?.token); // el cuerpo trae el token real de la sesion
    const { rutaAuthPermitida } = await import('@/server/auth-rutas');
    expect(rutaAuthPermitida('GET', '/api/auth/get-session')).toBe(false);
  });
});
