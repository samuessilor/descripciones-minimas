-- Migracion 0003: se retiran las preguntas de la aduana y las plantillas de descripciones minimas
-- (DESVIACIONES, 2026-10-27). Las descripciones minimas pasan a ser un campo de texto de la ficha
-- (`descripciones_minimas`), que vive en `referencia.datos` y en `campo_historial` como cualquier otro
-- campo: no necesita tabla ni columna nueva.
--
-- Generada con drizzle-kit y ORDENADA A MANO: drizzle-kit borraba `dm_plantilla` con CASCADE (que ya se lleva
-- la llave foranea de `partida_arancelaria`) y despues intentaba borrar esa misma llave, lo que falla.
--
-- No toca lo inmutable: `campo_historial`, `comentario` y `texto_descartado` conservan las filas `dm:<id>`
-- que hubiera (los triggers de 0001 lo impiden y es lo correcto: el historial no se reescribe).
-- `aplicar_permisos_app()` recorre `pg_tables`, asi que sigue funcionando sin las tablas borradas.

-- 1) Datos que solo existian para las preguntas.
DELETE FROM "edicion_activa" WHERE "campo" LIKE 'dm:%';--> statement-breakpoint
UPDATE "entrega_correo"
   SET "estado" = 'abandonado', "ultimo_error" = 'Las preguntas de la aduana se retiraron de la plataforma.'
 WHERE "plantilla" IN ('pregunta', 'respuesta') AND "estado" IN ('pendiente', 'enviando', 'fallido');--> statement-breakpoint
UPDATE "entrega_correo" SET "notificacion_id" = NULL
 WHERE "notificacion_id" IN (SELECT "id" FROM "notificacion" WHERE "tipo" = 'pregunta');--> statement-breakpoint
DELETE FROM "notificacion" WHERE "tipo" = 'pregunta';--> statement-breakpoint
-- La proyeccion `datos` deja de llevar las respuestas `dm:<id>` (el historial las conserva).
UPDATE "referencia"
   SET "datos" = (SELECT COALESCE(jsonb_object_agg(e.k, e.v), '{}'::jsonb) FROM jsonb_each("referencia"."datos") AS e(k, v) WHERE e.k NOT LIKE 'dm:%')
 WHERE EXISTS (SELECT 1 FROM jsonb_object_keys("referencia"."datos") AS c(k) WHERE c.k LIKE 'dm:%');--> statement-breakpoint

-- 2) Esquema: primero la llave y la columna de la partida, despues las tablas.
ALTER TABLE "partida_arancelaria" DROP CONSTRAINT IF EXISTS "partida_arancelaria_dm_plantilla_id_dm_plantilla_id_fk";--> statement-breakpoint
ALTER TABLE "partida_arancelaria" DROP COLUMN IF EXISTS "dm_plantilla_id";--> statement-breakpoint
DROP TABLE IF EXISTS "pregunta";--> statement-breakpoint
DROP TABLE IF EXISTS "dm_plantilla_campo";--> statement-breakpoint
DROP TABLE IF EXISTS "dm_plantilla";--> statement-breakpoint
ALTER TABLE "notificacion" DROP CONSTRAINT "notificacion_tipo_valido";--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_tipo_valido" CHECK ("notificacion"."tipo" in ('asignacion','recordatorio','respuesta','clasificada','reabierta','reapertura_solicitada','cambio_en_mi_campo','comentario'));
