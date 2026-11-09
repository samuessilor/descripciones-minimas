/** `GET /api/referencias/[id]/estado`: version, quien edita y version de cada campo (D-17). `no-store`. */
import { estadoFicha } from '@/server/acciones/estado-ficha';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    return json(await estadoFicha(await contextoDeAccion(), { referenciaId: id }));
  } catch (e) {
    return respuestaDeError(e);
  }
}
