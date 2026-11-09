import { describe, expect, it } from 'vitest';
import { rutaAuthPermitida } from '@/server/auth-rutas';

describe('rutas de Better Auth expuestas por HTTP', () => {
  it('solo POST /sign-out', () => {
    expect(rutaAuthPermitida('POST', '/api/auth/sign-out')).toBe(true);
  });

  it('GET /get-session NO se expone: entrega el token de sesion crudo en el cuerpo (anula HttpOnly)', () => {
    expect(rutaAuthPermitida('GET', '/api/auth/get-session')).toBe(false);
    expect(rutaAuthPermitida('POST', '/api/auth/get-session')).toBe(false);
  });

  it('el resto queda cerrado (magic-link, cuentas, cambio de correo, etc.)', () => {
    for (const [m, ruta] of [
      ['GET', '/api/auth/magic-link/verify'],
      ['POST', '/api/auth/sign-in/magic-link'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/change-email'],
      ['GET', '/api/auth/list-sessions'],
      ['POST', '/api/auth/revoke-sessions'],
      ['GET', '/api/auth/sign-out'],
      ['POST', '/api/auth/sign-out/'],
      ['POST', '/api/auth//sign-out'],
      ['POST', '/api/auth/Sign-Out'],
      ['DELETE', '/api/auth/sign-out'],
    ] as const) {
      expect(rutaAuthPermitida(m, ruta), `${m} ${ruta}`).toBe(false);
    }
  });
});
