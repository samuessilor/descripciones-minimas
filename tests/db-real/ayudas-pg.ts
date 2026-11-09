/**
 * Postgres REAL para el job `db-real` (SPEC 17.1, RV-24): dos conexiones reales, rol `migrador`
 * (duenio) y rol `app` (no duenio). Dos modos:
 *  - `DATABASE_URL_TEST_ADMIN` (CI: servicio Postgres de GitHub Actions o una rama de Neon): se
 *    conecta como superusuario, crea una base nueva y los roles;
 *  - sin esa variable (local): levanta un Postgres embebido (`embedded-postgres`, devDependency) en
 *    un directorio temporal y un puerto libre. No instala nada global ni usa Docker.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { crearConexion, type Conexion } from '@/db/conexion';
import { migrar } from '@/db/migrar';
import { sembrarDatosMaestros } from '@/db/semillas/datos-maestros';

export interface PgReal {
  /** Conexion como `migrador` (duenio de las tablas). */
  migrador: Conexion;
  /** Conexion como `app` (NO duenio): la que usa la aplicacion. */
  app: Conexion;
  urlMigrador: string;
  urlApp: string;
  version: string;
  modo: 'embebido' | 'externo';
  detener(): Promise<void>;
}

const CLAVE_MIGRADOR = 'clave-migrador-solo-pruebas';
const CLAVE_APP = 'clave-app-solo-pruebas';

function puertoLibre(): Promise<number> {
  return new Promise((resolver, rechazar) => {
    const srv = createServer();
    srv.once('error', rechazar);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolver(port));
    });
  });
}

async function crearRolesYBase(admin: pg.Client, nombreBd: string): Promise<void> {
  const existe = async (rol: string) => (await admin.query('select 1 from pg_roles where rolname = $1', [rol])).rowCount! > 0;
  if (!(await existe('migrador'))) await admin.query(`create role migrador login password '${CLAVE_MIGRADOR}'`);
  if (!(await existe('app'))) await admin.query(`create role app login password '${CLAVE_APP}'`);
  await admin.query(`create database ${nombreBd} owner migrador`);
}

export async function iniciarPgReal(): Promise<PgReal> {
  const nombreBd = `dm_${Date.now().toString(36)}`;
  let detenerServidor: () => Promise<void> = async () => {};
  let hostPuerto: string;
  let admin: pg.Client;
  let modo: PgReal['modo'];

  const externa = process.env.DATABASE_URL_TEST_ADMIN;
  if (externa) {
    modo = 'externo';
    admin = new pg.Client({ connectionString: externa });
    await admin.connect();
    const u = new URL(externa);
    hostPuerto = `${u.hostname}:${u.port || '5432'}`;
  } else {
    modo = 'embebido';
    const dir = mkdtempSync(join(tmpdir(), 'dm-pg-'));
    const puerto = await puertoLibre();
    const servidor = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password: 'postgres',
      port: puerto,
      persistent: false,
      onLog: () => {},
      onError: () => {},
    });
    await servidor.initialise();
    await servidor.start();
    detenerServidor = async () => {
      await servidor.stop().catch(() => {});
      // En Windows los archivos de Postgres tardan un instante en liberarse tras detenerlo: se reintenta.
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch {
        /* un directorio temporal que no se pudo borrar no debe tumbar la prueba */
      }
    };
    admin = servidor.getPgClient('postgres');
    await admin.connect();
    hostPuerto = `127.0.0.1:${puerto}`;
  }

  await crearRolesYBase(admin, nombreBd);
  const version = ((await admin.query('show server_version')).rows[0] as { server_version: string }).server_version;

  const urlMigrador = `postgres://migrador:${CLAVE_MIGRADOR}@${hostPuerto}/${nombreBd}`;
  const urlApp = `postgres://app:${CLAVE_APP}@${hostPuerto}/${nombreBd}`;
  const migrador = crearConexion({ url: urlMigrador, controlador: 'pg' });
  await migrar(migrador); // como migrador: crea todo, y aplicar_permisos_app() otorga lo justo a `app`
  await sembrarDatosMaestros(migrador.db);
  const app = crearConexion({ url: urlApp, controlador: 'pg' });

  return {
    migrador,
    app,
    urlMigrador,
    urlApp,
    version,
    modo,
    async detener() {
      await app.cerrar().catch(() => {});
      await migrador.cerrar().catch(() => {});
      await admin.end().catch(() => {});
      await detenerServidor();
    },
  };
}
