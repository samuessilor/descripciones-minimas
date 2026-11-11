CREATE TABLE "clave_entrega" (
	"usuario_id" uuid PRIMARY KEY NOT NULL,
	"cifrada" text NOT NULL,
	"creada_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clave_entrega" ADD CONSTRAINT "clave_entrega_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- ===== A MANO (reunion 2026-11-10): eliminar referencias, cuentas y agencias; clave de entrega cifrada =====
--
-- El historial, los comentarios, los textos descartados y la auditoria SIGUEN siendo de solo escritura: nada de la aplicacion los
-- toca. Para el caso, unico y explicito, de «Eliminar referencia» / «Eliminar cuenta» / «Eliminar agencia» (solo administrador y
-- supervisora general, con confirmacion y una fila de auditoria que conserva el codigo o el usuario), el trigger acepta el borrado
-- cuando la transaccion lo declara con `app.borrado_autorizado = 'si'` (set_config LOCAL: vale solo hasta el fin de esa transaccion).
-- Esa bandera solo la pone una de las tres funciones de abajo, que son SECURITY DEFINER: el rol `app` NO gana permisos de borrado
-- sobre ninguna tabla de negocio (`delete from referencia` o `delete from usuario` siguen dando 42501); solo puede EJECUTAR esas funciones.
CREATE OR REPLACE FUNCTION public.rechazar_cambio() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.borrado_autorizado', true) = 'si'
     AND ((TG_OP = 'DELETE' AND TG_TABLE_NAME IN ('campo_historial', 'comentario', 'texto_descartado'))
          OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'auditoria')) THEN
    RETURN NULL; -- trigger por sentencia: el valor de retorno se ignora y la operacion sigue
  END IF;
  RAISE EXCEPTION 'tabla de solo escritura: % no admite %', TG_TABLE_NAME, TG_OP
    USING HINT = 'Los hechos se agregan; nunca se modifican ni se borran.';
END;
$$;
--> statement-breakpoint
-- ¿La cuenta dejo trabajo propio que no se puede borrar sin perder quien lo hizo? (historial, comentarios, fotos, fichas creadas o cerradas, partidas)
CREATE OR REPLACE FUNCTION public.usuario_tiene_trabajo(p_id uuid) RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM public.campo_historial WHERE autor_id = p_id)
      OR EXISTS (SELECT 1 FROM public.comentario WHERE autor_id = p_id)
      OR EXISTS (SELECT 1 FROM public.texto_descartado WHERE usuario_id = p_id)
      OR EXISTS (SELECT 1 FROM public.adjunto WHERE subido_por = p_id OR retirado_por = p_id)
      OR EXISTS (SELECT 1 FROM public.referencia WHERE creada_por = p_id OR clasificada_por = p_id OR archivada_por = p_id)
      OR EXISTS (SELECT 1 FROM public.partida_arancelaria WHERE creada_por = p_id)
      OR EXISTS (SELECT 1 FROM public.asignacion WHERE de_usuario_id = p_id); -- lo que envio a otros es de esos otros: no se les quita
$$;
--> statement-breakpoint
-- Elimina una referencia con TODO lo suyo. Devuelve cuanto borro y las llaves de sus fotos (el almacen de archivos se limpia aparte).
CREATE OR REPLACE FUNCTION public.eliminar_referencia(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  n_historial int; n_comentarios int; n_descartados int; n_asignaciones int; n_avisos int; n_fotos int; llaves text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referencia WHERE id = p_id) THEN
    RAISE EXCEPTION 'referencia_no_existe' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(array_agg(storage_key), '{}') INTO llaves FROM adjunto WHERE referencia_id = p_id;
  PERFORM set_config('app.borrado_autorizado', 'si', true);
  DELETE FROM notificacion WHERE referencia_id = p_id OR asignacion_id IN (SELECT id FROM asignacion WHERE referencia_id = p_id);
  GET DIAGNOSTICS n_avisos = ROW_COUNT;
  DELETE FROM asignacion WHERE referencia_id = p_id;
  GET DIAGNOSTICS n_asignaciones = ROW_COUNT;
  DELETE FROM edicion_activa WHERE referencia_id = p_id;
  DELETE FROM comentario WHERE referencia_id = p_id;
  GET DIAGNOSTICS n_comentarios = ROW_COUNT;
  DELETE FROM texto_descartado WHERE referencia_id = p_id;
  GET DIAGNOSTICS n_descartados = ROW_COUNT;
  DELETE FROM campo_historial WHERE referencia_id = p_id;
  GET DIAGNOSTICS n_historial = ROW_COUNT;
  DELETE FROM adjunto WHERE referencia_id = p_id;
  GET DIAGNOSTICS n_fotos = ROW_COUNT;
  DELETE FROM referencia WHERE id = p_id;
  PERFORM set_config('app.borrado_autorizado', '', true);
  RETURN jsonb_build_object('historial', n_historial, 'comentarios', n_comentarios, 'descartados', n_descartados,
                            'asignaciones', n_asignaciones, 'avisos', n_avisos, 'fotos', n_fotos, 'llaves', to_jsonb(llaves));
END;
$$;
--> statement-breakpoint
-- Elimina una cuenta que NO dejo trabajo propio. Lo operativo (avisos, pendientes, sesiones, clave) se va con ella; en la auditoria
-- sus filas se conservan sin el vinculo y con el nombre de usuario anotado.
CREATE OR REPLACE FUNCTION public.eliminar_usuario(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  u usuario%ROWTYPE; n_auditoria int; n_asignaciones int; n_avisos int;
BEGIN
  SELECT * INTO u FROM usuario WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'usuario_no_existe' USING ERRCODE = 'P0002';
  END IF;
  IF public.usuario_tiene_trabajo(p_id) THEN
    RAISE EXCEPTION 'usuario_con_trabajo' USING ERRCODE = 'P0001';
  END IF;
  PERFORM set_config('app.borrado_autorizado', 'si', true);
  UPDATE auditoria SET usuario_id = NULL, detalle = detalle || jsonb_build_object('usuarioEliminado', COALESCE(u.username, u.email)) WHERE usuario_id = p_id;
  GET DIAGNOSTICS n_auditoria = ROW_COUNT;
  DELETE FROM notificacion
   WHERE usuario_id = p_id OR cuenta_id = p_id
      OR asignacion_id IN (SELECT id FROM asignacion WHERE a_usuario_id = p_id);
  GET DIAGNOSTICS n_avisos = ROW_COUNT;
  DELETE FROM asignacion WHERE a_usuario_id = p_id; -- las que envio (de_usuario_id) ya impidieron el borrado
  GET DIAGNOSTICS n_asignaciones = ROW_COUNT;
  DELETE FROM edicion_activa WHERE usuario_id = p_id;
  UPDATE usuario SET creado_por = NULL WHERE creado_por = p_id;
  DELETE FROM usuario WHERE id = p_id; -- session, account y clave_entrega se van en cascada
  PERFORM set_config('app.borrado_autorizado', '', true);
  RETURN jsonb_build_object('auditoria', n_auditoria, 'asignaciones', n_asignaciones, 'avisos', n_avisos);
END;
$$;
--> statement-breakpoint
-- Elimina una organizacion. Una agencia se va con sus cuentas (cada una debe estar libre de trabajo propio); una interna solo si no tiene cuentas.
CREATE OR REPLACE FUNCTION public.eliminar_organizacion(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o organizacion%ROWTYPE; cuenta uuid; n_cuentas int := 0;
BEGIN
  SELECT * INTO o FROM organizacion WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organizacion_no_existe' USING ERRCODE = 'P0002';
  END IF;
  IF o.tipo <> 'agencia' AND EXISTS (SELECT 1 FROM usuario WHERE organizacion_id = p_id) THEN
    RAISE EXCEPTION 'organizacion_interna_con_cuentas' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM campo_historial WHERE organizacion_id = p_id) THEN
    RAISE EXCEPTION 'organizacion_con_historial' USING ERRCODE = 'P0001';
  END IF;
  FOR cuenta IN SELECT id FROM usuario WHERE organizacion_id = p_id LOOP
    PERFORM public.eliminar_usuario(cuenta);
    n_cuentas := n_cuentas + 1;
  END LOOP;
  DELETE FROM organizacion WHERE id = p_id;
  RETURN jsonb_build_object('cuentas', n_cuentas);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.eliminar_referencia(uuid), public.eliminar_usuario(uuid), public.eliminar_organizacion(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Permisos de `app` (idempotente, se invoca tras cada migracion): igual que la 0011, mas DELETE en `clave_entrega` (se borra cuando
-- la persona cambia su contrasena) y EJECUTAR las tres funciones de borrado. Siguen sin DELETE directo referencia, usuario, asignacion,
-- account ni las tablas inmutables.
CREATE OR REPLACE FUNCTION public.aplicar_permisos_app() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  inmutables constant text[] := ARRAY['campo_historial', 'auditoria', 'comentario', 'texto_descartado'];
  con_borrado constant text[] := ARRAY['session', 'verification', 'edicion_activa', 'limite_tasa', 'notificacion', 'clave_entrega'];
  t text;
  columnas text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    RAISE NOTICE 'El rol app no existe todavia: no se aplican permisos (ejecuta db:roles y luego db:migrate).';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO app';
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM app';
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app';

  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LOOP
    IF t = ANY (inmutables) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app', t);
      SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
        INTO columnas
        FROM pg_attribute a
       WHERE a.attrelid = format('public.%I', t)::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
         AND (
           a.attname NOT IN ('id', 'creada_en', 'creado_en', 'creada_por', 'creado_por')
           OR (t = 'notificacion' AND a.attname = 'creada_en')
         )
         AND a.attnum <> ALL (
           COALESCE((SELECT c.conkey FROM pg_constraint c WHERE c.conrelid = a.attrelid AND c.contype = 'p'), '{}'::int2[])
         );
      IF columnas IS NOT NULL THEN
        EXECUTE format('GRANT UPDATE (%s) ON public.%I TO app', columnas, t);
      END IF;
      IF t = ANY (con_borrado) THEN
        EXECUTE format('GRANT DELETE ON public.%I TO app', t);
      END IF;
    END IF;
  END LOOP;

  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.eliminar_referencia(uuid), public.eliminar_usuario(uuid), public.eliminar_organizacion(uuid) TO app';
END;
$$;
--> statement-breakpoint
SELECT public.aplicar_permisos_app();
