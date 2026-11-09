/** `GET /api/aduana/partidas?q=`: sugerencias del catalogo de partidas mientras se escribe (maximo 8). Lectura por GET. */
import { z } from 'zod';
import { ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { buscarPartidas } from '@/server/politicas/aduana';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const e = z.string().max(60).safeParse(new URL(request.url).searchParams.get('q') ?? '');
    if (!e.success) throw new ErrorAccion('VALIDACION', 'Escribe menos de 60 caracteres.');
    return json(await buscarPartidas(ctx.db, e.data));
  } catch (e) {
    return respuestaDeError(e);
  }
}
