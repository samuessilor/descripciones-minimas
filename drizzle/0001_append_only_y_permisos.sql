-- Migracion escrita A MANO (no generada). SPEC 6.2 "Tablas append-only", D-31, RV-12.
--
-- 1) Inmutabilidad: `campo_historial`, `auditoria`, `comentario` y `texto_descartado` solo admiten
--    INSERT. Un trigger POR SENTENCIA (PostgreSQL solo admite TRUNCATE en triggers de nivel
--    sentencia; la receta FOR EACH ROW no se puede crear) lanza una excepcion ante UPDATE, DELETE
--    o TRUNCATE. Funciona igual en PGlite y en Postgres real.
--
-- 2) Permisos: en produccion hay DOS roles, `migrador` (duenio de las tablas; solo CI, con la URL
--    directa) y `app` (no duenio; la DATABASE_URL de la aplicacion). Sin separar duenio y aplicacion
--    el REVOKE no protege: el duenio puede DISABLE TRIGGER, DROP TRIGGER o re-otorgarse permisos.
--    `aplicar_permisos_app()` es IDEMPOTENTE y no hace nada si el rol `app` aun no existe; se
--    invoca al final de esta migracion y despues de cada `db:migrate` (tablas nuevas incluidas).
--    PGlite corre como superusuario y no prueba permisos: alli se prueba el trigger; los permisos
--    se prueban en el job `db-real` conectando COMO `app` (17.1).

CREATE OR REPLACE FUNCTION public.rechazar_cambio() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tabla de solo escritura: % no admite %', TG_TABLE_NAME, TG_OP
    USING HINT = 'Los hechos se agregan; nunca se modifican ni se borran.';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER campo_historial_solo_escritura
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.campo_historial
  FOR EACH STATEMENT EXECUTE FUNCTION public.rechazar_cambio();
--> statement-breakpoint
CREATE TRIGGER auditoria_solo_escritura
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION public.rechazar_cambio();
--> statement-breakpoint
CREATE TRIGGER comentario_solo_escritura
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.comentario
  FOR EACH STATEMENT EXECUTE FUNCTION public.rechazar_cambio();
--> statement-breakpoint
CREATE TRIGGER texto_descartado_solo_escritura
  BEFORE UPDATE OR DELETE OR TRUNCATE ON public.texto_descartado
  FOR EACH STATEMENT EXECUTE FUNCTION public.rechazar_cambio();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.aplicar_permisos_app() RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  inmutables constant text[] := ARRAY['campo_historial', 'auditoria', 'comentario', 'texto_descartado'];
  -- Unicas tablas donde la aplicacion puede borrar filas: sesiones y verificaciones de Better Auth
  -- (no son datos de negocio, 6.1 punto 6), presencia de edicion y ventanas de limite de tasa.
  con_borrado constant text[] := ARRAY['session', 'verification', 'edicion_activa', 'limite_tasa'];
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
         AND a.attname NOT IN ('id', 'creada_en', 'creado_en', 'creada_por', 'creado_por')
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
