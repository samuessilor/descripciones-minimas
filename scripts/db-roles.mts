/**
 * `npm run db:roles`: crea los DOS roles de produccion en un Postgres comun (SPEC 6.2, D-31, RV-12):
 *   - `migrador`: duenio de las tablas; lo usa solo CI con la URL directa;
 *   - `app`: NO duenio; la `DATABASE_URL` de la aplicacion.
 * Requiere una URL de administrador (`DATABASE_URL_ADMIN`) y las claves `DB_CLAVE_MIGRADOR` /
 * `DB_CLAVE_APP`. Despues: `db:migrate` como migrador (aplica los permisos de `app` solo).
 *
 * NEON: los roles se crean desde la consola/API de Neon (la integracion de Marketplace debe permitir
 * un rol `app` no duenio y apuntar `DATABASE_URL` a el; verificar al instalar, 22.5). Este script
 * sirve para Postgres propio, el servicio de CI y la rama de pruebas.
 * PGLITE: no tiene roles reales (corre como superusuario); aqui solo se prueba el trigger.
 */
import pg from 'pg';

const admin = process.env.DATABASE_URL_ADMIN;
const claveMigrador = process.env.DB_CLAVE_MIGRADOR;
const claveApp = process.env.DB_CLAVE_APP;
if (!admin || !claveMigrador || !claveApp) {
  console.error('Define DATABASE_URL_ADMIN, DB_CLAVE_MIGRADOR y DB_CLAVE_APP.');
  process.exit(1);
}

const cliente = new pg.Client({ connectionString: admin });
await cliente.connect();
try {
  const bd = ((await cliente.query('select current_database() as bd')).rows[0] as { bd: string }).bd;
  const crear = async (rol: string, clave: string) => {
    const existe = (await cliente.query('select 1 from pg_roles where rolname = $1', [rol])).rowCount ?? 0;
    const literal = clave.replace(/'/g, "''");
    await cliente.query(existe ? `alter role ${rol} login password '${literal}'` : `create role ${rol} login password '${literal}'`);
  };
  await crear('migrador', claveMigrador);
  await crear('app', claveApp);
  await cliente.query(`grant connect on database "${bd}" to migrador, app`);
  await cliente.query('grant usage, create on schema public to migrador');
  await cliente.query('revoke create on schema public from app');
  console.log(`✔ Roles migrador y app listos en ${bd}. Ahora: DATABASE_URL_UNPOOLED=<migrador> npm run db:migrate`);
} finally {
  await cliente.end();
}
