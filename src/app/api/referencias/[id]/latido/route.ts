/**
 * `POST /api/referencias/[id]/latido` con `{ campo, terminar? }`: presencia (D-17). Al enfocar un campo se envia un
 * primer latido corto y luego uno cada `LATIDO_EDICION_MS` (`edicion_activa.hasta = ahora + VIGENCIA_LATIDO_MS`, ver
 * sondeo.ts y estado-ficha.ts: las cifras viven alli); `terminar: true` lo retira al salir del campo sin
 * haber escrito. Es un AVISO, no un candado. Va por `fetch` para no esperar detras de los guardados.
 */
import { latidoEdicion, terminarEdicion } from '@/server/acciones/estado-ficha';
import { ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await contextoDeAccion();
    const cuerpo = (await request.json().catch(() => null)) as { campo?: unknown; terminar?: unknown } | null;
    if (!cuerpo || typeof cuerpo.campo !== 'string') throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.');
    if (cuerpo.terminar === true) return json(await terminarEdicion(ctx, { referenciaId: id, campo: cuerpo.campo }));
    return json(await latidoEdicion(ctx, { referenciaId: id, campo: cuerpo.campo }));
  } catch (e) {
    return respuestaDeError(e);
  }
}
