/** Filtros del listado: la URL es la fuente y nada que venga de ella se confia (SPEC 10.3, 13.4). */
import { describe, expect, it } from 'vitest';
import { FILTROS_VACIOS, filtrosDesdeParametros, parametrosDeFiltros } from '@/server/politicas/listado';

describe('filtrosDesdeParametros', () => {
  it('sin parametros: los valores por defecto', () => {
    expect(filtrosDesdeParametros({})).toEqual(FILTROS_VACIOS);
  });

  it('lee estado, tipo, orden, pagina, mis pendientes y texto', () => {
    const f = filtrosDesdeParametros({ estado: 'amarillas', tipo: 'REPUESTO', orden: 'codigo', pagina: '3', mias: '1', q: 'naga' });
    expect(f).toMatchObject({ estado: 'amarillas', tipo: 'REPUESTO', orden: 'codigo', pagina: 3, mias: true, q: 'naga' });
  });

  it('ignora lo que no entiende en vez de fallar', () => {
    const f = filtrosDesdeParametros({ estado: 'rojas', tipo: 'COSA', orden: 'x', pagina: '-4', agencia: 'no-es-uuid' });
    expect(f).toMatchObject({ estado: 'todas', tipo: null, orden: 'recientes', pagina: 1, agencia: null });
  });

  it('la pagina es un entero razonable y el texto tiene tope', () => {
    expect(filtrosDesdeParametros({ pagina: 'abc' }).pagina).toBe(1);
    expect(filtrosDesdeParametros({ pagina: '99999999' }).pagina).toBeLessThanOrEqual(10_000);
    expect(filtrosDesdeParametros({ q: 'x'.repeat(500) }).q).toHaveLength(120);
  });

  it('si un parametro llega repetido toma el primero', () => {
    expect(filtrosDesdeParametros({ tipo: ['INSUMO', 'EQUIPO'] }).tipo).toBe('INSUMO');
  });

  it('partida: acepta prefijos con o sin puntos y descarta lo que no es partida', () => {
    expect(filtrosDesdeParametros({ partida: '8421.39' }).partida).toBe('8421.39');
    expect(filtrosDesdeParametros({ partida: ' 8421 ' }).partida).toBe('8421');
    expect(filtrosDesdeParametros({ partida: '84a1' }).partida).toBe('');
    expect(filtrosDesdeParametros({ partida: '1'.repeat(11) }).partida).toBe('');
    expect(parametrosDeFiltros({ ...FILTROS_VACIOS, partida: '8421.39' }).get('partida')).toBe('8421.39');
  });

  it('acepta una agencia solo si es un uuid', () => {
    const id = '3f1c2e9a-0000-4000-8000-000000000001';
    expect(filtrosDesdeParametros({ agencia: id }).agencia).toBe(id);
  });
});

describe('parametrosDeFiltros', () => {
  it('omite los valores por defecto', () => {
    expect(parametrosDeFiltros(FILTROS_VACIOS).toString()).toBe('');
  });

  it('ida y vuelta con filtros activos', () => {
    const f = { ...FILTROS_VACIOS, estado: 'verdes' as const, tipo: 'INSUMO' as const, q: 'a&b=c', pagina: 2, sinResponsable: true };
    const otra = filtrosDesdeParametros(Object.fromEntries(parametrosDeFiltros(f)));
    expect(otra).toMatchObject({ estado: 'verdes', tipo: 'INSUMO', q: 'a&b=c', pagina: 2, sinResponsable: true });
  });
});
