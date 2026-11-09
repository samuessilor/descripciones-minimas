CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"tipo" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizacion_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "organizacion_id_tipo_unico" UNIQUE("id","tipo"),
	CONSTRAINT "organizacion_tipo_valido" CHECK ("organizacion"."tipo" in ('interna','agencia'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"ultima_actividad" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nombre" text NOT NULL,
	"email" text NOT NULL,
	"email_verificado" boolean DEFAULT false NOT NULL,
	"imagen" text,
	"organizacion_id" uuid NOT NULL,
	"organizacion_tipo" text NOT NULL,
	"rol" text NOT NULL,
	"area" text,
	"activo" boolean DEFAULT true NOT NULL,
	"correo_invalido" boolean DEFAULT false NOT NULL,
	"preferencia_aviso" text DEFAULT 'inmediato' NOT NULL,
	"atajos_teclado" boolean DEFAULT true NOT NULL,
	"ultimo_ingreso" timestamp with time zone,
	"creado_por" uuid,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_rol_valido" CHECK ("usuario"."rol" in ('admin','solicitante','aduana','lector')),
	CONSTRAINT "usuario_preferencia_valida" CHECK ("usuario"."preferencia_aviso" in ('inmediato','solo_bandeja')),
	CONSTRAINT "usuario_email_minusculas" CHECK ("usuario"."email" = lower("usuario"."email")),
	CONSTRAINT "usuario_agencia_solo_aduana" CHECK ("usuario"."organizacion_tipo" <> 'agencia' or "usuario"."rol" = 'aduana')
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "adjunto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"tipo" text DEFAULT 'foto' NOT NULL,
	"nombre_original" text NOT NULL,
	"mime" text NOT NULL,
	"tamano_bytes" integer NOT NULL,
	"sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"subido_por" uuid NOT NULL,
	"subido_en" timestamp with time zone DEFAULT now() NOT NULL,
	"retirado_en" timestamp with time zone,
	"retirado_por" uuid,
	"motivo_retiro" text,
	CONSTRAINT "adjunto_mime_valido" CHECK ("adjunto"."mime" in ('image/jpeg','image/png','image/webp'))
);
--> statement-breakpoint
CREATE TABLE "campo_historial" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referencia_id" uuid NOT NULL,
	"campo" text NOT NULL,
	"version_campo" integer NOT NULL,
	"tipo_evento" text NOT NULL,
	"valor" jsonb,
	"restaura_id" bigint,
	"base_version" integer,
	"motivo" text,
	"autor_id" uuid NOT NULL,
	"rol" text NOT NULL,
	"organizacion_id" uuid NOT NULL,
	"origen" text DEFAULT 'web' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campo_historial_version_unica" UNIQUE("referencia_id","campo","version_campo"),
	CONSTRAINT "campo_historial_evento_valido" CHECK ("campo_historial"."tipo_evento" in ('fijar','vaciar','restaurar','sistema')),
	CONSTRAINT "campo_historial_origen_valido" CHECK ("campo_historial"."origen" in ('web','sistema')),
	CONSTRAINT "campo_historial_version_positiva" CHECK ("campo_historial"."version_campo" >= 1)
);
--> statement-breakpoint
CREATE TABLE "comentario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"campo" text,
	"autor_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"visibilidad" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comentario_visibilidad_valida" CHECK ("comentario"."visibilidad" in ('interno','todos'))
);
--> statement-breakpoint
CREATE TABLE "edicion_activa" (
	"referencia_id" uuid NOT NULL,
	"campo" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"hasta" timestamp with time zone NOT NULL,
	CONSTRAINT "edicion_activa_referencia_id_campo_usuario_id_pk" PRIMARY KEY("referencia_id","campo","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "pregunta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"origen" text NOT NULL,
	"clave" text,
	"etiqueta" text NOT NULL,
	"ayuda" text,
	"obligatoriedad" text NOT NULL,
	"tipo_dato" text DEFAULT 'texto' NOT NULL,
	"opciones" jsonb,
	"orden" integer DEFAULT 0 NOT NULL,
	"mapea_a" text,
	"pedida_por" uuid NOT NULL,
	"pedida_en" timestamp with time zone DEFAULT now() NOT NULL,
	"retirada_en" timestamp with time zone,
	"retirada_por" uuid,
	"motivo_retiro" text,
	CONSTRAINT "pregunta_origen_valido" CHECK ("pregunta"."origen" in ('plantilla','propia')),
	CONSTRAINT "pregunta_obligatoriedad_valida" CHECK ("pregunta"."obligatoriedad" in ('obligatorio','si_tiene','si_aplica')),
	CONSTRAINT "pregunta_tipo_dato_valido" CHECK ("pregunta"."tipo_dato" in ('texto','numero','lista'))
);
--> statement-breakpoint
CREATE TABLE "referencia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"codigo_norm" text NOT NULL,
	"nombre_producto" text NOT NULL,
	"tipo_producto" text NOT NULL,
	"fecha_solicitud" date DEFAULT ((now() at time zone 'America/Bogota')::date) NOT NULL,
	"partida" text,
	"estado" text DEFAULT 'BORRADOR' NOT NULL,
	"clasificada_en" timestamp with time zone,
	"clasificada_por" uuid,
	"dias_pausa" integer DEFAULT 0 NOT NULL,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"texto_busqueda" text DEFAULT '' NOT NULL,
	"creada_por" uuid NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"archivada_en" timestamp with time zone,
	"archivada_por" uuid,
	"motivo_archivo" text,
	"estado_previo_archivo" text,
	CONSTRAINT "referencia_tipo_valido" CHECK ("referencia"."tipo_producto" in ('INSUMO','REPUESTO','EQUIPO','ACCESORIO')),
	CONSTRAINT "referencia_estado_valido" CHECK ("referencia"."estado" in ('BORRADOR','EN_GESTION','CLASIFICADA')),
	CONSTRAINT "referencia_estado_previo_valido" CHECK ("referencia"."estado_previo_archivo" is null or "referencia"."estado_previo_archivo" in ('BORRADOR','EN_GESTION','CLASIFICADA')),
	CONSTRAINT "referencia_dias_pausa_no_negativo" CHECK ("referencia"."dias_pausa" >= 0)
);
--> statement-breakpoint
CREATE TABLE "texto_descartado" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"referencia_id" uuid NOT NULL,
	"campo" text NOT NULL,
	"usuario_id" uuid NOT NULL,
	"texto" text NOT NULL,
	"motivo_descarte" text NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "texto_descartado_motivo_valido" CHECK ("texto_descartado"."motivo_descarte" in ('conflicto_dejar_el_otro'))
);
--> statement-breakpoint
CREATE TABLE "catalogo_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalogo" text NOT NULL,
	"valor" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "catalogo_item_unico" UNIQUE("catalogo","valor"),
	CONSTRAINT "catalogo_item_catalogo_valido" CHECK ("catalogo_item"."catalogo" in ('unidad_medida','aspecto_fisico','sugerencia_empaque'))
);
--> statement-breakpoint
CREATE TABLE "dm_plantilla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"nombre" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"estado" text DEFAULT 'activa' NOT NULL,
	"propuesta_por" uuid,
	"propuesta_desde_referencia" uuid,
	CONSTRAINT "dm_plantilla_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "dm_plantilla_estado_valido" CHECK ("dm_plantilla"."estado" in ('activa','propuesta','inactiva'))
);
--> statement-breakpoint
CREATE TABLE "dm_plantilla_campo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plantilla_id" uuid NOT NULL,
	"orden" integer NOT NULL,
	"clave" text NOT NULL,
	"etiqueta" text NOT NULL,
	"ayuda" text,
	"obligatoriedad" text NOT NULL,
	"tipo_dato" text DEFAULT 'texto' NOT NULL,
	"opciones" jsonb,
	"mapea_a" text,
	CONSTRAINT "dm_plantilla_campo_clave_unica" UNIQUE("plantilla_id","clave"),
	CONSTRAINT "dm_plantilla_campo_obligatoriedad_valida" CHECK ("dm_plantilla_campo"."obligatoriedad" in ('obligatorio','si_tiene','si_aplica')),
	CONSTRAINT "dm_plantilla_campo_tipo_dato_valido" CHECK ("dm_plantilla_campo"."tipo_dato" in ('texto','numero','lista'))
);
--> statement-breakpoint
CREATE TABLE "partida_arancelaria" (
	"codigo" text PRIMARY KEY NOT NULL,
	"descripcion" text,
	"dm_plantilla_id" uuid,
	"restriccion_id" uuid,
	"origen" text NOT NULL,
	"creada_por" uuid,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "partida_codigo_formato" CHECK ("partida_arancelaria"."codigo" ~ '^\d{4}\.\d{2}\.\d{2}\.\d{2}$'),
	CONSTRAINT "partida_origen_valido" CHECK ("partida_arancelaria"."origen" in ('semilla','aduana'))
);
--> statement-breakpoint
CREATE TABLE "restriccion_plantilla" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text NOT NULL,
	"texto" text NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "restriccion_plantilla_codigo_unique" UNIQUE("codigo")
);
--> statement-breakpoint
CREATE TABLE "asignacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referencia_id" uuid NOT NULL,
	"de_usuario_id" uuid NOT NULL,
	"a_usuario_id" uuid NOT NULL,
	"pedido" text,
	"mensaje" text,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"vista_en" timestamp with time zone,
	"completada_en" timestamp with time zone,
	"n_recordatorios" integer DEFAULT 0 NOT NULL,
	"ultimo_recordatorio_en" timestamp with time zone,
	"acceso_hasta" timestamp with time zone,
	CONSTRAINT "asignacion_pedido_valido" CHECK ("asignacion"."pedido" is null or "asignacion"."pedido" in ('completar','clasificar','responder','revisar')),
	CONSTRAINT "asignacion_estado_valido" CHECK ("asignacion"."estado" in ('pendiente','en_curso','hecha','reasignada','cancelada'))
);
--> statement-breakpoint
CREATE TABLE "correo_dev" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destinatario" text NOT NULL,
	"asunto" text NOT NULL,
	"cuerpo_texto" text NOT NULL,
	"cuerpo_html" text NOT NULL,
	"enlace" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entrega_correo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notificacion_id" uuid,
	"destinatario" text NOT NULL,
	"plantilla" text NOT NULL,
	"estado" text DEFAULT 'pendiente' NOT NULL,
	"clave_idempotencia" text NOT NULL,
	"intentos" integer DEFAULT 0 NOT NULL,
	"proximo_intento" timestamp with time zone DEFAULT now() NOT NULL,
	"bloqueado_hasta" timestamp with time zone,
	"ultimo_error" text,
	"enviado_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	"asunto" text NOT NULL,
	"cuerpo_texto" text NOT NULL,
	"cuerpo_html" text NOT NULL,
	CONSTRAINT "entrega_correo_clave_idempotencia_unique" UNIQUE("clave_idempotencia"),
	CONSTRAINT "entrega_correo_estado_valido" CHECK ("entrega_correo"."estado" in ('pendiente','enviando','enviado','fallido','abandonado'))
);
--> statement-breakpoint
CREATE TABLE "notificacion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"referencia_id" uuid NOT NULL,
	"asignacion_id" uuid,
	"titulo" text NOT NULL,
	"leida_en" timestamp with time zone,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notificacion_tipo_valido" CHECK ("notificacion"."tipo" in ('asignacion','recordatorio','pregunta','respuesta','clasificada','reabierta','reapertura_solicitada','cambio_en_mi_campo','comentario'))
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"usuario_id" uuid,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text NOT NULL,
	"detalle" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limite_tasa" (
	"clave" text NOT NULL,
	"ventana" timestamp with time zone NOT NULL,
	"contador" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "limite_tasa_clave_ventana_pk" PRIMARY KEY("clave","ventana")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_usuario_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_usuario_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_creado_por_usuario_id_fk" FOREIGN KEY ("creado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_organizacion_fk" FOREIGN KEY ("organizacion_id","organizacion_tipo") REFERENCES "public"."organizacion"("id","tipo") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjunto" ADD CONSTRAINT "adjunto_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjunto" ADD CONSTRAINT "adjunto_subido_por_usuario_id_fk" FOREIGN KEY ("subido_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjunto" ADD CONSTRAINT "adjunto_retirado_por_usuario_id_fk" FOREIGN KEY ("retirado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campo_historial" ADD CONSTRAINT "campo_historial_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campo_historial" ADD CONSTRAINT "campo_historial_restaura_id_campo_historial_id_fk" FOREIGN KEY ("restaura_id") REFERENCES "public"."campo_historial"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campo_historial" ADD CONSTRAINT "campo_historial_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campo_historial" ADD CONSTRAINT "campo_historial_organizacion_id_organizacion_id_fk" FOREIGN KEY ("organizacion_id") REFERENCES "public"."organizacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comentario" ADD CONSTRAINT "comentario_autor_id_usuario_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edicion_activa" ADD CONSTRAINT "edicion_activa_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edicion_activa" ADD CONSTRAINT "edicion_activa_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregunta" ADD CONSTRAINT "pregunta_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregunta" ADD CONSTRAINT "pregunta_pedida_por_usuario_id_fk" FOREIGN KEY ("pedida_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pregunta" ADD CONSTRAINT "pregunta_retirada_por_usuario_id_fk" FOREIGN KEY ("retirada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_clasificada_por_usuario_id_fk" FOREIGN KEY ("clasificada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_creada_por_usuario_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referencia" ADD CONSTRAINT "referencia_archivada_por_usuario_id_fk" FOREIGN KEY ("archivada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "texto_descartado" ADD CONSTRAINT "texto_descartado_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "texto_descartado" ADD CONSTRAINT "texto_descartado_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_plantilla" ADD CONSTRAINT "dm_plantilla_propuesta_por_usuario_id_fk" FOREIGN KEY ("propuesta_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_plantilla" ADD CONSTRAINT "dm_plantilla_propuesta_desde_referencia_referencia_id_fk" FOREIGN KEY ("propuesta_desde_referencia") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dm_plantilla_campo" ADD CONSTRAINT "dm_plantilla_campo_plantilla_id_dm_plantilla_id_fk" FOREIGN KEY ("plantilla_id") REFERENCES "public"."dm_plantilla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida_arancelaria" ADD CONSTRAINT "partida_arancelaria_dm_plantilla_id_dm_plantilla_id_fk" FOREIGN KEY ("dm_plantilla_id") REFERENCES "public"."dm_plantilla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida_arancelaria" ADD CONSTRAINT "partida_arancelaria_restriccion_id_restriccion_plantilla_id_fk" FOREIGN KEY ("restriccion_id") REFERENCES "public"."restriccion_plantilla"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida_arancelaria" ADD CONSTRAINT "partida_arancelaria_creada_por_usuario_id_fk" FOREIGN KEY ("creada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asignacion" ADD CONSTRAINT "asignacion_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asignacion" ADD CONSTRAINT "asignacion_de_usuario_id_usuario_id_fk" FOREIGN KEY ("de_usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asignacion" ADD CONSTRAINT "asignacion_a_usuario_id_usuario_id_fk" FOREIGN KEY ("a_usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega_correo" ADD CONSTRAINT "entrega_correo_notificacion_id_notificacion_id_fk" FOREIGN KEY ("notificacion_id") REFERENCES "public"."notificacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_referencia_id_referencia_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "public"."referencia"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_asignacion_id_asignacion_id_fk" FOREIGN KEY ("asignacion_id") REFERENCES "public"."asignacion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_email_unico" ON "usuario" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "usuario_organizacion_idx" ON "usuario" USING btree ("organizacion_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "adjunto_referencia_idx" ON "adjunto" USING btree ("referencia_id");--> statement-breakpoint
CREATE INDEX "comentario_referencia_idx" ON "comentario" USING btree ("referencia_id","creado_en");--> statement-breakpoint
CREATE INDEX "pregunta_referencia_idx" ON "pregunta" USING btree ("referencia_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referencia_codigo_norm_unico" ON "referencia" USING btree ("codigo_norm");--> statement-breakpoint
CREATE INDEX "referencia_estado_idx" ON "referencia" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "referencia_tipo_idx" ON "referencia" USING btree ("tipo_producto");--> statement-breakpoint
CREATE INDEX "referencia_creada_idx" ON "referencia" USING btree ("creada_en" desc,"id");--> statement-breakpoint
CREATE INDEX "referencia_partida_idx" ON "referencia" USING btree ("partida");--> statement-breakpoint
CREATE INDEX "texto_descartado_ref_campo_idx" ON "texto_descartado" USING btree ("referencia_id","campo");--> statement-breakpoint
CREATE INDEX "dm_plantilla_campo_plantilla_idx" ON "dm_plantilla_campo" USING btree ("plantilla_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asignacion_activa_unica" ON "asignacion" USING btree ("referencia_id","a_usuario_id") WHERE "asignacion"."estado" in ('pendiente','en_curso');--> statement-breakpoint
CREATE INDEX "asignacion_destinatario_idx" ON "asignacion" USING btree ("a_usuario_id","estado");--> statement-breakpoint
CREATE INDEX "asignacion_referencia_idx" ON "asignacion" USING btree ("referencia_id");--> statement-breakpoint
CREATE INDEX "entrega_correo_cola_idx" ON "entrega_correo" USING btree ("estado","proximo_intento");--> statement-breakpoint
CREATE INDEX "notificacion_usuario_idx" ON "notificacion" USING btree ("usuario_id","leida_en");--> statement-breakpoint
CREATE INDEX "notificacion_referencia_idx" ON "notificacion" USING btree ("referencia_id");--> statement-breakpoint
CREATE INDEX "auditoria_entidad_idx" ON "auditoria" USING btree ("entidad","entidad_id");