import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leerUnaVez } from '@/componentes/colaboracion/api';

describe('leerUnaVez: copias del mismo componente comparten una sola peticion', () => {
  let pedidas: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T10:00:00Z'));
    pedidas = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        pedidas.push(url);
        return new Response(JSON.stringify({ n: pedidas.length }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('tres copias que piden la misma URL a la vez hacen una sola peticion y reciben lo mismo', async () => {
    const url = '/api/prueba/misma';
    const [a, b, c] = await Promise.all([leerUnaVez<{ n: number }>(url, 500), leerUnaVez<{ n: number }>(url, 500), leerUnaVez<{ n: number }>(url, 500)]);
    expect(pedidas).toEqual([url]);
    expect(a).toEqual({ ok: true, data: { n: 1 } });
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('pasada la ventana vuelve a pedir; una ventana larga (reloj) sigue reutilizando', async () => {
    const url = '/api/prueba/ventana';
    await leerUnaVez(url, 500);
    vi.advanceTimersByTime(300);
    await leerUnaVez(url, 500); // dentro de la ventana de accion: reutiliza
    expect(pedidas).toHaveLength(1);

    vi.advanceTimersByTime(300); // 600 ms desde la primera: la ventana de accion ya vencio
    await leerUnaVez(url, 500);
    expect(pedidas).toHaveLength(2);

    vi.advanceTimersByTime(20_000);
    await leerUnaVez(url, 42_000); // un tic de reloj (70 % de 60 s) reutiliza lo leido hace 20 s
    expect(pedidas).toHaveLength(2);
    vi.advanceTimersByTime(25_000);
    await leerUnaVez(url, 42_000); // 45 s: ya toca leer
    expect(pedidas).toHaveLength(3);
  });

  it('una lectura por accion no reutiliza una respuesta cuya peticion salio ANTES de la orden', async () => {
    const url = '/api/prueba/orden';
    await leerUnaVez(url, 500); // un tic de reloj sale en t=0 y pudo leer antes de la escritura
    vi.advanceTimersByTime(300);
    const orden = Date.now(); // la accion termina en t=300 ms y pide leer de nuevo
    await leerUnaVez(url, 500, orden - 20);
    expect(pedidas).toHaveLength(2); // peticion nueva, no la vieja

    // Dos copias que reciben el mismo evento a la vez (mismo instante) comparten la lectura nueva.
    await leerUnaVez(url, 500, orden - 20);
    expect(pedidas).toHaveLength(2);
  });

  it('URLs distintas no se mezclan', async () => {
    await leerUnaVez('/api/prueba/uno', 500);
    await leerUnaVez('/api/prueba/dos', 500);
    expect(pedidas).toEqual(['/api/prueba/uno', '/api/prueba/dos']);
  });
});
