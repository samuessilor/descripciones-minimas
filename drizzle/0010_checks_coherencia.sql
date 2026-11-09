-- Coherencia que hoy solo vive en el codigo (cierre.ts, asignaciones.ts): la base la impone tambien.
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_clasificada_coherente"
  CHECK (("estado" = 'CLASIFICADA') = ("clasificada_en" IS NOT NULL AND "clasificada_por" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_archivo_coherente"
  CHECK (("archivada_en" IS NULL) = ("estado_previo_archivo" IS NULL)
    AND ("archivada_en" IS NULL OR ("archivada_por" IS NOT NULL AND "motivo_archivo" IS NOT NULL)));
--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_datos_objeto" CHECK (jsonb_typeof("datos") = 'object');
--> statement-breakpoint
ALTER TABLE "asignacion" ADD CONSTRAINT "asignacion_completada_coherente"
  CHECK (("estado" IN ('hecha','reasignada','cancelada')) = ("completada_en" IS NOT NULL));
--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_area_valida"
  CHECK ("area" IS NULL OR "area" IN ('Consumibles','Mantenimiento','Instrumentos','Marketing'));
--> statement-breakpoint
-- Indices que el planificador no usa a este volumen (estado: 3 valores, tipo: 5, partida: se busca con una expresion).
DROP INDEX IF EXISTS "referencia_estado_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "referencia_tipo_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "referencia_partida_idx";
