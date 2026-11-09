import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as esquema from './esquema';

/** Base de datos de Drizzle comun a PGlite, Neon (Pool) y `pg`. */
export type Db = PgDatabase<PgQueryResultHKT, typeof esquema>;

/** Transaccion interactiva (mismo API que `Db`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Algo sobre lo que se puede consultar: la base o una transaccion. */
export type Ejecutor = Db | Tx;
