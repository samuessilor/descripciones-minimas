/**
 * Conexion a la base: PGlite (local, sin credenciales), Neon (produccion) o `pg` (otro Postgres).
 * Los tres exponen la misma interfaz de Drizzle; el SQL es identico (D-18).
 *
 * PGlite es de UN SOLO PROCESO (D-30): dos procesos sobre el mismo directorio no comparten estado
 * y arriesgan corrupcion. Por eso se guarda un archivo de bloqueo con el PID del dueno y los
 * scripts (`seed`, `db-reset`, `db-migrate`) se niegan a abrir la base mientras el servidor vive.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { Pool as NeonPool } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import * as esquema from './esquema';

export type Esquema = typeof esquema;
export type { Db, Tx } from './tipos';
import type { Db } from './tipos';

export type TipoConexion = 'pglite' | 'neon' | 'pg';

export interface Conexion {
  tipo: TipoConexion;
  db: Db;
  cerrar(): Promise<void>;
}

export interface OpcionesConexion {
  /** URL de Postgres. Vacia => PGlite. */
  url?: string | undefined;
  /** Directorio de PGlite; `memory://` para pruebas. */
  pgliteDir?: string;
  /** Fuerza el controlador (por defecto: neon si el host es de neon.tech, si no `pg`). */
  controlador?: 'neon' | 'pg';
}

// ---- Bloqueo de PGlite local -------------------------------------------------------------------

function procesoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Ruta absoluta; el comentario evita que Turbopack trace todo el proyecto por este acceso dinamico. */
const absoluta = (p: string): string => resolve(/*turbopackIgnore: true*/ p);

function archivoBloqueo(dir: string): string {
  return resolve(/*turbopackIgnore: true*/ dirname(absoluta(dir)), 'pglite.lock');
}

/** Devuelve el PID que tiene la base local abierta (distinto del actual), o null. */
export function duenoDeLaBaseLocal(dir: string): number | null {
  const f = archivoBloqueo(dir);
  if (!existsSync(f)) return null;
  const pid = Number.parseInt(readFileSync(f, 'utf8').trim(), 10);
  if (!Number.isFinite(pid) || pid === process.pid) return null;
  return procesoVivo(pid) ? pid : null;
}

function tomarBloqueo(dir: string): () => void {
  const f = archivoBloqueo(dir);
  const dueno = duenoDeLaBaseLocal(dir);
  if (dueno !== null) {
    throw new Error(
      `La base local (${dir}) ya está abierta por otro proceso (PID ${dueno}). PGlite es de un solo proceso: ` +
        'detén el servidor o usa los endpoints /api/dev/*. Si el proceso ya no existe, borra ' +
        `${f}.`,
    );
  }
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, String(process.pid));
  let liberado = false;
  const liberar = () => {
    if (liberado) return;
    liberado = true;
    try {
      if (existsSync(f) && readFileSync(f, 'utf8').trim() === String(process.pid)) rmSync(f);
    } catch {
      /* mejor esfuerzo */
    }
  };
  process.once('exit', liberar);
  return liberar;
}

// ---- Fabrica ------------------------------------------------------------------------------------

export function crearConexion(opciones: OpcionesConexion = {}): Conexion {
  const url = opciones.url?.trim();

  if (!url) {
    const dir = opciones.pgliteDir ?? '.data/pglite';
    const enMemoria = dir.startsWith('memory://');
    let liberar: (() => void) | undefined;
    if (!enMemoria) {
      mkdirSync(dirname(absoluta(dir)), { recursive: true }); // PGlite no crea directorios padre (22.5)
      liberar = tomarBloqueo(dir);
    }
    const cliente = new PGlite(dir);
    const db = drizzlePglite(cliente, { schema: esquema }) as unknown as Db;
    return {
      tipo: 'pglite',
      db,
      async cerrar() {
        try {
          await cliente.close();
        } finally {
          liberar?.();
        }
      },
    };
  }

  const esNeon = opciones.controlador ? opciones.controlador === 'neon' : /\.neon\.tech/i.test(url);
  // Si el servidor corta una conexion inactiva el pool la descarta y emite 'error': sin listener seria una excepcion
  // no controlada. La siguiente consulta abre otra conexion, asi que basta con dejarlo en el log.
  const alCaerConexion = (e: Error) => console.error('[db] se cerro una conexion inactiva del pool:', e.message);
  if (esNeon) {
    const pool = new NeonPool({ connectionString: url });
    pool.on('error', alCaerConexion);
    const db = drizzleNeon(pool, { schema: esquema }) as unknown as Db;
    return { tipo: 'neon', db, cerrar: () => pool.end() };
  }
  const pool = new PgPool({ connectionString: url });
  pool.on('error', alCaerConexion);
  const db = drizzlePg(pool, { schema: esquema }) as unknown as Db;
  return { tipo: 'pg', db, cerrar: () => pool.end() };
}
