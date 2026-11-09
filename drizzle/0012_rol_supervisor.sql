-- Rol nuevo: supervisora general (valor interno 'supervisor'). Solo cambia el CHECK de rol; no hay datos que migrar.
ALTER TABLE "usuario" DROP CONSTRAINT "usuario_rol_valido";--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_rol_valido" CHECK ("usuario"."rol" in ('admin','supervisor','solicitante','aduana','lector'));