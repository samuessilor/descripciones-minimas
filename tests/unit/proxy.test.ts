/**
 * `proxy.ts`: primera barrera (13.2, 13.3). Se prueba la funcion con peticiones reales de Next:
 * CSRF sin Origin (RV-20), sesion presente, redireccion con `siguiente` seguro, CSP con nonce y
 * cabeceras de seguridad, y que /api/dev no exista fuera de desarrollo.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxy } from '@/proxy';

const BASE = 'http://localhost:3000';
const conCookie = { cookie: 'better-auth.session_token=abc.def' };

function req(ruta: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(ruta, BASE), { method: init.method ?? 'GET', headers: init.headers });
}

beforeEach(() => {
  vi.stubEnv('APP_URL', BASE);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sesion presente', () => {
  it('una pagina sin cookie redirige a /entrar con el destino', () => {
    const r = proxy(req('/referencias?estado=amarillo'));
    expect(r.status).toBe(307);
    expect(new URL(r.headers.get('location')!).pathname + new URL(r.headers.get('location')!).search).toBe(
      '/entrar?siguiente=%2Freferencias%3Festado%3Damarillo',
    );
  });

  it('la raiz sin cookie va a /entrar sin siguiente', () => {
    const r = proxy(req('/'));
    expect(new URL(r.headers.get('location')!).search).toBe('');
  });

  it('una API sin cookie responde 401 JSON, no una redireccion', async () => {
    const r = proxy(req('/api/referencias/abc/estado'));
    expect(r.status).toBe(401);
    expect(await r.json()).toMatchObject({ codigo: 'SIN_PERMISO', detalle: { sesionVencida: true } });
  });

  it('con cookie de sesion deja pasar (la autorizacion real es getActor)', () => {
    const r = proxy(req('/referencias', { headers: conCookie }));
    expect(r.status).toBe(200);
  });

  it('/entrar, /entrar/confirmar, /api/auth y /api/cron no exigen cookie', () => {
    for (const ruta of ['/entrar', '/entrar/confirmar?token=x', '/api/auth/get-session', '/api/cron/despachar', '/robots.txt', '/dev/ui', '/icon.svg', '/marca/essilorluxottica-wordmark-blanco.svg']) {
      expect(proxy(req(ruta)).status, ruta).toBe(200);
    }
  });
});

describe('CSRF: toda mutacion exige Origin valido (RV-20)', () => {
  it('rechaza POST/PUT/PATCH/DELETE sin Origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = proxy(req('/entrar', { method }));
      expect(r.status, method).toBe(403);
    }
  });

  it('rechaza un Origin ajeno y "null"', () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3999']) {
      expect(proxy(req('/entrar', { method: 'POST', headers: { origin } })).status, origin).toBe(403);
    }
  });

  it('acepta el Origin propio, o Sec-Fetch-Site: same-origin sin Origin', () => {
    expect(proxy(req('/entrar', { method: 'POST', headers: { origin: BASE } })).status).toBe(200);
    expect(proxy(req('/entrar', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
    expect(proxy(req('/entrar', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
  });

  it('las lecturas (GET) no exigen Origin', () => {
    expect(proxy(req('/entrar')).status).toBe(200);
  });

  it('el rechazo ocurre antes de comprobar la sesion y no filtra datos', async () => {
    const r = proxy(req('/referencias', { method: 'POST', headers: { ...conCookie, origin: 'https://evil.example' } }));
    expect(r.status).toBe(403);
    expect((await r.json()).mensaje).toMatch(/origen no es válido/);
  });
});

describe('cabeceras de seguridad y CSP (13.3)', () => {
  it('trae CSP con nonce por peticion, sin unsafe-eval fuera de desarrollo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const a = proxy(req('/entrar'));
    const b = proxy(req('/entrar'));
    const cspA = a.headers.get('content-security-policy')!;
    const cspB = b.headers.get('content-security-policy')!;
    const nonce = (csp: string) => /'nonce-([^']+)'/.exec(csp)![1];
    expect(nonce(cspA)).not.toBe(nonce(cspB));
    expect(cspA).toContain("default-src 'self'");
    expect(cspA).toContain("frame-ancestors 'none'");
    expect(cspA).toContain("img-src 'self' blob: data:");
    expect(cspA).toContain("object-src 'none'");
    expect(cspA).toContain("style-src 'self' 'nonce-");
    expect(cspA).not.toContain("'unsafe-eval'");
    expect(cspA).not.toMatch(/style-src 'self' 'unsafe-inline'/);
    expect(cspA).toContain('upgrade-insecure-requests');
  });

  it('en desarrollo permite unsafe-eval (React Refresh) y nada mas laxo en script-src', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const csp = proxy(req('/entrar')).headers.get('content-security-policy')!;
    expect(csp).toMatch(/script-src [^;]*'unsafe-eval'/);
    expect(csp).not.toMatch(/script-src [^;]*'unsafe-inline'/);
  });

  it('pone nosniff, referrer, permissions-policy, noindex y no permite marcos', () => {
    const h = proxy(req('/entrar')).headers;
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('permissions-policy')).toContain('camera=(self)');
    expect(h.get('x-robots-tag')).toContain('noindex');
    expect(h.get('x-frame-options')).toBe('DENY');
  });

  it('HSTS solo con APP_URL https y fuera de desarrollo', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://descripciones.example.com');
    expect(proxy(req('/entrar')).headers.get('strict-transport-security')).toContain('max-age=');
    vi.stubEnv('APP_URL', 'http://localhost:3000');
    expect(proxy(req('/entrar')).headers.get('strict-transport-security')).toBeNull();
  });

  it('las redirecciones y los errores tambien llevan las cabeceras', () => {
    expect(proxy(req('/referencias')).headers.get('content-security-policy')).toBeTruthy();
    expect(proxy(req('/entrar', { method: 'POST' })).headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('/api/dev solo existe en desarrollo (12.2)', () => {
  it('fuera de desarrollo responde 404 aunque haya sesion', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const r = proxy(req('/api/dev/correo', { headers: conCookie }));
    expect(r.status).toBe(404);
    expect(proxy(req('/api/dev/reset', { method: 'POST', headers: { origin: BASE, ...conCookie } })).status).toBe(404);
  });

  it('en desarrollo es publico y admite POST sin Origin solo ahi (curl)', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(proxy(req('/api/dev/correo')).status).toBe(200);
    expect(proxy(req('/api/dev/seed', { method: 'POST' })).status).toBe(200);
    // ...pero un navegador siempre manda Origin: uno ajeno se rechaza tambien aqui.
    expect(proxy(req('/api/dev/seed', { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403);
  });
});
