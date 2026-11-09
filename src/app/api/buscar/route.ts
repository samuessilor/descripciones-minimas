/** `GET /api/buscar?q=`: buscador con lupa (SPEC 10.3, 12.4). Tokens AND con LIKE ... ESCAPE, maximo 8, solo lo visible. */
import { buscar } from '@/server/acciones/buscar';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return json(await buscar(ctx, { q }));
  } catch (e) {
    return respuestaDeError(e);
  }
}
