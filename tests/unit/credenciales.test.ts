import { describe, expect, it } from 'vitest';
import { CLAVE_MAX, CLAVE_MIN, usuarioSugeridoAgencia, validarClaveNueva, validarUsuario } from '@/dominio/credenciales';

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

describe('usuarioSugeridoAgencia: <empresa>.aduana', () => {
  it('pasa el nombre a minusculas, sin tildes y con guiones', () => {
    expect(usuarioSugeridoAgencia('Agencia de Aduanas X')).toBe('agencia-de-aduanas-x.aduana');
    expect(usuarioSugeridoAgencia('  Aduanas del Pacífico S.A.S. ')).toBe('aduanas-del-pacifico-s-a-s.aduana');
  });

  it('siempre es un usuario valido, incluso con nombres raros o muy largos', () => {
    for (const nombre of ['A', '???', 'ñandú', 'x'.repeat(200), 'Empresa de nombre larguisimo para una agencia de aduana']) {
      expect(validarUsuario(usuarioSugeridoAgencia(nombre)), nombre).toBeNull();
    }
    expect(usuarioSugeridoAgencia('???')).toBe('agencia.aduana');
  });
});
