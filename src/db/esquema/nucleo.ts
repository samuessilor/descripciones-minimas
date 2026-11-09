/**
 * Nucleo (SPEC 6.2): la referencia, su historial inmutable por campo, adjuntos, comentarios, texto
 * descartado y presencia de edicion.
 *
 * `campo_historial`, `comentario` y `texto_descartado` son APPEND-ONLY (D-31): la migracion
 * escrita a mano les pone el trigger `rechazar_cambio` y revoca permisos al rol `app`.
 * `referencia.datos` es una PROYECCION mutable: solo `aplicarEscritura()` la toca (6.4).
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  bigserial,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organizacion, usuario } from './identidad';

/**
 * jsonb "crudo" para valores JSON de CUALQUIER tipo. Con la columna `jsonb()` de Drizzle, un valor
 * de nivel superior que sea una cadena (p. ej. el valor unitario `"12.5"`) vuelve del controlador
 * ya parseado y Drizzle lo parsea OTRA vez (`"12.5"` -> `12.5`, `"true"` -> `true`): el historial
 * cambiaria de tipo al leerlo. Verificado con PGlite 0.5.11 y drizzle-orm 0.45.4; `pg` y Neon hacen
 * lo mismo. Este tipo escribe JSON.stringify y lee lo que entrega el controlador, sin reparsear.
 */
export const jsonbValor = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'jsonb';
  },
  toDriver(valor) {
    return JSON.stringify(valor);
  },
  fromDriver(valor) {
    return valor;
  },
});

/** Entrada de la proyeccion `datos`: valor, version del campo, autor, organizacion, instante. */
export interface EntradaDatos {
  v: unknown;
  n: number;
  a: string;
  o: string;
  t: string;
}
export type Datos = Record<string, EntradaDatos>;

export const referencia = pgTable(
  'referencia',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    codigo: text('codigo').notNull(),
    /** Mayusculas y sin espacios, guiones, puntos, barras ni guiones bajos (D-27). */
    codigoNorm: text('codigo_norm').notNull(),
    nombreProducto: text('nombre_producto').notNull(),
    tipoProducto: text('tipo_producto').notNull(),
    fechaSolicitud: date('fecha_solicitud', { mode: 'string' })
      .notNull()
      .default(sql`((now() at time zone 'America/Bogota')::date)`),
    /** Promovida desde `datos` para listar y buscar. */
    partida: text('partida'),
    estado: text('estado').notNull().default('BORRADOR'),
    clasificadaEn: timestamp('clasificada_en', { withTimezone: true }),
    clasificadaPor: uuid('clasificada_por').references(() => usuario.id),
    /** Dias calendario que estuvo CLASIFICADA y se reabrio (6.3, RV-32). */
    diasPausa: integer('dias_pausa').notNull().default(0),
    datos: jsonb('datos').$type<Datos>().notNull().default({}),
    /** Sube con cada escritura (para el polling de `estadoFicha`). */
    version: integer('version').notNull().default(1),
    textoBusqueda: text('texto_busqueda').notNull().default(''),
    creadaPor: uuid('creada_por')
      .notNull()
      .references(() => usuario.id),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    actualizadaEn: timestamp('actualizada_en', { withTimezone: true }).notNull().defaultNow(),
    archivadaEn: timestamp('archivada_en', { withTimezone: true }),
    archivadaPor: uuid('archivada_por').references(() => usuario.id),
    motivoArchivo: text('motivo_archivo'),
    estadoPrevioArchivo: text('estado_previo_archivo'),
  },
  (t) => [
    // TOTAL, no parcial: archivar NO libera el codigo (C-14, RV-10).
    uniqueIndex('referencia_codigo_norm_unico').on(t.codigoNorm),
    index('referencia_estado_idx').on(t.estado),
    index('referencia_tipo_idx').on(t.tipoProducto),
    index('referencia_creada_idx').on(sql`${t.creadaEn} desc`, t.id),
    index('referencia_partida_idx').on(t.partida),
    check('referencia_tipo_valido', sql`${t.tipoProducto} in ('INSUMO','REPUESTO','EQUIPO','ACCESORIO','MONTURA')`),
    check('referencia_estado_valido', sql`${t.estado} in ('BORRADOR','EN_GESTION','CLASIFICADA')`),
    check(
      'referencia_estado_previo_valido',
      sql`${t.estadoPrevioArchivo} is null or ${t.estadoPrevioArchivo} in ('BORRADOR','EN_GESTION','CLASIFICADA')`,
    ),
    check('referencia_dias_pausa_no_negativo', sql`${t.diasPausa} >= 0`),
  ],
);

export const campoHistorial = pgTable(
  'campo_historial',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    /** Clave del campo: 'uso', 'partida_arancelaria', 'descripciones_minimas', ... */
    campo: text('campo').notNull(),
    /** 1, 2, 3 por (referencia, campo). */
    versionCampo: integer('version_campo').notNull(),
    tipoEvento: text('tipo_evento').notNull(),
    valor: jsonbValor('valor'),
    restauraId: bigint('restaura_id', { mode: 'number' }).references((): AnyPgColumn => campoHistorial.id),
    baseVersion: integer('base_version'),
    /** Obligatorio al reemplazar/vaciar/restaurar sobre valor de otro autor (9.3, 9.5, 9.6). */
    motivo: text('motivo'),
    autorId: uuid('autor_id')
      .notNull()
      .references(() => usuario.id),
    rol: text('rol').notNull(),
    organizacionId: uuid('organizacion_id')
      .notNull()
      .references(() => organizacion.id),
    origen: text('origen').notNull().default('web'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('campo_historial_version_unica').on(t.referenciaId, t.campo, t.versionCampo),
    check('campo_historial_evento_valido', sql`${t.tipoEvento} in ('fijar','vaciar','restaurar','sistema')`),
    check('campo_historial_origen_valido', sql`${t.origen} in ('web','sistema')`),
    check('campo_historial_version_positiva', sql`${t.versionCampo} >= 1`),
  ],
);

export const adjunto = pgTable(
  'adjunto',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    tipo: text('tipo').notNull().default('foto'),
    nombreOriginal: text('nombre_original').notNull(),
    mime: text('mime').notNull(),
    tamanoBytes: integer('tamano_bytes').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
    storageKey: text('storage_key').notNull(),
    subidoPor: uuid('subido_por')
      .notNull()
      .references(() => usuario.id),
    subidoEn: timestamp('subido_en', { withTimezone: true }).notNull().defaultNow(),
    retiradoEn: timestamp('retirado_en', { withTimezone: true }),
    retiradoPor: uuid('retirado_por').references(() => usuario.id),
    motivoRetiro: text('motivo_retiro'),
  },
  (t) => [
    index('adjunto_referencia_idx').on(t.referenciaId),
    check('adjunto_mime_valido', sql`${t.mime} in ('image/jpeg','image/png','image/webp')`),
  ],
);

export const comentario = pgTable(
  'comentario',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    campo: text('campo'),
    autorId: uuid('autor_id')
      .notNull()
      .references(() => usuario.id),
    texto: text('texto').notNull(),
    /** 'interno' lo ven solo usuarios de organizacion interna (RV-29). */
    visibilidad: text('visibilidad').notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comentario_referencia_idx').on(t.referenciaId, t.creadoEn),
    check('comentario_visibilidad_valida', sql`${t.visibilidad} in ('interno','todos')`),
  ],
);

export const textoDescartado = pgTable(
  'texto_descartado',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    campo: text('campo').notNull(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    texto: text('texto').notNull(),
    motivoDescarte: text('motivo_descarte').notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('texto_descartado_ref_campo_idx').on(t.referenciaId, t.campo),
    check('texto_descartado_motivo_valido', sql`${t.motivoDescarte} in ('conflicto_dejar_el_otro')`),
  ],
);

export const edicionActiva = pgTable(
  'edicion_activa',
  {
    referenciaId: uuid('referencia_id')
      .notNull()
      .references(() => referencia.id),
    campo: text('campo').notNull(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuario.id),
    hasta: timestamp('hasta', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.referenciaId, t.campo, t.usuarioId] })],
);
