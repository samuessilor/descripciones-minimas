/**
 * `npm run seed`: carga datos maestros (siempre) y, en desarrollo, usuarios y referencias de ejemplo.
 * Con PGlite local: servidor DETENIDO (o POST /api/dev/seed). Las semillas de desarrollo estan
 * marcadas `[DESARROLLO]` y nunca se cargan con NODE_ENV=production.
 */
import { crearConexion } from '../src/db/conexion';
import { cargarConfig } from '../src/server/config';
import { sembrarTodo } from '../src/server/semillas';

const c = cargarConfig();
const soloMaestros = process.argv.includes('--solo-maestros') || c.NODE_ENV === 'production';
const conexion = crearConexion({ url: c.DATABASE_URL, pgliteDir: c.PGLITE_DIR });
try {
  await sembrarTodo(conexion.db, { desarrollo: !soloMaestros, ejemplos: !process.argv.includes('--sin-ejemplos') });
  console.log(`✔ Semillas cargadas (${soloMaestros ? 'solo datos maestros' : 'maestros + desarrollo'}).`);
} finally {
  await conexion.cerrar();
}
