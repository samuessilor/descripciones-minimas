-- Migracion escrita A MANO (custom). Retencion minima y segura (src/server/retencion.ts).
--
-- El rol `app` (no duenio, D-31) solo podia borrar en session, verification, edicion_activa y limite_tasa.
-- La retencion diaria (GET /api/cron/retencion) tambien depurara `notificacion` (avisos leidos de hace mas de
-- 30 dias y no leidos de hace mas de 90): es una bandeja operativa, NO un hecho de negocio, asi que no es
-- append-only. Las tablas inmutables (campo_historial, auditoria, comentario, texto_descartado) siguen
-- solo con SELECT e INSERT y con su trigger: esta migracion no las toca.
--
-- Se redefine `aplicar_permisos_app()` (CREATE OR REPLACE, idempotente) con dos diferencias respecto de la
-- 0001 (la de abajo y `notificacion` en `con_borrado`). Como la funcion se invoca despues de cada `db:migrate`, el permiso
-- queda aplicado tambien en bases ya migradas. Sigue siendo un no-op si el rol `app` no existe (PGlite local,
-- primera migracion en Neon con el rol duenio unico).
--
-- Segunda diferencia: se permite UPDATE de `notificacion.creada_en` al rol `app`: cuando un aviso sin leer se repite (misma
-- persona, tipo y ficha) se actualiza su titulo y su hora en vez de insertar otro (src/server/notificaciones/crear.ts).
-- Es la unica columna de creacion que se libera; el resto de `creada_en`/`creado_en` sigue sin poder actualizarse.
--
-- Sin indice nuevo: el borrado diario recorre `notificacion` una vez (medido con EXPLAIN en PGlite: ~45 ms con
-- 50.000 filas, y la tabla real queda acotada por esta misma retencion). Un indice sobre las fechas costaria
-- escritura en cada aviso a cambio de ahorrar milisegundos una vez al dia.
CREATE OR REPLACE FUNCTION public.aplicar_permisos_app() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  inmutables constant text[] := ARRAY['campo_historial', 'auditoria', 'comentario', 'texto_descartado'];
  -- Unicas tablas donde la aplicacion puede borrar filas: sesiones y verificaciones de Better Auth
  -- (no son datos de negocio, 6.1 punto 6), presencia de edicion, ventanas de limite de tasa y la bandeja
  -- de avisos (retencion diaria).
  con_borrado constant text[] := ARRAY['session', 'verification', 'edicion_activa', 'limite_tasa', 'notificacion'];
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
      -- Solo INSERT y SELECT: ni UPDATE, ni DELETE, ni TRUNCATE.
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app', t);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO app', t);
      -- UPDATE solo en las columnas necesarias: nunca la clave primaria ni los datos de creacion.
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
END;
$$;
--> statement-breakpoint
SELECT public.aplicar_permisos_app();
