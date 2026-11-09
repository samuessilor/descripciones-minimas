ALTER TABLE "correo_dev" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entrega_correo" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "correo_dev" CASCADE;--> statement-breakpoint
DROP TABLE "entrega_correo" CASCADE;--> statement-breakpoint
ALTER TABLE "usuario" DROP CONSTRAINT "usuario_preferencia_valida";--> statement-breakpoint
ALTER TABLE "usuario" DROP COLUMN "correo_invalido";--> statement-breakpoint
ALTER TABLE "usuario" DROP COLUMN "preferencia_aviso";