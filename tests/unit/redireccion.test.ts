import { describe, expect, it } from 'vitest';
import { siguienteSeguro } from '@/dominio/redireccion';

describe('siguiente seguro (13.1, CA-18)', () => {
  it('admite rutas internas, con consulta y ancla', () => {
    expect(siguienteSeguro('/referencias/abc')).toBe('/referencias/abc');
    expect(siguienteSeguro('/referencias?estado=amarillo#x')).toBe('/referencias?estado=amarillo#x');
    expect(siguienteSeguro('/')).toBe('/');
  });

  it('ignora destinos externos o ambiguos y vuelve al inicio', () => {
    for (const malo of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'javascript:alert(1)',
      'evil.example',
      '',
      '/%0d%0aSet-Cookie:a=b'.replace('%0d%0a', '\r\n'),
      '/\t/evil.example',
    ]) {
      expect(siguienteSeguro(malo), JSON.stringify(malo)).toBe('/');
    }
    expect(siguienteSeguro(undefined)).toBe('/');
    expect(siguienteSeguro(42)).toBe('/');
  });

  it('no deja que la normalizacion de la URL fabrique un destino //externo (redireccion abierta)', () => {
    for (const malo of ['/.//evil.com', '/a/..//evil.com', '/%2e//evil.com', '/..//evil.com', '/././/evil.com', '/%2E%2E//evil.com', '/a/../..//evil.com']) {
      const r = siguienteSeguro(malo);
      expect(r, malo).toBe('/');
      expect(r.startsWith('//')).toBe(false);
    }
  });

  it('el resultado nunca empieza por // ni cambia de origen, para ninguna entrada', () => {
    const trozos = ['/', '.', '..', '%2e', '%2E', '//', 'x', 'evil.com', '?a=1', '#h', '%2f', '%5c'];
    for (const a of trozos) for (const b of trozos) for (const c of trozos) {
      const r = siguienteSeguro(`/${a}/${b}/${c}`);
      expect(r.startsWith('//'), r).toBe(false);
      expect(new URL(r, 'http://app.invalid/entrar').origin, r).toBe('http://app.invalid');
    }
  });

  it('usa el valor por defecto indicado', () => {
    expect(siguienteSeguro('//x', '/inicio')).toBe('/inicio');
  });
});
