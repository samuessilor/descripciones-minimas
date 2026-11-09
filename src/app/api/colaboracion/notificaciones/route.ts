/**
 * `GET /api/colaboracion/notificaciones?limite=8&soloNoLeidas=1&antes=<cursor>`: la bandeja del actor.
 * Es un GET (no una Server Action) a proposito: la campana lo consulta con el intervalo `SONDEO.campana` (sondeo.ts) y las
 * Server Actions se ejecutan de una en una, asi que un sondeo no debe hacer cola delante de un guardado.
 * La campana es tambien la unica via por la que llegan los cambios que no suben `referencia.version` (asignaciones,
 * solicitud de reapertura, comentarios): ver la limitacion aceptada en el encabezado de sondeo.ts.
 */
import { listarNotificaciones } from '@/server/acciones/comentarios-y-bandeja';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const p = new URL(request.url).searchParams;
    const limite = Number(p.get('limite') ?? 8);
    return json(
      await listarNotificaciones(ctx, {
        soloNoLeidas: p.get('soloNoLeidas') === '1',
        limite: Number.isFinite(limite) ? Math.min(Math.max(Math.trunc(limite), 1), 50) : 8,
        antes: p.get('antes'),
      }),
    );
  } catch (e) {
    return respuestaDeError(e);
  }
}
