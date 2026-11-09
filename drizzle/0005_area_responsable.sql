-- Migracion 0005: areas fijas y «Área responsable» de la referencia (reunion con el area, 2026-10-29, P4/C1/C2).
-- Solo datos: el area responsable vive en `referencia.datos` y en `campo_historial` como cualquier campo de la ficha,
-- y `usuario.area` ya existia (texto libre). Generada con `drizzle-kit generate --custom`.
--
-- 1) `usuario.area` pasa al catalogo fijo (Consumibles, Mantenimiento, Instrumentos, Marketing). «Insumos» era el
--    nombre viejo de Consumibles. Lo que no corresponde a ninguna area queda vacio (era solo informativo) y las
--    cuentas de agencia no tienen area interna.
UPDATE "usuario"
   SET "area" = CASE
     WHEN "organizacion_tipo" = 'agencia' THEN NULL
     WHEN lower(translate(trim("area"), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) IN ('consumibles', 'consumible', 'insumos', 'insumo') THEN 'Consumibles'
     WHEN lower(translate(trim("area"), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) = 'mantenimiento' THEN 'Mantenimiento'
     WHEN lower(translate(trim("area"), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) = 'instrumentos' THEN 'Instrumentos'
     WHEN lower(translate(trim("area"), 'ÁÉÍÓÚáéíóú', 'AEIOUaeiou')) = 'marketing' THEN 'Marketing'
     ELSE NULL
   END
 WHERE "area" IS NOT NULL;--> statement-breakpoint

-- 2) Las referencias que ya existian toman como area responsable la de quien las creo (si tiene). Queda como hecho del
--    sistema en el historial inmutable (version 1 del campo) y en la proyeccion `datos`, igual que `aplicarEscritura`.
--    Las que no tienen de donde sacarla quedan con el campo pendiente: el area la elige en la ficha.
WITH "faltan" AS (
  SELECT r."id", u."id" AS "autor", u."rol", u."organizacion_id" AS "org", u."area"
    FROM "referencia" r
    JOIN "usuario" u ON u."id" = r."creada_por"
   WHERE r."datos" -> 'area_responsable' IS NULL
     AND u."area" IS NOT NULL
), "hechos" AS (
  INSERT INTO "campo_historial" ("referencia_id", "campo", "version_campo", "tipo_evento", "valor", "motivo", "autor_id", "rol", "organizacion_id", "origen")
  SELECT f."id", 'area_responsable', 1, 'sistema', to_jsonb(f."area"), 'Área de quien creó la referencia (migración 0005).', f."autor", f."rol", f."org", 'sistema'
    FROM "faltan" f
  RETURNING "referencia_id"
)
UPDATE "referencia" r
   SET "datos" = r."datos" || jsonb_build_object('area_responsable', jsonb_build_object(
         'v', f."area", 'n', 1, 'a', f."autor", 'o', f."org",
         't', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
       "version" = r."version" + 1
  FROM "faltan" f
 WHERE r."id" = f."id"
   AND r."id" IN (SELECT "referencia_id" FROM "hechos");
