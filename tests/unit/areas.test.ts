import { describe, expect, it } from 'vitest';
import { AREAS, esArea, nombreDeArea, normalizarArea } from '@/dominio/areas';
import { getCampo } from '@/dominio/campos';
import { normalizarValor } from '@/dominio/valores';

describe('areas fijas (P4, C2)', () => {
  it('son las cuatro de la reunion, en ese orden', () => {
    expect(AREAS).toEqual(['Consumibles', 'Mantenimiento', 'Instrumentos', 'Marketing']);
    expect(esArea('Mantenimiento')).toBe(true);
    expect(esArea('mantenimiento')).toBe(false);
    expect(nombreDeArea('Marketing')).toBe('Área Marketing');
  });

  it('el texto libre viejo se lleva al catalogo: «Insumos» es Consumibles; lo desconocido no es area', () => {
    expect(normalizarArea('Insumos')).toBe('Consumibles');
    expect(normalizarArea('  MANTENIMIENTO ')).toBe('Mantenimiento');
    expect(normalizarArea('instrumentos')).toBe('Instrumentos');
    expect(normalizarArea('Logística')).toBeNull();
    expect(normalizarArea(null)).toBeNull();
  });

  it('el campo «Área responsable» es de Producto, del area, obligatorio y solo admite el catalogo', () => {
    const c = getCampo('area_responsable');
    expect(c).toMatchObject({ seccion: 'producto', grupo: 'C', tipoDato: 'area', etiqueta: 'Área responsable' });
    const hoy = { hoy: '2026-10-29' };
    expect(normalizarValor('area_responsable', 'Consumibles', hoy)).toEqual({ ok: true, valor: 'Consumibles' });
    expect(normalizarValor('area_responsable', '', hoy)).toEqual({ ok: true, valor: null });
    expect(normalizarValor('area_responsable', 'Logística', hoy).ok).toBe(false);
    expect(normalizarValor('area_responsable', { no_aplica: true }, hoy).ok).toBe(false);
  });
});
