import { describe, expect, it } from 'vitest';
import { CLAVE_MAX, CLAVE_MIN, validarClaveNueva } from '@/dominio/credenciales';

describe('validarClaveNueva: minimo de 7 caracteres', () => {
  it('el minimo es 7', () => {
    expect(CLAVE_MIN).toBe(7);
  });

  it('rechaza 6 caracteres y el mensaje dice 7', () => {
    expect(validarClaveNueva('abcdef')).toBe('La contraseña debe tener al menos 7 caracteres.');
  });

  it('acepta justo 7 caracteres', () => {
    expect(validarClaveNueva('abcdefg')).toBeNull();
  });

  it('rechaza vacia, pasada del maximo y con espacios en los bordes', () => {
    expect(validarClaveNueva('')).not.toBeNull();
    expect(validarClaveNueva('a'.repeat(CLAVE_MAX + 1))).not.toBeNull();
    expect(validarClaveNueva(' abcdefg')).not.toBeNull();
    expect(validarClaveNueva('abcdefg ')).not.toBeNull();
  });
});
