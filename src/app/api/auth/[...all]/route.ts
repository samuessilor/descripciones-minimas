/**
 * Puerta HTTP de Better Auth. Se expone SOLO lo que la aplicacion usa desde el navegador (`POST /sign-out`);
 * la lista y el porque estan en `server/auth-rutas.ts`. Todo lo demas responde 404.
 */
import { getAuth } from '@/server/auth-app';
import { rutaAuthPermitida } from '@/server/auth-rutas';
import { json } from '@/server/http';

export const dynamic = 'force-dynamic';

async function manejar(request: Request): Promise<Response> {
  if (!rutaAuthPermitida(request.method, new URL(request.url).pathname)) {
    return json({ ok: false, codigo: 'NO_ENCONTRADO' }, 404);
  }
  return getAuth().handler(request);
}

export const GET = manejar;
export const POST = manejar;
