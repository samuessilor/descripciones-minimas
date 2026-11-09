/**
 * Cuando un guardado PROPIO se aplica en pantalla sin releer la ficha (`guardado-local.ts`), la zona de la aduana no
 * se entera: ya no tiene reloj y su resumen de cierre (campos del area que faltan, advertencia A1) se calcula en el
 * servidor. Este aviso le dice que se relea, pero SOLO cuando el guardado pudo cambiar ese resumen.
 *
 * El resumen de cierre solo depende de QUE campos obligatorios estan vacios (`evaluarCierreDeFicha`): llenar un
 * obligatorio, vaciarlo, o que un valor cambie lo que otros campos exigen (`soloSi`) mueve la lista; editar un campo
 * opcional, o retocar el texto de uno ya lleno, no la mueve. Por eso el criterio compara las listas de faltantes de
 * antes y despues en vez de reaccionar a cada guardado: una persona llenando la ficha pide una lectura por cada campo
 * que de verdad cuenta, no una por tecla guardada. Un campo que el servidor mantiene aparte (partida, tipo) ya no pasa
 * por aqui: `aplicarGuardado` devuelve `null` y la ficha entera se relee con `EVENTO_FICHA_CAMBIADA`.
 */
import type { Completitud } from '@/dominio/completitud';
import { SECCIONES } from '@/dominio/campos';

/** La zona de la aduana debe releer su vista (el resumen de cierre cambio). Lleva `{ referenciaId }`. */
export const EVENTO_CIERRE_CAMBIADO = 'dm:cierre-cambiado';

/** Espera antes de avisar: una rafaga de campos llenados seguidos pide UNA lectura de la aduana. */
export const PAUSA_AVISO_CIERRE_MS = 2_000;

/** Claves de los campos que faltan y que el cierre cuenta: los obligatorios del area (por seccion) y los de la aduana. */
function faltantes(c: Completitud): string {
  return [...SECCIONES.flatMap((s) => c.secciones[s].faltantes), '|', ...c.aduana.faltantes].join(',');
}

/** `true` si el guardado cambio algun faltante (o cuantos son): el resumen de cierre de la aduana quedo viejo. */
export function cambiaElResumenDeCierre(antes: Completitud, despues: Completitud): boolean {
  return antes.area.faltan !== despues.area.faltan || faltantes(antes) !== faltantes(despues);
}

export function avisarCierreCambiado(referenciaId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_CIERRE_CAMBIADO, { detail: { referenciaId } }));
}
