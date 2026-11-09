import { afterEach, describe, expect, it, vi } from 'vitest';
import { guardarCampoApi } from '@/componentes/ficha/api-cliente';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('guardarCampoApi', () => {
  it('una escritura colgada rechaza por tiempo limite (el campo pasa a «No se guardó» y reintenta)', async () => {
    // AbortSignal.timeout usa los temporizadores internos de Node: se sustituye por una senal que vence a mano.
    const vence = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(vence.signal);
    // Un servidor que no responde nunca: el fetch solo termina si su senal se aborta.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolver, rechazar) => {
            init?.signal?.addEventListener('abort', () => rechazar(init.signal?.reason));
          }),
      ),
    );
    const promesa = guardarCampoApi('ref-1', { campo: 'marca', valor: { texto: 'X' }, versionEsperada: 0 });
    expect(timeout).toHaveBeenCalledTimes(1);
    const ms = timeout.mock.calls[0]?.[0] ?? 0;
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(30_000);
    vence.abort(new DOMException('vencio', 'TimeoutError'));
    await expect(promesa).rejects.toThrow();
  });

  it('una respuesta a tiempo se devuelve con el contrato Resultado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { valor: 'X', version: 1 } }), { status: 200 })));
    const r = await guardarCampoApi('ref-1', { campo: 'marca', valor: { texto: 'X' }, versionEsperada: 0 });
    expect(r).toEqual({ ok: true, data: { valor: 'X', version: 1 } });
  });
});
