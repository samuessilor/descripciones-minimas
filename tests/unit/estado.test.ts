import { describe, expect, it } from 'vitest';
import {
  colorFicha,
  etiquetaFicha,
  evaluarCierre,
  transicionar,
  type EntradaCierre,
} from '@/dominio/estado';

describe('maquina de estados 8.1', () => {
  it('BORRADOR pasa a EN_GESTION con el primer "Enviar a"', () => {
    expect(transicionar('BORRADOR', 'primer_envio')).toBe('EN_GESTION');
  });

  it('EN_GESTION se mantiene al enviar a otra persona', () => {
    expect(transicionar('EN_GESTION', 'primer_envio')).toBe('EN_GESTION');
  });

  it('EN_GESTION pasa a CLASIFICADA al cerrar y vuelve a EN_GESTION al reabrir', () => {
    expect(transicionar('EN_GESTION', 'cerrar')).toBe('CLASIFICADA');
    expect(transicionar('CLASIFICADA', 'reabrir')).toBe('EN_GESTION');
  });

  it('rechaza transiciones imposibles', () => {
    expect(() => transicionar('BORRADOR', 'cerrar')).toThrow();
    expect(() => transicionar('BORRADOR', 'reabrir')).toThrow();
    expect(() => transicionar('EN_GESTION', 'reabrir')).toThrow();
    expect(() => transicionar('CLASIFICADA', 'cerrar')).toThrow();
    expect(() => transicionar('CLASIFICADA', 'primer_envio')).toThrow();
  });
});

describe('color: verde si y solo si CLASIFICADA (C-12, C-13, A3)', () => {
  it('solo hay dos colores', () => {
    expect(colorFicha('BORRADOR')).toBe('amarillo');
    expect(colorFicha('EN_GESTION')).toBe('amarillo');
    expect(colorFicha('CLASIFICADA')).toBe('verde');
  });
});

describe('etiqueta derivada de la ficha (8.1)', () => {
  const base = {
    estado: 'EN_GESTION' as const,
    archivada: false,
    reabierta: false,
    finalizada: null as 'SI' | 'NO' | null,
    tresSeccionesVerdes: false,
  };

  it('estados simples', () => {
    expect(etiquetaFicha({ ...base, estado: 'BORRADOR' })).toBe('Borrador');
    expect(etiquetaFicha({ ...base, estado: 'CLASIFICADA', finalizada: 'SI' })).toBe('Clasificada');
    expect(etiquetaFicha(base)).toBe('En gestión');
  });

  it('en espera de clasificacion: las tres secciones verdes y finalizada vacia', () => {
    expect(etiquetaFicha({ ...base, tresSeccionesVerdes: true })).toBe('En espera de clasificación');
  });

  it('pendiente de informacion: la aduana marco finalizada NO', () => {
    expect(etiquetaFicha({ ...base, finalizada: 'NO', tresSeccionesVerdes: false })).toBe('Pendiente de información');
  });

  it('pendiente de informacion: la aduana pidio informacion y el area no ha respondido (A2)', () => {
    expect(etiquetaFicha({ ...base, tresSeccionesVerdes: true, esperaRespuesta: true })).toBe('Pendiente de información');
  });

  it('precedencia: Reabierta > Pendiente de informacion > En espera > En gestion', () => {
    expect(etiquetaFicha({ ...base, reabierta: true, finalizada: 'NO' })).toBe('Reabierta');
    expect(etiquetaFicha({ ...base, finalizada: 'NO', tresSeccionesVerdes: true })).toBe(
      'Pendiente de información',
    );
  });

  it('la ficha archivada se rotula Archivada sin color propio', () => {
    expect(etiquetaFicha({ ...base, archivada: true })).toBe('Archivada');
    expect(colorFicha('EN_GESTION')).toBe('amarillo');
  });
});

describe('cierre de la clasificacion (D-26): G1 y G6 duras, A1-A3 advertencias', () => {
  const ok: EntradaCierre = {
    rol: 'aduana',
    fichaVisible: true,
    partida: '8421.39.90.00',
    camposAreaFaltantes: [],
    descripcionesVacias: false,
    restriccionesVacias: false,
    modo: 'advertir',
  };

  it('sin advertencias cierra con la confirmacion normal', () => {
    expect(evaluarCierre(ok)).toEqual({ ok: true, advertencias: [], requiereMotivo: false });
  });

  it('G1: partida ausente o con formato invalido bloquea', () => {
    for (const partida of [null, '', '8421', '84213990']) {
      const r = evaluarCierre({ ...ok, partida });
      expect(r.ok, String(partida)).toBe(false);
      if (!r.ok) expect(r.bloqueos[0]?.regla).toBe('G1');
    }
  });

  it('G6: solo aduana, admin o supervisora sobre una ficha visible', () => {
    for (const rol of ['solicitante', 'lector'] as const) {
      const r = evaluarCierre({ ...ok, rol });
      expect(r.ok, rol).toBe(false);
      if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toContain('G6');
    }
    const admin = evaluarCierre({ ...ok, rol: 'admin' });
    expect(admin.ok).toBe(true);
    expect(evaluarCierre({ ...ok, rol: 'supervisor' }).ok).toBe(true);
    const noVisible = evaluarCierre({ ...ok, fichaVisible: false });
    expect(noVisible.ok).toBe(false);
  });

  it('A1-A3 se listan exactamente y exigen motivo para "Cerrar de todos modos"', () => {
    const r = evaluarCierre({
      ...ok,
      camposAreaFaltantes: ['uso', 'marca', 'pais_origen'],
      descripcionesVacias: true,
      restriccionesVacias: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.requiereMotivo).toBe(true);
      expect(r.advertencias.map((a) => a.regla)).toEqual(['A1', 'A2', 'A3']);
      expect(r.advertencias[0]?.mensaje).toBe('Faltan 3 campos del área');
      expect(r.advertencias[0]?.detalle).toEqual(['uso', 'marca', 'pais_origen']);
      expect(r.advertencias[1]?.mensaje).toBe('Las descripciones mínimas adicionales están vacías');
    }
  });

  it('con CIERRE_MODO=bloquear las advertencias pasan a ser guardas duras', () => {
    const r = evaluarCierre({
      ...ok,
      modo: 'bloquear',
      camposAreaFaltantes: ['uso'],
      restriccionesVacias: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toEqual(['A1', 'A3']);
  });

  it('G1 y G6 se reportan juntas si ambas fallan', () => {
    const r = evaluarCierre({ ...ok, rol: 'lector', partida: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toEqual(['G6', 'G1']);
  });
});
