/**
 * Regresiones de la revision independiente de H1 (acceso) llevadas al acceso por usuario y contrasena: el limite por
 * IP no frena a una oficina entera, lo rechazado por la IP no gasta el cupo del usuario, y la sesion que
 * `GET /get-session` entregaba en claro.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limiteTasa, session } from '@/db/esquema';
import { ErrorAccion } from '@/server/acciones/resultado';
import { iniciarSesion, type DepsAcceso } from '@/server/acceso';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { REGLAS_TASA } from '@/server/limite-tasa';
import { nuevoEscenario, type Escenario } from './ayudas';
import { CLAVE_PRUEBA, conCredenciales } from './ayudas-acceso';

let e: Escenario;
let deps: DepsAcceso;
let auth: ReturnType<typeof crearAuth>;
let reloj = new Date();

const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });

beforeAll(async () => {
  e = await nuevoEscenario();
  auth = crearAuth({ db: e.db, config });
  deps = { db: e.db, auth, config, ahora: () => reloj };
  await conCredenciales(e.db, e.edward.usuarioId, 'edward');
  await conCredenciales(e.db, e.charles.usuarioId, 'charles');
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

const entrarCon = (usuario: string, clave: string, ip: string | null) => iniciarSesion(deps, { usuario, clave, ip, headers: new Headers() });

/** Una ventana de 15 min alineada con el reloj (las ventanas de limite_tasa son fijas). */
const T0 = Date.UTC(2026, 9, 21, 15, 0, 0);

describe('el limite por IP alcanza para una oficina detras de NAT', () => {
  it('toda una oficina entra desde la misma IP publica sin toparse con el tope; pasado el tope, se frena', async () => {
    await e.db.delete(limiteTasa);
    const max = REGLAS_TASA.accesoPorIp.max;
    expect(max).toBeGreaterThanOrEqual(30); // no frena a una oficina entrando a la misma hora
    const salidas: string[] = [];
    for (let i = 0; i < max + 2; i++) {
      reloj = new Date(T0 + i * 1000);
      salidas.push(await codigoDe(entrarCon('edward', CLAVE_PRUEBA, '198.51.100.9')));
    }
    expect(salidas).toEqual([...Array<string>(max).fill('OK'), 'LIMITE_TASA', 'LIMITE_TASA']);
  });
});

describe('lo rechazado por la IP no gasta el cupo del usuario', () => {
  it('una IP desbordada que insiste sobre «charles»: la IP cuenta todo; el usuario, nada', async () => {
    await e.db.delete(limiteTasa);
    const max = REGLAS_TASA.accesoPorIp.max;
    for (let i = 0; i < max; i++) {
      reloj = new Date(T0 + i * 1000); // agota el cupo de la IP con usuarios que no existen
      await codigoDe(entrarCon(`relleno${i}`, 'x-clave-cualquiera', '198.51.100.8'));
    }
    for (let i = 0; i < 5; i++) {
      reloj = new Date(T0 + max * 1000 + i * 1000);
      expect(await codigoDe(entrarCon('charles', 'mala-clave-xx', '198.51.100.8'))).toBe('LIMITE_TASA');
    }
    const filas = await e.db.select().from(limiteTasa);
    expect(filas.find((f) => f.clave === 'acceso-ip:198.51.100.8')!.contador).toBe(max + 5); // la IP si cuenta todo lo que intenta
    expect(filas.find((f) => f.clave === 'acceso-fallos:charles')).toBeUndefined(); // el usuario, solo lo que paso la IP: nada
  });

  it('compromiso aceptado: 10 fallos sobre un usuario lo frenan hasta que cierra la ventana, y entrar bien despues funciona', async () => {
    await e.db.delete(limiteTasa);
    for (let i = 0; i < REGLAS_TASA.accesoFallidoPorUsuario.max; i++) {
      reloj = new Date(T0 + i * 1000);
      expect(await codigoDe(entrarCon('edward', 'mala-clave-xx', `203.0.113.${i + 1}`))).toBe('OK'); // cada fallo, desde otra IP
    }
    reloj = new Date(T0 + 60_000);
    expect(await codigoDe(entrarCon('edward', CLAVE_PRUEBA, '203.0.113.99'))).toBe('LIMITE_TASA');
    reloj = new Date(T0 + 16 * 60_000);
    expect(await codigoDe(entrarCon('edward', CLAVE_PRUEBA, '203.0.113.99'))).toBe('OK');
  });
});

describe('GET /get-session entregaba el token de sesion crudo en el cuerpo JSON', () => {
  it('Better Auth lo devuelve en claro (por eso la ruta ya no se expone por HTTP)', async () => {
    await e.db.delete(limiteTasa);
    reloj = new Date();
    const r = await entrarCon('edward', CLAVE_PRUEBA, null);
    if (!r.ok) throw new Error('no entro');
    const cookie = r.setCookie.map((c) => c.split(';')[0]).join('; ');
    const resp = await auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers: { cookie } }));
    const cuerpo = (await resp.json()) as { session?: { token?: string } };
    const [enBd] = await e.db.select({ token: session.token }).from(session).where(eq(session.token, cuerpo.session?.token ?? ''));
    expect(enBd?.token).toBe(cuerpo.session?.token); // el cuerpo trae el token real de la sesion
    const { rutaAuthPermitida } = await import('@/server/auth-rutas');
    expect(rutaAuthPermitida('GET', '/api/auth/get-session')).toBe(false);
  });
});
