/**
 * Presencia de quien usa la pestana, para los sondeos. Una pestana visible pero desatendida (un PC sin bloquear de
 * noche) no debe sondear: cada sondeo despierta la base (Neon gratis se suspende solo tras 5 min sin consultas y
 * cobra horas de computo) y cuenta como actividad de la sesion, asi que la regla de 8 h de inactividad nunca vencia.
 *
 * Se considera presente si la pestana esta visible y hubo una interaccion (puntero, teclado, rueda) en los ultimos
 * 3 min. Al volver tras mas tiempo se emite `EVENTO_PRESENCIA`, para que los sondeos lean en el acto: dejar de sondear
 * pronto a quien solo mira la pantalla no le quita nada y ahorra CPU del servidor.
 */
import { OCULTA_MIN_MS, pasosDeEspera } from './sondeo';

export const INACTIVO_MS = 3 * 60_000;
export const EVENTO_PRESENCIA = 'presencia-vuelve';

let ultima = Date.now();

function marcar(): void {
  const antes = ultima;
  ultima = Date.now();
  if (ultima - antes > INACTIVO_MS) window.dispatchEvent(new Event(EVENTO_PRESENCIA));
}

if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(ev, marcar, { passive: true, capture: true });
  }
}

/** La pestana esta visible y alguien la uso hace poco: se puede sondear. */
export function presente(): boolean {
  return document.visibilityState === 'visible' && Date.now() - ultima < INACTIVO_MS;
}

/** Milisegundos desde el ultimo gesto de la persona (puntero, teclado, rueda). */
export function msSinGesto(): number {
  return Date.now() - ultima;
}

/**
 * Sondeo por reloj con backoff: llama a `tic` cada `baseMs` mientras la pestana esta en uso (`presente()`). Si `tic`
 * devuelve `true` hubo cambios; con varios tics seguidos sin cambios y sin gestos recientes se dejan pasar pasos del
 * intervalo (ver `pasosDeEspera`), y al primer gesto o cambio vuelve al ritmo base. Devuelve la funcion que lo detiene.
 */
export function sondearConBackoff(baseMs: number, tic: () => boolean | void | Promise<boolean | void>): () => void {
  let sinCambio = 0;
  let saltados = 0;
  const t = setInterval(() => {
    if (!presente()) return;
    if (saltados + 1 < pasosDeEspera(baseMs, sinCambio, msSinGesto())) {
      saltados += 1;
      return;
    }
    saltados = 0;
    // Un tic que falla no cuenta como «sin cambios»: no hay informacion para espaciar.
    void Promise.resolve()
      .then(tic)
      .then((cambio) => {
        sinCambio = cambio === true ? 0 : sinCambio + 1;
      })
      .catch(() => undefined);
  }, baseMs);
  return () => clearInterval(t);
}

/**
 * Avisa al volver a una pestana que estuvo oculta MAS de `OCULTA_MIN_MS`: cambiar de pestana un instante no debe
 * relanzar las lecturas de la pantalla. Devuelve la funcion que deja de escuchar.
 */
export function alVolverDePestana(cb: () => void, minOcultaMs: number = OCULTA_MIN_MS): () => void {
  let desde: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
  const alCambiar = () => {
    if (document.visibilityState === 'hidden') {
      desde ??= Date.now();
      return;
    }
    const fuera = desde === null ? 0 : Date.now() - desde;
    desde = null;
    if (fuera > minOcultaMs) cb();
  };
  document.addEventListener('visibilitychange', alCambiar);
  return () => document.removeEventListener('visibilitychange', alCambiar);
}
