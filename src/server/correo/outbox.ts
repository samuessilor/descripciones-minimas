/**
 * Outbox del correo (SPEC 14): la fila de `entrega_correo` nace en la MISMA transaccion que la
 * accion que la origina (asignacion, recordatorio...). Asi es imposible un "enviado a Brian" sin
 * pendiente para Brian, y un fallo del proveedor nunca revierte ni pierde el pendiente. Un
 * despachador desacoplado (`despachar.ts`) la entrega despues, con reintentos.
 */
import { eq } from 'drizzle-orm';
import { entregaCorreo } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { CorreoRenderizado } from './plantillas';

export interface EntradaOutbox {
  notificacionId?: string | null;
  destinatario: string;
  plantilla: string;
  /** Unica por correo logico: encolar dos veces la misma clave no duplica (idempotencia de la cola). */
  claveIdempotencia: string;
  contenido: CorreoRenderizado;
  /** Primer intento; por defecto, ahora. */
  proximoIntento?: Date;
  /** Fila nacida ya cerrada (p. ej. el correo del destinatario esta marcado como invalido). */
  estadoInicial?: { estado: 'abandonado'; ultimoError: string };
}

export async function encolarCorreo(ej: Ejecutor, e: EntradaOutbox): Promise<{ id: string; creado: boolean }> {
  const [fila] = await ej
    .insert(entregaCorreo)
    .values({
      notificacionId: e.notificacionId ?? null,
      destinatario: e.destinatario.trim().toLowerCase(),
      plantilla: e.plantilla,
      claveIdempotencia: e.claveIdempotencia,
      asunto: e.contenido.asunto,
      cuerpoTexto: e.contenido.texto,
      cuerpoHtml: e.contenido.html,
      ...(e.proximoIntento ? { proximoIntento: e.proximoIntento } : {}),
      ...(e.estadoInicial ? { estado: e.estadoInicial.estado, ultimoError: e.estadoInicial.ultimoError } : {}),
    })
    .onConflictDoNothing({ target: entregaCorreo.claveIdempotencia })
    .returning({ id: entregaCorreo.id });
  if (fila) return { id: fila.id, creado: true };
  const [existente] = await ej
    .select({ id: entregaCorreo.id })
    .from(entregaCorreo)
    .where(eq(entregaCorreo.claveIdempotencia, e.claveIdempotencia))
    .limit(1);
  return { id: existente?.id ?? '', creado: false };
}

/** Primer enlace http(s) de un texto: el dev lo guarda aparte para que las pruebas lo lean sin parsear HTML. */
export function extraerEnlace(texto: string): string | undefined {
  return /https?:\/\/[^\s<>"]+/.exec(texto)?.[0];
}
