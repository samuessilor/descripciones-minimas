/**
 * `getDb()`: punto unico de acceso a la base (12.2). Funcion simple (no `Proxy`) con
 * inicializacion perezosa para no romper `next build` si faltan variables; la conexion se guarda
 * en `globalThis` para sobrevivir al HMR de desarrollo (PGlite es de un solo proceso, D-30).
 */
import { getConfig } from '@/server/config';
import { crearConexion, type Conexion } from './conexion';
import type { Db } from './tipos';

export type { Db, Tx, Ejecutor } from './tipos';
export { crearConexion, duenoDeLaBaseLocal } from './conexion';
export type { Conexion } from './conexion';

const CLAVE = Symbol.for('descripciones-minimas.conexion');
type ConGlobal = typeof globalThis & { [CLAVE]?: Conexion };

export function getConexion(): Conexion {
  const g = globalThis as ConGlobal;
  if (!g[CLAVE]) {
    const c = getConfig();
    g[CLAVE] = crearConexion({ url: c.DATABASE_URL, pgliteDir: c.PGLITE_DIR });
  }
  return g[CLAVE];
}

export function getDb(): Db {
  return getConexion().db;
}

/** Cierra y olvida la conexion (reinicios controlados de desarrollo y pruebas). */
export async function cerrarConexion(): Promise<void> {
  const g = globalThis as ConGlobal;
  const c = g[CLAVE];
  if (!c) return;
  delete g[CLAVE];
  await c.cerrar();
}
