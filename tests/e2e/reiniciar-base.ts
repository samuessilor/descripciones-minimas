/**
 * Arranque de la corrida E2E: deja la base local de desarrollo como recien sembrada con la semilla MINIMA
 * (`POST /api/dev/reset?ejemplos=0`: sin las 12 referencias EJ-*, que cambiarian los conteos que esperan las pruebas), para que
 * las pruebas no dependan de lo que dejo una corrida anterior (por ejemplo, el choque de edicion del CA-14 necesita
 * el campo «Proveedor» de TEST-0003 vacio). Con `E2E_FICHA` (reutilizar una ficha ya llenada) o `E2E_SIN_REINICIO=1`
 * no toca nada.
 */
import type { FullConfig } from '@playwright/test';

export default async function reiniciarBase(config: FullConfig): Promise<void> {
  if (process.env.E2E_FICHA || process.env.E2E_SIN_REINICIO === '1') return;
  const base = config.projects[0]?.use.baseURL ?? process.env.E2E_URL ?? `http://localhost:${process.env.E2E_PUERTO ?? 3010}`;
  let ultimo = '';
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const r = await fetch(`${base}/api/dev/reset?ejemplos=0`, { method: 'POST', signal: AbortSignal.timeout(180_000) });
      if (r.ok) return;
      ultimo = `${r.status}`;
    } catch (e) {
      ultimo = (e as Error).message;
    }
  }
  throw new Error(`No se pudo reiniciar la base de desarrollo antes de las pruebas (${ultimo}).`);
}
