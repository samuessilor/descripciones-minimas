/**
 * `GET /api/referencias/[id]`: la ficha tal como la ve quien pregunta (valores con autor y fecha, semaforo, fotos).
 * La pantalla lo usa para refrescar tras guardar y cuando el sondeo dice que cambio la version. Va por `fetch`
 * (no por Server Action) para no hacer fila detras de los guardados: Next ejecuta las acciones una por una.
 * Ficha ajena o inexistente => 404 (13.2). `no-store`.
 */
import { listarAdjuntos } from '@/server/acciones/adjuntos';
import { json, respuestaDeError } from '@/server/http';
import { vistaFicha } from '@/server/politicas/referencias';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await contextoDeAccion();
    const ahora = new Date();
    const ficha = await vistaFicha(ctx.db, ctx.actor, id, ahora);
    const adjuntos = await listarAdjuntos(ctx.db, ctx.actor, id, ahora);
    return json({ ficha, adjuntos });
  } catch (e) {
    return respuestaDeError(e);
  }
}
