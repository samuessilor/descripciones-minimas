/**
 * Alta de una notificacion en la bandeja (fuente de verdad del pendiente, A6/14). Devuelve el id para
 * que quien la crea pueda colgarle el correo del outbox (`notificaciones/avisar.ts`).
 */
import { notificacion } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export type TipoNotificacion =
  | 'asignacion'
  | 'recordatorio'
  /** Alguien termino su parte («Listo por mi parte»). */
  | 'respuesta'
  | 'clasificada'
  | 'reabierta'
  | 'reapertura_solicitada'
  | 'cambio_en_mi_campo'
  | 'comentario';

export async function crearNotificacion(
  ej: Ejecutor,
  n: {
    usuarioId: string;
    tipo: TipoNotificacion;
    referenciaId: string;
    titulo: string;
    asignacionId?: string | null;
    creadaEn?: Date;
  },
): Promise<string> {
  const [fila] = await ej
    .insert(notificacion)
    .values({
      usuarioId: n.usuarioId,
      tipo: n.tipo,
      referenciaId: n.referenciaId,
      titulo: n.titulo,
      asignacionId: n.asignacionId ?? null,
      ...(n.creadaEn ? { creadaEn: n.creadaEn } : {}),
    })
    .returning({ id: notificacion.id });
  return fila?.id ?? '';
}
