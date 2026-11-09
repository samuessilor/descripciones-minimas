/**
 * Llamadas de la ficha que NO son escrituras: estado (sondeo), refresco y presencia. Van por `fetch` y no por
 * Server Action porque Next ejecuta las acciones de una en una: un sondeo o un refresco detras de un guardado lo
 * haria esperar. Devuelven el mismo contrato `{ ok, data } | { ok: false, codigo, mensaje }` que las acciones.
 */
import type { AdjuntoVista } from '@/server/acciones/adjuntos';
import type { RevisionCodigo } from '@/server/acciones/crear-referencia';
import type { EstadoFicha } from '@/server/acciones/estado-ficha';
import type { CodigoError } from '@/server/acciones/resultado';
import type { SugerenciaPartida, VistaAduana } from '@/server/politicas/aduana';
import type { FichaVista } from '@/server/politicas/referencias';

export type Respuesta<T> = { ok: true; data: T } | { ok: false; codigo: CodigoError; mensaje: string; detalle?: unknown };

async function pedir<T>(url: string, init?: RequestInit): Promise<Respuesta<T>> {
  const r = await fetch(url, { cache: 'no-store', headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) }, ...init });
  const cuerpo = (await r.json().catch(() => null)) as unknown;
  if (r.ok) return { ok: true, data: cuerpo as T };
  const e = (cuerpo ?? {}) as { codigo?: CodigoError; mensaje?: string; detalle?: unknown };
  return { ok: false, codigo: e.codigo ?? 'ERROR_INTERNO', mensaje: e.mensaje ?? 'Algo salió mal de nuestro lado.', detalle: e.detalle };
}

export const pedirEstado = (id: string) => pedir<EstadoFicha>(`/api/referencias/${id}/estado`);
export const pedirFicha = (id: string) => pedir<{ ficha: FichaVista; adjuntos: AdjuntoVista[] }>(`/api/referencias/${id}`);
/** Zona de la aduana (sondeo y refresco): lectura por GET, no por Server Action. */
export const pedirVistaAduana = (id: string) => pedir<VistaAduana>(`/api/aduana/${id}/vista`);
export const pedirPartidas = (q: string) => pedir<SugerenciaPartida[]>(`/api/aduana/partidas?q=${encodeURIComponent(q)}`);
export const enviarLatido = (id: string, campo: string) =>
  pedir<{ hasta: string }>(`/api/referencias/${id}/latido`, { method: 'POST', body: JSON.stringify({ campo }) });
export const terminarLatido = (id: string, campo: string) =>
  pedir<{ ok: true }>(`/api/referencias/${id}/latido`, { method: 'POST', body: JSON.stringify({ campo, terminar: true }) });

import type { ResultadoGuardarCampo } from '@/server/acciones/guardar-campo';
import type { ResultadoResolverConflicto } from '@/server/acciones/resolver-conflicto';

/** Techo de una escritura: si el servidor no responde, el fetch rechaza y el campo pasa a «No se guardó» y reintenta. */
const TIEMPO_LIMITE_ESCRITURA_MS = 20_000;

/** Las rutas de escritura responden con el contrato `Resultado` (200 con `ok: false` para los errores esperados). */
async function pedirResultado<T>(url: string, cuerpo: unknown): Promise<Respuesta<T>> {
  const r = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO_LIMITE_ESCRITURA_MS),
  });
  const c = (await r.json().catch(() => null)) as Respuesta<T> | { ok: false; codigo?: CodigoError; mensaje?: string; detalle?: unknown } | null;
  if (c && typeof c === 'object' && 'ok' in c) {
    if (c.ok) return c as Respuesta<T>;
    return { ok: false, codigo: c.codigo ?? 'ERROR_INTERNO', mensaje: c.mensaje ?? 'Algo salió mal de nuestro lado.', detalle: c.detalle };
  }
  return { ok: false, codigo: 'ERROR_INTERNO', mensaje: 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.' };
}

/** Guarda un campo por `fetch` (no por Server Action: no espera detras de otras acciones de la pantalla). */
export const guardarCampoApi = (id: string, cuerpo: { campo: string; valor: unknown; versionEsperada: number; motivo?: string }) =>
  pedirResultado<ResultadoGuardarCampo>(`/api/referencias/${id}/campos`, cuerpo);

export const resolverConflictoApi = (id: string, cuerpo: { campo: string; opcion: 'dejar' | 'usar_mio' | 'combinar'; valor: unknown; motivo?: string }) =>
  pedirResultado<ResultadoResolverConflicto>(`/api/referencias/${id}/conflicto`, cuerpo);

/** Revision en vivo del codigo en «Nueva referencia». */
export const revisarCodigoApi = (codigo: string) =>
  pedir<RevisionCodigo>('/api/referencias/revisar-codigo', { method: 'POST', body: JSON.stringify({ codigo }) });
