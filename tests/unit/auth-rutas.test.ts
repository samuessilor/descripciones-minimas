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

  it('el resto queda cerrado (entrar, registrarse, contrasenas, cambio de correo, etc.)', () => {
    for (const [m, ruta] of [
      ['POST', '/api/auth/sign-in/email'],
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/change-password'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/forget-password'],
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
