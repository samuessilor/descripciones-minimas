/**
 * Aplica las migraciones SQL de `drizzle/` (generadas + escritas a mano: triggers, permisos).
 * Paso EXPLICITO (`npm run db:migrate` o el arranque en desarrollo), nunca en el `build`.
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Conexion } from './conexion';

export async function migrar(c: Conexion, carpeta = resolve(process.cwd(), 'drizzle')): Promise<void> {
  const db = c.db as never;
  switch (c.tipo) {
    case 'pglite': {
      const { migrate } = await import('drizzle-orm/pglite/migrator');
      await migrate(db, { migrationsFolder: carpeta });
      break;
    }
    case 'neon': {
      const { migrate } = await import('drizzle-orm/neon-serverless/migrator');
      await migrate(db, { migrationsFolder: carpeta });
      break;
    }
    case 'pg': {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(db, { migrationsFolder: carpeta });
      break;
    }
  }
  // Tablas nuevas de migraciones posteriores quedan cubiertas por los permisos de `app` (no-op si no existe).
  await c.db.execute(sql`select public.aplicar_permisos_app()`);
}
