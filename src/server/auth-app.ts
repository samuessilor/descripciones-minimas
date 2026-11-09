/**
 * Cableado de la aplicacion (Next): instancia unica de Better Auth y dependencias del flujo de acceso.
 * Se guarda en `globalThis` para sobrevivir al HMR de desarrollo.
 */
import { getDb } from '@/db';
import { crearAuth, type Auth } from './auth';
import { getConfig } from './config';
import type { DepsAcceso } from './acceso';

const CLAVE = Symbol.for('descripciones-minimas.auth');
type ConGlobal = typeof globalThis & { [CLAVE]?: Auth };

export function getAuth(): Auth {
  const g = globalThis as ConGlobal;
  g[CLAVE] ??= crearAuth({ db: getDb(), config: getConfig() });
  return g[CLAVE];
}

export function getDepsAcceso(): DepsAcceso {
  return { db: getDb(), auth: getAuth(), config: getConfig() };
}
