/**
 * Cliente de las lecturas de colaboracion (GET) y avisos entre componentes. Las escrituras van por Server
 * Actions (`@/app/acciones/colaboracion`); las lecturas por GET para que un sondeo no haga cola delante de
 * un guardado (las Server Actions se ejecutan de una en una).
 */
import { tiempoRelativo } from '@/dominio/colaboracion';

export type RespuestaLectura<T> = { ok: true; data: T } | { ok: false; mensaje: string; estado: number };

const MENSAJE_RED = 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';

export async function leer<T>(url: string, senal?: AbortSignal): Promise<RespuestaLectura<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...(senal ? { signal: senal } : {}) });
    const cuerpo: unknown = await r.json().catch(() => null);
    if (r.ok) return { ok: true, data: cuerpo as T };
    if (r.status === 401) {
      return { ok: false, estado: 401, mensaje: 'Tu sesión venció. Entra de nuevo en otra pestaña y vuelve aquí.' };
    }
    const mensaje = (cuerpo as { mensaje?: string } | null)?.mensaje;
    return {
      ok: false,
      estado: r.status,
      mensaje: mensaje ?? 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.',
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { ok: false, estado: 0, mensaje: '' };
    return { ok: false, estado: 0, mensaje: MENSAJE_RED };
  }
}

// ---- Eventos entre componentes (la ficha los escucha para refrescarse) ------------------------------------

/** Algo cambio en la ficha (envio, restauracion, comentario): quien la muestre puede volver a leerla. */
export const EVENTO_FICHA_CAMBIADA = 'dm:ficha-cambiada';
/** Abre el panel de actividad (desde un icono de comentario junto a un campo, por ejemplo). */
export const EVENTO_ABRIR_ACTIVIDAD = 'dm:abrir-actividad';

export interface DetalleAbrirActividad {
  referenciaId: string;
  pestana?: 'historial' | 'comentarios' | 'envios';
  /** Filtra por este campo (su clave). */
  campo?: string;
}

export function avisarCambioDeFicha(referenciaId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_FICHA_CAMBIADA, { detail: { referenciaId } }));
}

export function abrirActividad(detalle: DetalleAbrirActividad): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_ACTIVIDAD, { detail: detalle }));
}

// ---- Tiempo ---------------------------------------------------------------------------------------------------

export function hace(iso: string, ahora: Date = new Date()): string {
  return tiempoRelativo(iso, ahora);
}

/** «21 oct, 10:12 a. m.» en hora de Bogota. */
export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}
