/**
 * SOLO DESARROLLO: simula la caida del proveedor de correo para ver los reintentos y la insignia
 * "El correo no se pudo entregar". `POST {"activa": true|false}`; `GET` dice como esta.
 * Mientras esta activa tambien fallan los correos de acceso (es el mismo proveedor).
 */
import { fallaSimulada } from '@/server/correo/consola';
import { json, soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  return json({ activa: fallaSimulada.activa() });
}

export async function POST(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const cuerpo = (await request.json().catch(() => ({}))) as { activa?: unknown };
  fallaSimulada.poner(cuerpo.activa === true);
  return json({ activa: fallaSimulada.activa() });
}
