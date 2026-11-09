/**
 * Condicion SQL de que eventos de `campo_historial` ve el actor. Es la version en consulta de
 * `eventoDeHistorialVisible` (dominio/permisos.ts): una pasada de pruebas las cruza. Un usuario de agencia solo ve los
 * eventos de los campos del grupo aduana hechos por SU organizacion; el resto de los roles no tiene restriccion.
 * Se aplica en SQL (no al pintar) para que la paginacion, el filtro por campo y la hoja Historial del Excel no
 * cuenten ni revelen lo que no se ve.
 */
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { campoHistorial } from '@/db/esquema';
import { CLAVES_HISTORIAL_ADUANA, historialLimitado } from '@/dominio/permisos';
import type { Actor } from './actor';

/** `undefined` si el actor ve todo el historial (se puede pasar tal cual a `and(...)`). */
export function condicionHistorialVisible(actor: Actor): SQL | undefined {
  if (!historialLimitado(actor)) return undefined;
  return and(inArray(campoHistorial.campo, [...CLAVES_HISTORIAL_ADUANA]), eq(campoHistorial.organizacionId, actor.organizacionId));
}
