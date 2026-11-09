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

const recientes = new Map<string, { t: number; p: Promise<RespuestaLectura<unknown>> }>();

/**
 * Como `leer`, pero si OTRO componente pidio la misma URL hace menos de `ventanaMs`, reutiliza esa respuesta en vez de
 * pedirla otra vez. Hay pantallas que montan el mismo componente varias veces (el boton «Enviar a…» va tres veces en la
 * ficha) y cada copia sondeaba por su cuenta: tres peticiones iguales por tic. Las lecturas de reloj usan una ventana
 * larga. Las que vienen de una accion propia (guardar, enviar, comentar) pasan `desde` (el instante de la orden): solo
 * reutilizan una respuesta cuya peticion SALIO despues de la orden, porque una anterior pudo leer antes de la escritura.
 */
export function leerUnaVez<T>(url: string, ventanaMs: number, desde = 0): Promise<RespuestaLectura<T>> {
  const ahora = Date.now();
  const previa = recientes.get(url);
  if (previa && ahora - previa.t < ventanaMs && previa.t >= desde) return previa.p as Promise<RespuestaLectura<T>>;
  if (recientes.size > 40) for (const [k, v] of recientes) if (ahora - v.t > 120_000) recientes.delete(k);
  const p = leer<T>(url);
  recientes.set(url, { t: ahora, p });
  return p;
}

// ---- Eventos entre componentes (la ficha los escucha para refrescarse) ------------------------------------

/** La campana vio avisos nuevos: Inicio (Para mi / Esperando) vuelve a pedir sus listas al servidor. */
export const EVENTO_AVISOS_NUEVOS = 'dm:avisos-nuevos';
/** Se marcaron avisos como leidos fuera de la campana (pagina de notificaciones): la campana vuelve a contar. */
export const EVENTO_AVISOS_LEIDOS = 'dm:avisos-leidos';

export function avisarAvisosLeidos(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENTO_AVISOS_LEIDOS));
}

/** Margen para que varias copias que reciben el mismo evento a la vez compartan una sola lectura. */
export const MARGEN_ORDEN_MS = 20;

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
