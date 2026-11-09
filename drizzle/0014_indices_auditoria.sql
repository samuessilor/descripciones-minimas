-- Indices del visor de auditoria (fecha, accion, persona y ficha). Solo se crean indices: la tabla sigue siendo append-only y no se toca ningun dato.
CREATE INDEX "auditoria_creado_en_idx" ON "auditoria" USING btree ("creado_en");--> statement-breakpoint
CREATE INDEX "auditoria_accion_idx" ON "auditoria" USING btree ("accion","id");--> statement-breakpoint
CREATE INDEX "auditoria_usuario_idx" ON "auditoria" USING btree ("usuario_id","id");--> statement-breakpoint
CREATE INDEX "auditoria_ficha_idx" ON "auditoria" USING btree (("detalle"->>'referenciaId')) WHERE ("detalle"->>'referenciaId') is not null;