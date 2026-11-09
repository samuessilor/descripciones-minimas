ALTER TABLE "usuario" ADD COLUMN "username" text;--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_username_unico" ON "usuario" USING btree ("username");--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_username_formato" CHECK ("usuario"."username" is null or "usuario"."username" ~ '^[a-z0-9][a-z0-9._-]{2,39}$');