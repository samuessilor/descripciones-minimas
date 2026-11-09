/**
 * Catalogos administrables (SPEC 6.2): unidades, aspecto fisico, sugerencias de empaque, partidas y
 * restricciones. Los tipos de producto (4) son una CONSTANTE en codigo, no una tabla (D-04).
 *
 * Las descripciones minimas NO son un catalogo: la aduana las escribe en cada referencia como un campo de texto
 * (`descripciones_minimas`), igual que en el formato F-ADI-30 (DESVIACIONES, 2026-10-27).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { usuario } from './identidad';

export const catalogoItem = pgTable(
  'catalogo_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    catalogo: text('catalogo').notNull(),
    valor: text('valor').notNull(),
    orden: integer('orden').notNull().default(0),
    activo: boolean('activo').notNull().default(true),
  },
  (t) => [
    unique('catalogo_item_unico').on(t.catalogo, t.valor),
    check(
      'catalogo_item_catalogo_valido',
      sql`${t.catalogo} in ('unidad_medida','aspecto_fisico','sugerencia_empaque')`,
    ),
  ],
);

/**
 * Texto normativo de restricciones (RETIE, RAEE...) que se asocia a una partida. El nombre de la tabla
 * (`restriccion_plantilla`) viene del esquema inicial: es el catalogo de restricciones, no una plantilla de
 * preguntas, y se conserva para no renombrar una tabla con datos.
 */
export const restriccionPlantilla = pgTable('restriccion_plantilla', {
  id: uuid('id').primaryKey().defaultRandom(),
  codigo: text('codigo').notNull().unique(),
  texto: text('texto').notNull(),
  activa: boolean('activa').notNull().default(true),
});

export const partidaArancelaria = pgTable(
  'partida_arancelaria',
  {
    codigo: text('codigo').primaryKey(),
    descripcion: text('descripcion'),
    /** Restriccion que se copia a la referencia al fijar esta partida (la aduana la puede editar alli). */
    restriccionId: uuid('restriccion_id').references(() => restriccionPlantilla.id),
    origen: text('origen').notNull(),
    creadaPor: uuid('creada_por').references(() => usuario.id),
    activa: boolean('activa').notNull().default(true),
  },
  (t) => [
    check('partida_codigo_formato', sql`${t.codigo} ~ '^\\d{4}\\.\\d{2}\\.\\d{2}\\.\\d{2}$'`),
    check('partida_origen_valido', sql`${t.origen} in ('semilla','aduana')`),
  ],
);
