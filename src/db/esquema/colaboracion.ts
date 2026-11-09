/**
 * Colaboracion y avisos (SPEC 6.2, 8.3, 14): asignaciones y bandeja de avisos (campana y «Para mi»).
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { usuario } from './identidad';
import { referencia } from './nucleo';

export const asignacion = pgTable(
  'asignacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    deUsuarioId: uuid('de_usuario_id')
      .notNull()
      .references(() => usuario.id),
    aUsuarioId: uuid('a_usuario_id')
      .notNull()
      .references(() => usuario.id),
    pedido: text('pedido'),
    mensaje: text('mensaje'),
    /** Partes de la ficha que se le dejan pendientes («producto,detalle»). Nulo = toda su parte (area: las tres secciones; aduana: el bloque de la aduana). */
    secciones: text('secciones'),
    estado: text('estado').notNull().default('pendiente'),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    vistaEn: timestamp('vista_en', { withTimezone: true }),
    completadaEn: timestamp('completada_en', { withTimezone: true }),
    nRecordatorios: integer('n_recordatorios').notNull().default(0),
    ultimoRecordatorioEn: timestamp('ultimo_recordatorio_en', { withTimezone: true }),
    /** Agencias: hasta cuando conserva acceso una asignacion ya terminada (8.3 regla 10). */
    accesoHasta: timestamp('acceso_hasta', { withTimezone: true }),
  },
  (t) => [
    // A lo sumo una asignacion activa por (ficha, destinatario) (8.3 regla 4).
    uniqueIndex('asignacion_activa_unica')
      .on(t.referenciaId, t.aUsuarioId)
      .where(sql`${t.estado} in ('pendiente','en_curso')`),
    index('asignacion_destinatario_idx').on(t.aUsuarioId, t.estado),
    index('asignacion_referencia_idx').on(t.referenciaId),
    check('asignacion_pedido_valido', sql`${t.pedido} is null or ${t.pedido} in ('completar','clasificar','responder','revisar')`),
    check(
      'asignacion_estado_valido',
      sql`${t.estado} in ('pendiente','en_curso','hecha','reasignada','cancelada')`,
    ),
  ],
);

export const notificacion = pgTable(
  'notificacion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    tipo: text('tipo').notNull(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    asignacionId: uuid('asignacion_id').references(() => asignacion.id),
    titulo: text('titulo').notNull(),
    leidaEn: timestamp('leida_en', { withTimezone: true }),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notificacion_usuario_idx').on(t.usuarioId, t.leidaEn),
    index('notificacion_referencia_idx').on(t.referenciaId),
    check(
      'notificacion_tipo_valido',
      sql`${t.tipo} in ('asignacion','recordatorio','respuesta','clasificada','reabierta','reapertura_solicitada','cambio_en_mi_campo','comentario')`,
    ),
  ],
);
