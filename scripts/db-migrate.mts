/**
 * `npm run db:migrate`: aplica las migraciones de `drizzle/` (generadas + escritas a mano: triggers
 * y permisos). Paso EXPLICITO, nunca parte del `build`. En produccion lo ejecuta CI con
 * `DATABASE_URL_UNPOOLED` (URL directa) conectando como el rol `migrador` (duenio de las tablas);
 * la aplicacion usa `DATABASE_URL` con el rol `app` (D-31). Nunca `drizzle-kit push` en produccion.
 *
 * Con PGlite local: ejecutar con el servidor DETENIDO (PGlite es de un solo proceso, D-30).
 */
import { crearConexion } from '../src/db/conexion';
import { migrar } from '../src/db/migrar';
import { cargarConfig } from '../src/server/config';

const c = cargarConfig();
const url = c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL;
const conexion = crearConexion({ url, pgliteDir: c.PGLITE_DIR });
try {
  await migrar(conexion);
  console.log(`✔ Migraciones aplicadas (${conexion.tipo}${url ? '' : `: ${c.PGLITE_DIR}`}).`);
} finally {
  await conexion.cerrar();
}
