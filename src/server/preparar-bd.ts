/**
 * Preparacion de la base LOCAL (PGlite). Como PGlite es de un solo proceso (D-30), el servidor de
 * desarrollo es quien migra y siembra al arrancar; los scripts `db-migrate`, `seed` y `db-reset`
 * hacen lo mismo con el servidor detenido, y `/api/dev/{seed,reset}` con el servidor en marcha.
 */
import { sql } from 'drizzle-orm';
import { getConexion } from '@/db';
import type { Conexion } from '@/db/conexion';
import { migrar } from '@/db/migrar';
import { sembrarTodo } from './semillas';

export async function prepararBase(c: Conexion = getConexion(), opciones: { desarrollo: boolean; ejemplos?: boolean }): Promise<void> {
  await migrar(c);
  await sembrarTodo(c.db, { desarrollo: opciones.desarrollo, ...(opciones.ejemplos === undefined ? {} : { ejemplos: opciones.ejemplos }) });
}

/** Borra TODO (esquema `public` y registro de migraciones) y vuelve a migrar y sembrar. Solo local/desarrollo. */
export async function reiniciarBase(c: Conexion = getConexion(), opciones: { desarrollo: boolean; ejemplos?: boolean }): Promise<void> {
  if (c.tipo !== 'pglite') throw new Error('El reinicio solo se permite sobre la base local (PGlite).');
  await c.db.execute(sql`drop schema if exists public cascade`);
  await c.db.execute(sql`drop schema if exists drizzle cascade`);
  await c.db.execute(sql`create schema public`);
  await prepararBase(c, opciones);
}
