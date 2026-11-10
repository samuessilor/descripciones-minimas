/**
 * Unica guarda de permisos del servidor: toda accion o lectura de administracion pasa por `exigir`, con el nivel que
 * le toca (`supervisar`: administrador o supervisora general; `administrar`: solo el administrador, para parametros y
 * claves). Las guardas por objetivo (`exigirRolAsignable`, `exigirCuentaTocable`) limitan a la supervisora sobre las
 * cuentas de administrador y de supervisora.
 */
import { puede, puedeAsignarRol, puedeTocarCuenta, type Accion } from '@/dominio/permisos';
import { ErrorAccion } from '../acciones/resultado';
import type { Actor } from './actor';

const MENSAJE: Partial<Record<Accion, string>> = {
  supervisar: 'Esta sección es del administrador y de la supervisora general.',
  administrar: 'Esta acción es solo del administrador.',
};

export function exigir(actor: Pick<Actor, 'rol'>, accion: Accion): void {
  if (!puede(actor, accion)) throw new ErrorAccion('SIN_PERMISO', MENSAJE[accion] ?? 'No tienes permiso para hacer esto.');
}

/** Quien no es administrador no crea ni promueve administradores o supervisoras. */
export function exigirRolAsignable(actor: Pick<Actor, 'rol'>, rolNuevo: string): void {
  if (!puedeAsignarRol(actor, rolNuevo)) throw new ErrorAccion('SIN_PERMISO', 'Solo el administrador puede dar el rol de administrador o de supervisora general.');
}

/** Quien no es administrador no toca cuentas de administrador ni de supervisora. */
export function exigirCuentaTocable(actor: Pick<Actor, 'rol'>, rolCuenta: string): void {
  if (!puedeTocarCuenta(actor, rolCuenta)) throw new ErrorAccion('SIN_PERMISO', 'Las cuentas de administrador y de supervisora general solo las gestiona un administrador.');
}
