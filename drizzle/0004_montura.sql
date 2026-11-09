-- Migracion 0004: tipo de producto «Montura» (reunion con el area, 2026-10-29). Solo amplia el CHECK del tipo;
-- los campos nuevos de la ficha (RIM, cantidad, respuesta del area) viven en `referencia.datos` y no necesitan columnas.
ALTER TABLE "referencia" DROP CONSTRAINT "referencia_tipo_valido";--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_tipo_valido" CHECK ("referencia"."tipo_producto" in ('INSUMO','REPUESTO','EQUIPO','ACCESORIO','MONTURA'));
