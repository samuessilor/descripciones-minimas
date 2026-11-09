/**
 * `POST /api/referencias/[id]/conflicto` con `{ campo, opcion: 'dejar'|'usar_mio'|'combinar', valor, motivo? }`:
 * las tres salidas de un choque de edicion (SPEC 9.5, `resolverConflicto`), por `fetch` por la misma razon que el
 * guardado de un campo.
 */
import { resolverConflicto } from '@/server/acciones/resolver-conflicto';
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
    const r = await comoResultado(() => resolverConflicto(ctx, { ...cuerpo, referenciaId: id }));
    if (!r.ok && r.codigo === 'ERROR_INTERNO') return json(r, 500);
    return json(r);
  } catch (e) {
    return respuestaDeError(e);
  }
}
