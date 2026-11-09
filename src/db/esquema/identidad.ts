/**
 * Identidad (SPEC 6.2): organizaciones, usuarios y las tablas que genera Better Auth
 * (`session`, `account`, `verification`). `usuario` ES la tabla de usuario de Better Auth, con
 * campos extra y nombres en espanol (13.1: `user.modelName` / `user.fields`).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export const organizacion = pgTable(
  'organizacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull().unique(),
    tipo: text('tipo').notNull(),
    activa: boolean('activa').notNull().default(true),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('organizacion_tipo_valido', sql`${t.tipo} in ('interna','agencia')`),
    // Necesaria para la clave foranea compuesta de `usuario` (D-28).
    unique('organizacion_id_tipo_unico').on(t.id, t.tipo),
  ],
);

export const usuario = pgTable(
  'usuario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    /** Guardado en minusculas (check `usuario_email_minusculas`). */
    email: text('email').notNull(),
    emailVerificado: boolean('email_verificado').notNull().default(false),
    imagen: text('imagen'),
    organizacionId: uuid('organizacion_id').notNull(),
    /** Denormalizado para imponer D-28 en la base (clave foranea compuesta + CHECK). */
    organizacionTipo: text('organizacion_tipo').notNull(),
    rol: text('rol').notNull(),
    area: text('area'),
    activo: boolean('activo').notNull().default(true),
    /** MVP: lo marca el admin a mano; automatico en V1 con el webhook de rebotes (14). */
    correoInvalido: boolean('correo_invalido').notNull().default(false),
    preferenciaAviso: text('preferencia_aviso').notNull().default('inmediato'),
    /** Permite desactivar el atajo "/" (WCAG 2.1.4, RV-42). */
    atajosTeclado: boolean('atajos_teclado').notNull().default(true),
    ultimoIngreso: timestamp('ultimo_ingreso', { withTimezone: true }),
    creadoPor: uuid('creado_por').references((): AnyPgColumn => usuario.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('usuario_email_unico').on(sql`lower(${t.email})`),
    foreignKey({
      name: 'usuario_organizacion_fk',
      columns: [t.organizacionId, t.organizacionTipo],
      foreignColumns: [organizacion.id, organizacion.tipo],
    }),
    check('usuario_rol_valido', sql`${t.rol} in ('admin','solicitante','aduana','lector')`),
    check('usuario_preferencia_valida', sql`${t.preferenciaAviso} in ('inmediato','solo_bandeja')`),
    check('usuario_email_minusculas', sql`${t.email} = lower(${t.email})`),
    // D-28: una agencia solo admite el rol `aduana`.
    check('usuario_agencia_solo_aduana', sql`${t.organizacionTipo} <> 'agencia' or ${t.rol} = 'aduana'`),
    index('usuario_organizacion_idx').on(t.organizacionId),
  ],
);

// ---- Tablas de Better Auth (nombres de tabla de la documentacion; columnas en snake_case) ------

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    /** Para el limite de inactividad por rol (13.1, D-36); se actualiza como mucho cada minuto. */
    ultimaActividad: timestamp('ultima_actividad', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
