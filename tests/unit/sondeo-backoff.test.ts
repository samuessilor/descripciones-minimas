import type * as PresenciaModulo from '@/componentes/colaboracion/presencia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF, LATIDO_EDICION_MS, LATIDO_PRIMERO_MS, OCULTA_MIN_MS, pasosDeEspera, SONDEO } from '@/componentes/colaboracion/sondeo';

describe('SONDEO: tabla de intervalos (un solo sitio)', () => {
  it('valores finales (sin NEXT_PUBLIC_SONDEO_FACTOR)', () => {
    expect(SONDEO).toEqual({
      estadoFicha: 60_000,
      fichaCerrada: 180_000,
      seguimiento: 90_000,
      comentarios: 90_000,
      contexto: 120_000,
      campana: 120_000,
      bandeja: 300_000,
    });
    expect(OCULTA_MIN_MS).toBe(30_000);
  });

  it('quien lee campos y la zona de la aduana ya no tiene reloj propio', () => {
    expect(Object.keys(SONDEO)).not.toContain('historial');
    expect(Object.keys(SONDEO)).not.toContain('aduana');
  });

  it('el latido deja margen para perder uno: 0, 40, 80 < vigencia (90 s, VIGENCIA_LATIDO_MS en estado-ficha.ts); el primero sale pasado un momento del foco', () => {
    expect(LATIDO_EDICION_MS).toBe(40_000);
    expect(LATIDO_EDICION_MS * 2).toBeLessThan(90_000);
    expect(LATIDO_PRIMERO_MS).toBeGreaterThanOrEqual(1_500);
    expect(LATIDO_PRIMERO_MS).toBeLessThanOrEqual(2_000);
  });
});

describe('pasosDeEspera (backoff)', () => {
  const quieto = BACKOFF.sinGestoMs + 1;

  it('sin 3 tics seguidos sin cambios, o con un gesto reciente, no espacia', () => {
    expect(pasosDeEspera(45_000, 0, quieto)).toBe(1);
    expect(pasosDeEspera(45_000, 2, quieto)).toBe(1);
    expect(pasosDeEspera(45_000, 9, BACKOFF.sinGestoMs)).toBe(1);
    expect(pasosDeEspera(45_000, 9, 1_000)).toBe(1);
  });

  it('con 3 tics sin cambios y sin gestos duplica en cada tic sin cambios, hasta el techo de 3 min', () => {
    expect(pasosDeEspera(45_000, 3, quieto)).toBe(2); // 90 s
    expect(pasosDeEspera(45_000, 4, quieto)).toBe(4); // 180 s
    expect(pasosDeEspera(45_000, 20, quieto)).toBe(4); // nunca mas de 180 s
    expect(pasosDeEspera(30_000, 20, quieto)).toBe(6);
  });

  it('un intervalo base que ya no cabe en el techo no se espacia', () => {
    expect(pasosDeEspera(120_000, 20, quieto)).toBe(1);
    expect(pasosDeEspera(300_000, 20, quieto)).toBe(1);
  });
});

describe('sondearConBackoff y alVolverDePestana', () => {
  let p: typeof PresenciaModulo;
  let ventana: EventTarget;
  let documento: EventTarget & { visibilityState: 'visible' | 'hidden' };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    ventana = new EventTarget();
    documento = Object.assign(new EventTarget(), { visibilityState: 'visible' as 'visible' | 'hidden' });
    vi.stubGlobal('window', ventana);
    vi.stubGlobal('document', documento);
    vi.resetModules();
    p = await import('@/componentes/colaboracion/presencia');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const gesto = () => ventana.dispatchEvent(new Event('pointerdown'));
  const BASE = 45_000;

  it('mientras alguien usa la pantalla sondea al ritmo base, aunque no haya cambios', async () => {
    const tic = vi.fn(() => false);
    const parar = p.sondearConBackoff(BASE, tic);
    for (let i = 1; i <= 8; i++) {
      gesto();
      await vi.advanceTimersByTimeAsync(BASE);
      expect(tic).toHaveBeenCalledTimes(i);
    }
    parar();
  });

  it('tras 3 tics sin cambios y sin gestos deja de sondear hasta el primer gesto, que vuelve al ritmo base', async () => {
    const tic = vi.fn(() => false);
    const parar = p.sondearConBackoff(BASE, tic);
    for (let i = 1; i <= 3; i++) {
      gesto();
      await vi.advanceTimersByTimeAsync(BASE);
    }
    expect(tic).toHaveBeenCalledTimes(3);
    // Un ultimo gesto y nadie mas: el tic a los 45 s todavia corre (gesto reciente); los siguientes se espacian.
    gesto();
    await vi.advanceTimersByTimeAsync(BASE);
    expect(tic).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(BASE * 2); // 90 s y 135 s sin gestos: se salta (y a los 3 min la pestana deja de contar como presente)
    expect(tic).toHaveBeenCalledTimes(4);
    // Vuelve la persona: el siguiente tic ya es al ritmo base.
    gesto();
    await vi.advanceTimersByTimeAsync(BASE);
    expect(tic).toHaveBeenCalledTimes(5);
    parar();
  });

  it('un cambio devuelve el ritmo base aunque no haya gestos', async () => {
    let n = 0;
    const tic = vi.fn(() => ++n === 4); // el 4.o tic trae un cambio
    const parar = p.sondearConBackoff(BASE, tic);
    for (let i = 1; i <= 3; i++) {
      gesto();
      await vi.advanceTimersByTimeAsync(BASE);
    }
    gesto();
    await vi.advanceTimersByTimeAsync(BASE); // 4.o tic: cambio => contador a cero
    expect(tic).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(BASE); // 90 s sin gestos: sin backoff porque hubo un cambio
    expect(tic).toHaveBeenCalledTimes(5);
    parar();
  });

  it('un tic que falla no tumba el sondeo ni cuenta como «sin cambios»; parar() lo detiene', async () => {
    const tic = vi.fn(() => Promise.reject(new Error('sin red')));
    const parar = p.sondearConBackoff(BASE, tic);
    for (let i = 1; i <= 5; i++) {
      gesto();
      await vi.advanceTimersByTimeAsync(BASE);
      expect(tic).toHaveBeenCalledTimes(i);
    }
    parar();
    gesto();
    await vi.advanceTimersByTimeAsync(BASE * 3);
    expect(tic).toHaveBeenCalledTimes(5);
  });

  it('una pestana oculta no sondea', async () => {
    const tic = vi.fn(() => false);
    const parar = p.sondearConBackoff(BASE, tic);
    documento.visibilityState = 'hidden';
    gesto();
    await vi.advanceTimersByTimeAsync(BASE * 2);
    expect(tic).not.toHaveBeenCalled();
    parar();
  });

  it('alVolverDePestana: solo avisa si la pestana estuvo oculta mas de OCULTA_MIN_MS', async () => {
    const cb = vi.fn();
    const dejar = p.alVolverDePestana(cb);
    const ocultarYVolver = async (ms: number) => {
      documento.visibilityState = 'hidden';
      documento.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(ms);
      documento.visibilityState = 'visible';
      documento.dispatchEvent(new Event('visibilitychange'));
    };
    await ocultarYVolver(5_000);
    expect(cb).not.toHaveBeenCalled(); // cambiar de pestana un momento no relee nada
    await ocultarYVolver(OCULTA_MIN_MS + 1_000);
    expect(cb).toHaveBeenCalledTimes(1);
    await ocultarYVolver(2_000);
    expect(cb).toHaveBeenCalledTimes(1); // el conteo se reinicia en cada ausencia
    dejar();
    await ocultarYVolver(OCULTA_MIN_MS + 1_000);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
