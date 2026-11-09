/**
 * `GET /api/referencias/[id]/estado`: version de la ficha y quien esta escribiendo (D-17). Lectura ligera: no devuelve la
 * version de cada campo (el cliente relee los campos cuando cambia `version`). `no-store`.
 */
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
