ALTER TABLE "organizacion" ADD COLUMN "eliminada_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "eliminado_en" timestamp with time zone;
--> statement-breakpoint
-- ===== A MANO (2026-11-11): eliminar una cuenta o una agencia AUNQUE haya trabajado; el historial no pierde quien lo hizo =====
--
-- Antes, una cuenta (o agencia) con trabajo propio no se podia eliminar: sus cambios la referencian. Ahora se RETIRA: la fila se conserva
-- anonimizada y fuera de las listas («Agencia X (cuenta eliminada)», sin usuario, sin contrasena, sin sesiones) y el historial, los
-- comentarios y las fichas cerradas siguen diciendo que esa agencia las hizo. Si la cuenta NUNCA trabajo, se borra del todo como antes.
CREATE OR REPLACE FUNCTION public.eliminar_usuario(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  u usuario%ROWTYPE; n_auditoria int := 0; n_asignaciones int; n_avisos int; marca text;
BEGIN
  SELECT * INTO u FROM usuario WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR u.eliminado_en IS NOT NULL THEN
    RAISE EXCEPTION 'usuario_no_existe' USING ERRCODE = 'P0002';
  END IF;

  IF public.usuario_tiene_trabajo(p_id) THEN
    -- RETIRADA: se va todo lo operativo; la fila y su nombre quedan para el historial.
    DELETE FROM notificacion
     WHERE usuario_id = p_id OR cuenta_id = p_id
        OR asignacion_id IN (SELECT id FROM asignacion WHERE a_usuario_id = p_id AND estado IN ('pendiente', 'en_curso'));
    GET DIAGNOSTICS n_avisos = ROW_COUNT;
    DELETE FROM asignacion WHERE a_usuario_id = p_id AND estado IN ('pendiente', 'en_curso');
    GET DIAGNOSTICS n_asignaciones = ROW_COUNT;
    DELETE FROM edicion_activa WHERE usuario_id = p_id;
    DELETE FROM "session" WHERE user_id = p_id;
    DELETE FROM "account" WHERE user_id = p_id;
    DELETE FROM clave_entrega WHERE usuario_id = p_id;
    marca := left(p_id::text, 8);
    UPDATE usuario
       SET activo = false, eliminado_en = now(), username = 'eliminada-' || marca, email = 'eliminada-' || marca || '@eliminada.invalid',
           nombre = nombre || ' (cuenta eliminada)', encargado = NULL, imagen = NULL, debe_cambiar_clave = false, actualizado_en = now()
     WHERE id = p_id;
    RETURN jsonb_build_object('retirada', true, 'auditoria', 0, 'asignaciones', n_asignaciones, 'avisos', n_avisos);
  END IF;

  -- Sin trabajo propio: se borra del todo (sus filas de auditoria se conservan sin el vinculo y con el usuario anotado).
  PERFORM set_config('app.borrado_autorizado', 'si', true);
  UPDATE auditoria SET usuario_id = NULL, detalle = detalle || jsonb_build_object('usuarioEliminado', COALESCE(u.username, u.email)) WHERE usuario_id = p_id;
  GET DIAGNOSTICS n_auditoria = ROW_COUNT;
  DELETE FROM notificacion
   WHERE usuario_id = p_id OR cuenta_id = p_id
      OR asignacion_id IN (SELECT id FROM asignacion WHERE a_usuario_id = p_id);
  GET DIAGNOSTICS n_avisos = ROW_COUNT;
  DELETE FROM asignacion WHERE a_usuario_id = p_id; -- las que envio (de_usuario_id) cuentan como trabajo: esa cuenta se retira, no se borra
  GET DIAGNOSTICS n_asignaciones = ROW_COUNT;
  DELETE FROM edicion_activa WHERE usuario_id = p_id;
  UPDATE usuario SET creado_por = NULL WHERE creado_por = p_id;
  DELETE FROM usuario WHERE id = p_id; -- session, account y clave_entrega se van en cascada
  PERFORM set_config('app.borrado_autorizado', '', true);
  RETURN jsonb_build_object('retirada', false, 'auditoria', n_auditoria, 'asignaciones', n_asignaciones, 'avisos', n_avisos);
END;
$$;
--> statement-breakpoint
-- Elimina una organizacion con sus cuentas. Cada cuenta se borra o se retira segun haya trabajado; la organizacion igual: si tiene cambios
-- registrados a su nombre o cuentas retiradas, se conserva renombrada «… (eliminada)», inactiva y fuera de las listas.
CREATE OR REPLACE FUNCTION public.eliminar_organizacion(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o organizacion%ROWTYPE; cuenta uuid; n_cuentas int := 0; k int := 1; nuevo text;
BEGIN
  SELECT * INTO o FROM organizacion WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR o.eliminada_en IS NOT NULL THEN
    RAISE EXCEPTION 'organizacion_no_existe' USING ERRCODE = 'P0002';
  END IF;
  IF o.tipo <> 'agencia' AND EXISTS (SELECT 1 FROM usuario WHERE organizacion_id = p_id AND eliminado_en IS NULL) THEN
    RAISE EXCEPTION 'organizacion_interna_con_cuentas' USING ERRCODE = 'P0001';
  END IF;
  FOR cuenta IN SELECT id FROM usuario WHERE organizacion_id = p_id AND eliminado_en IS NULL LOOP
    PERFORM public.eliminar_usuario(cuenta);
    n_cuentas := n_cuentas + 1;
  END LOOP;
  IF EXISTS (SELECT 1 FROM campo_historial WHERE organizacion_id = p_id) OR EXISTS (SELECT 1 FROM usuario WHERE organizacion_id = p_id) THEN
    nuevo := o.nombre || ' (eliminada)';
    WHILE EXISTS (SELECT 1 FROM organizacion WHERE nombre = nuevo) LOOP
      k := k + 1;
      nuevo := o.nombre || ' (eliminada ' || k || ')';
    END LOOP;
    UPDATE organizacion SET nombre = nuevo, activa = false, eliminada_en = now() WHERE id = p_id;
    RETURN jsonb_build_object('cuentas', n_cuentas, 'retirada', true);
  END IF;
  DELETE FROM organizacion WHERE id = p_id;
  RETURN jsonb_build_object('cuentas', n_cuentas, 'retirada', false);
END;
$$;
--> statement-breakpoint
SELECT public.aplicar_permisos_app();
