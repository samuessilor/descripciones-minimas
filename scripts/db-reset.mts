/**
 * `npm run db:reset`: BORRA la base LOCAL (PGlite) y la recrea con migraciones y semillas.
 * Solo desarrollo, con el servidor DETENIDO (si esta en marcha, usa POST /api/dev/reset).
 * Se niega a tocar una base remota.
 */
import { crearConexion } from '../src/db/conexion';
import { reiniciarBase } from '../src/server/preparar-bd';
import { cargarConfig } from '../src/server/config';

const c = cargarConfig();
if (c.DATABASE_URL || c.NODE_ENV === 'production') {
  console.error('db:reset solo se permite sobre la base local de desarrollo (sin DATABASE_URL).');
  process.exit(1);
}
const sinDesarrollo = process.argv.includes('--sin-datos-de-desarrollo');
const sinEjemplos = process.argv.includes('--sin-ejemplos');
const conexion = crearConexion({ pgliteDir: c.PGLITE_DIR });
try {
  await reiniciarBase(conexion, { desarrollo: !sinDesarrollo, ejemplos: !sinEjemplos });
  console.log(`✔ Base local reiniciada (${sinDesarrollo ? 'solo datos maestros' : sinEjemplos ? 'con usuarios y 3 referencias de desarrollo' : 'con usuarios y 15 referencias de ejemplo'}).`);
} finally {
  await conexion.cerrar();
}
