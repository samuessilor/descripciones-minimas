/**
 * El `matcher` de `proxy.ts` decide en que rutas corre la primera barrera (Origin, sesion, CSP). No puede
 * excluir por extension: `/referencias/<id>.png` es una ruta DINAMICA que terminaba en `.png` y se saltaba
 * todo (13.3, RV-20). Se prueba la expresion compilada del `source` contra rutas reales.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config, proxy } from '@/proxy';

const BASE = 'http://localhost:3000';

function corre(ruta: string): boolean {
  const matcher = config.matcher[0];
  const source = typeof matcher === 'string' ? matcher : matcher!.source;
  // Next compila el `source` con path-to-regexp; el grupo sin nombre `( ... )` es una expresion regular literal.
  return new RegExp(`^${source}$`).test(ruta);
}

beforeEach(() => {
  vi.stubEnv('APP_URL', BASE);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('matcher del proxy', () => {
  it('corre en las rutas dinamicas aunque terminen en una extension de imagen o fuente', () => {
    for (const ruta of [
      '/referencias/abc',
      '/referencias/abc.png',
      '/referencias/6f9619ff-8b86-d011-b42d-00c04fc964ff.jpg',
      '/api/adjuntos/abc.webp',
      '/api/adjuntos/abc.jpg',
      '/api/adjuntos/abc.svg',
      '/api/adjuntos/abc.ico',
      '/api/adjuntos/abc.woff2',
      '/entrar',
      '/',
    ]) {
      expect(corre(ruta), ruta).toBe(true);
    }
  });

  it('no corre en los estaticos de compilacion', () => {
    for (const ruta of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico']) {
      expect(corre(ruta), ruta).toBe(false);
    }
  });
});

describe('estaticos de marca siguen siendo publicos', () => {
  it('el icono y public/marca no exigen sesion', () => {
    for (const ruta of ['/icon.svg', '/marca/logo.svg']) {
      const r = proxy(new NextRequest(new URL(ruta, BASE)));
      expect(r.status, ruta).toBe(200);
    }
  });
});

describe('una ruta dinamica con extension de imagen ya no se salta la barrera', () => {
  it('POST sin Origin a /referencias/abc.png responde 403, igual que a /referencias/abc', () => {
    for (const ruta of ['/referencias/abc', '/referencias/abc.png', '/api/adjuntos/abc.jpg']) {
      const r = proxy(new NextRequest(new URL(ruta, BASE), { method: 'POST' }));
      expect(r.status, ruta).toBe(403);
    }
  });

  it('GET sin sesion a /api/adjuntos/abc.jpg responde 401 con cabeceras de seguridad', () => {
    const r = proxy(new NextRequest(new URL('/api/adjuntos/abc.jpg', BASE)));
    expect(r.status).toBe(401);
    expect(r.headers.get('content-security-policy')).toBeTruthy();
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
