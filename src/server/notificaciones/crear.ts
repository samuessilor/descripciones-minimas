/**
 * Alta de una notificacion en la bandeja (fuente de verdad del pendiente, A6/14): campana y «Para mi».
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
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

/**
 * Tipos que se AGRUPAN por defecto: repetir la misma accion sobre la misma ficha (corregir la respuesta del area,
 * volver a pedir la reapertura) no debe llenar la bandeja de avisos iguales. Los demas tipos son hechos distintos
 * cada vez (un comentario, un cierre) y no se agrupan; `asignacion` se agrupa solo si el llamador lo pide
 * (cuando la aduana edita su solicitud), no cuando alguien reenvia una ficha.
 */
const AGRUPABLES: ReadonlySet<TipoNotificacion> = new Set(['respuesta', 'reapertura_solicitada']);

/**
 * Crea el aviso, o lo renueva: si `agrupar` (por defecto, segun el tipo) y esa persona ya tiene SIN LEER un aviso
 * del mismo tipo sobre la misma ficha (y la misma asignacion, si la hay), se actualizan su titulo y su hora en vez de
 * insertar otro. Si el anterior ya se leyo, se crea uno nuevo: la persona ya lo vio y esto es novedad.
 *
 * DECISION ACEPTADA: la clave de agrupacion es (usuario, tipo, ficha, asignacion) y NO incluye al actor. Si dos
 * personas distintas disparan el mismo aviso sobre la misma ficha antes de que se lea, queda uno solo y el titulo
 * (que nombra a quien actuo) pasa a ser el del ultimo; el detalle sigue en la asignacion y en el historial.
 *
 * CONCURRENCIA: el llamador corre dentro de la transaccion que tiene bloqueada la ficha (`FOR UPDATE`, igual que
 * toda escritura sobre ella), asi que dos llamadas simultaneas sobre la misma ficha se serializan y la segunda ve el
 * aviso de la primera. Por eso basta buscar-y-actualizar, sin indice unico. Llamarla SIN ese bloqueo y con `agrupar`
 * podria duplicar. Marcar un aviso como leido NO toma ese bloqueo (corre en otra transaccion), asi que la persona
 * puede leerlo entre el SELECT y el UPDATE: por eso el UPDATE vuelve a exigir `leida_en IS NULL` y, si ya no afecta
 * ninguna fila, se cae al INSERT (la novedad llega como aviso nuevo y sin leer, no escondida bajo uno ya leido).
 */
export async function crearNotificacion(
  ej: Ejecutor,
  n: {
    usuarioId: string;
    tipo: TipoNotificacion;
    referenciaId: string;
    titulo: string;
    asignacionId?: string | null;
    creadaEn?: Date;
    agrupar?: boolean;
  },
): Promise<string> {
  const asignacionId = n.asignacionId ?? null;
  if (n.agrupar ?? AGRUPABLES.has(n.tipo)) {
    const [previa] = await ej
      .select({ id: notificacion.id })
      .from(notificacion)
      .where(
        and(
          eq(notificacion.usuarioId, n.usuarioId),
          eq(notificacion.tipo, n.tipo),
          eq(notificacion.referenciaId, n.referenciaId),
          asignacionId ? eq(notificacion.asignacionId, asignacionId) : isNull(notificacion.asignacionId),
          isNull(notificacion.leidaEn),
        ),
      )
      .orderBy(desc(notificacion.creadaEn))
      .limit(1);
    if (previa) {
      const [renovada] = await ej
        .update(notificacion)
        .set({ titulo: n.titulo, creadaEn: n.creadaEn ?? new Date() })
        .where(and(eq(notificacion.id, previa.id), isNull(notificacion.leidaEn)))
        .returning({ id: notificacion.id });
      if (renovada) return renovada.id;
      // La leyeron en medio: se sigue al INSERT.
    }
  }

  const [fila] = await ej
    .insert(notificacion)
    .values({
      usuarioId: n.usuarioId,
      tipo: n.tipo,
      referenciaId: n.referenciaId,
      titulo: n.titulo,
      asignacionId,
      ...(n.creadaEn ? { creadaEn: n.creadaEn } : {}),
    })
    .returning({ id: notificacion.id });
  return fila?.id ?? '';
}
