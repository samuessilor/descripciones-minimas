-- Aviso nuevo `cuenta_creada` (una supervisora crea una cuenta y el administrador debe generar y entregar su clave). No habla de
-- una ficha: `referencia_id` admite NULL y el aviso apunta a la cuenta con `cuenta_id`. Los CHECK de coherencia exigen ficha en los
-- demas tipos y la prohiben en `cuenta_creada` (que a cambio exige `cuenta_id`).
ALTER TABLE "notificacion" DROP CONSTRAINT "notificacion_tipo_valido";--> statement-breakpoint
ALTER TABLE "notificacion" ALTER COLUMN "referencia_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notificacion" ADD COLUMN "cuenta_id" uuid;--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_cuenta_id_usuario_id_fk" FOREIGN KEY ("cuenta_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_referencia_coherente" CHECK (("notificacion"."tipo" = 'cuenta_creada') = ("notificacion"."referencia_id" is null));--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_cuenta_coherente" CHECK (("notificacion"."tipo" = 'cuenta_creada') = ("notificacion"."cuenta_id" is not null));--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_tipo_valido" CHECK ("notificacion"."tipo" in ('asignacion','recordatorio','respuesta','clasificada','reabierta','reapertura_solicitada','cambio_en_mi_campo','comentario','cuenta_creada'));