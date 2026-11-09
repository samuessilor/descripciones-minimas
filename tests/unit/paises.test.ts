import { describe, expect, it } from 'vitest';
import { CODIGOS_PAIS, esCodigoPais, listarPaises, nombrePais, sugerirPaises } from '@/dominio/paises';

describe('paises ISO 3166-1 (C-09, CA-05)', () => {
  it('trae la lista ISO completa (249 codigos) sin repetidos', () => {
    expect(CODIGOS_PAIS.length).toBe(249);
    expect(new Set(CODIGOS_PAIS).size).toBe(249);
    for (const c of CODIGOS_PAIS) expect(c).toMatch(/^[A-Z]{2}$/);
  });

  it('cada codigo tiene nombre en espanol distinto del codigo', () => {
    for (const c of CODIGOS_PAIS) {
      const n = nombrePais(c);
      expect(n.length, c).toBeGreaterThan(2);
      expect(n, c).not.toBe(c);
    }
    expect(nombrePais('FR')).toBe('Francia');
    expect(nombrePais('CN')).toBe('China');
    expect(nombrePais('CO')).toBe('Colombia');
    expect(nombrePais('US')).toMatch(/Estados Unidos/);
  });

  it('esCodigoPais valida el codigo exacto', () => {
    expect(esCodigoPais('FR')).toBe(true);
    expect(esCodigoPais('fr')).toBe(false);
    expect(esCodigoPais('ZZ')).toBe(false);
    expect(esCodigoPais('NO_SE_CONOCE')).toBe(false);
  });

  it('la lista sale ordenada por nombre', () => {
    const nombres = listarPaises().map((p) => p.nombre);
    const orden = [...nombres].sort((a, b) => a.localeCompare(b, 'es'));
    expect(nombres).toEqual(orden);
  });

  it('al escribir "Fra" sugiere Francia, ignorando tildes y mayusculas', () => {
    expect(sugerirPaises('Fra').map((p) => p.codigo)).toContain('FR');
    expect(sugerirPaises('mexi').map((p) => p.codigo)).toContain('MX');
    expect(sugerirPaises('').length).toBe(249);
  });
});
