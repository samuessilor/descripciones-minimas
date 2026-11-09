/**
 * `POST /api/referencias/[id]/campos` con `{ campo, valor, versionEsperada, motivo? }`: guarda UN campo (SPEC 12.4
 * `guardarCampo`). Es la misma operacion de la Server Action `guardarCampoAccion`, por `fetch`: Next ejecuta las
 * Server Actions de una pagina una por una, y un guardado no debe esperar detras de otras acciones de la pantalla
 * (la zona de aduana, el historial). Autentica y autoriza dentro de `guardarCampo`; `409` en conflicto.
 */
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { comoResultado, ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await contextoDeAccion();
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!cuerpo || typeof cuerpo !== 'object') throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.');
    // Contrato `Resultado` como en las Server Actions: los errores esperados (validacion, conflicto, motivo...) van
    // con 200 y `ok: false`; solo la sesion vencida y los fallos inesperados usan un estado HTTP de error.
    const r = await comoResultado(() => guardarCampo(ctx, { ...cuerpo, referenciaId: id }));
    if (!r.ok && r.codigo === 'ERROR_INTERNO') return json(r, 500);
    return json(r);
  } catch (e) {
    return respuestaDeError(e);
  }
}
