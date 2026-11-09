/**
 * Cola de correo, lado administracion (14, 10.4). La logica de despacho es de otro modulo; aqui solo se
 * LEE la cola y se hace una cosa: devolver a la cola un correo `fallido` o `abandonado` para que el
 * despachador lo tome de nuevo. El payload (asunto y cuerpos) es inmutable por fila: un reintento envia
 * exactamente lo mismo (14), asi que esta accion nunca lo toca.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { entregaCorreo } from '@/db/esquema';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion } from './resultado';
import { parsear } from './validacion';

export interface ResultadoReintento {
  ok: true;
  estadoAnterior: string;
}

/**
 * `fallido` -> `pendiente` (conserva los intentos hechos). `abandonado` -> `pendiente` con los intentos en
 * cero: tras el sexto fallo la cola se rindio, y reintentar a mano merece otro ciclo completo de esperas.
 * Es un solo UPDATE condicionado al estado: si el despachador lo tomo entre tanto (`enviando`) o ya salio
 * (`enviado`), no pasa nada y se informa.
 */
export async function reintentarCorreo(ctx: Contexto, entrada: unknown): Promise<ResultadoReintento> {
  if (!puede(ctx.actor, 'administrar')) throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador puede reintentar correos.');
  const { entregaId } = parsear(z.object({ entregaId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [antes] = await tx.select().from(entregaCorreo).where(eq(entregaCorreo.id, entregaId)).for('update').limit(1);
    if (!antes) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese correo.');
    if (antes.estado === 'enviado') throw new ErrorAccion('VALIDACION', 'Ese correo ya salió. No hace falta reintentarlo.');
    if (antes.estado === 'enviando') throw new ErrorAccion('VALIDACION', 'Ese correo se está enviando ahora mismo. Revisa en un minuto.');
    if (antes.estado === 'pendiente') throw new ErrorAccion('VALIDACION', 'Ese correo ya está en la cola esperando su turno.');
    const r = await tx
      .update(entregaCorreo)
      .set({
        estado: 'pendiente',
        proximoIntento: ahora,
        bloqueadoHasta: null,
        ...(antes.estado === 'abandonado' ? { intentos: 0 } : {}),
      })
      .where(and(eq(entregaCorreo.id, entregaId), inArray(entregaCorreo.estado, ['fallido', 'abandonado'])))
      .returning({ id: entregaCorreo.id });
    if (r.length === 0) throw new ErrorAccion('VALIDACION', 'Ese correo cambió de estado hace un momento. Recarga la lista.');
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'reintentar_correo',
      entidad: 'entrega_correo',
      entidadId: entregaId,
      detalle: { estadoAnterior: antes.estado, intentos: antes.intentos, ultimoError: antes.ultimoError, plantilla: antes.plantilla },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, estadoAnterior: antes.estado };
  });
}
