/**
 * Presencia de quien usa la pestana, para los sondeos. Una pestana visible pero desatendida (un PC sin bloquear de
 * noche) no debe sondear: cada sondeo despierta la base (Neon gratis se suspende solo tras 5 min sin consultas y
 * cobra horas de computo) y cuenta como actividad de la sesion, asi que la regla de 8 h de inactividad nunca vencia.
 *
 * Se considera presente si la pestana esta visible y hubo una interaccion (puntero, teclado, rueda) en los ultimos
 * 3 min. Al volver tras mas tiempo se emite `EVENTO_PRESENCIA`, para que los sondeos lean en el acto: dejar de sondear
 * pronto a quien solo mira la pantalla no le quita nada y ahorra CPU del servidor.
 */
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
