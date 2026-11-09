/** Auditoria (append-only, mismo trigger de inmutabilidad) y limite de tasa (SPEC 6.2, 13.3, 13.6). */
import { index, integer, jsonb, pgTable, primaryKey, bigserial, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { usuario } from './identidad';

export const auditoria = pgTable(
  'auditoria',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** Nulo cuando no hay usuario (p. ej. login fallido de un correo desconocido). */
    usuarioId: uuid('usuario_id').references(() => usuario.id),
    accion: text('accion').notNull(),
    entidad: text('entidad').notNull(),
    entidadId: text('entidad_id').notNull(),
    detalle: jsonb('detalle').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auditoria_entidad_idx').on(t.entidad, t.entidadId)],
);

export const limiteTasa = pgTable(
  'limite_tasa',
  {
    clave: text('clave').notNull(),
    ventana: timestamp('ventana', { withTimezone: true }).notNull(),
    contador: integer('contador').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.clave, t.ventana] })],
);
