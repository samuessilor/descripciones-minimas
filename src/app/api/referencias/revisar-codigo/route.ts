/**
 * `POST /api/referencias/revisar-codigo` con `{ codigo }`: revision en vivo del codigo mientras se escribe en
 * «Nueva referencia» (duplicado exacto y codigos parecidos). Por `fetch` y no por Server Action: una consulta que
 * se repite al teclear no debe pasar por el enrutador de acciones de Next. Solo informa; la creacion vuelve a
 * comprobar todo dentro de su transaccion.
 */
import { revisarCodigo } from '@/server/acciones/crear-referencia';
import { ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const cuerpo = (await request.json().catch(() => null)) as { codigo?: unknown } | null;
    if (!cuerpo || typeof cuerpo.codigo !== 'string') throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.');
    return json(await revisarCodigo(ctx, { codigo: cuerpo.codigo }));
  } catch (e) {
    return respuestaDeError(e);
  }
}
