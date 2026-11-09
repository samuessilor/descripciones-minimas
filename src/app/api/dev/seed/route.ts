/** SOLO DESARROLLO: siembra datos maestros y de desarrollo en la base local sin detener el servidor (D-30). */
import { json, soloDesarrollo } from '@/server/http';
import { prepararBase } from '@/server/preparar-bd';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  await prepararBase(undefined, { desarrollo: true, ejemplos: new URL(request.url).searchParams.get('ejemplos') !== '0' });
  return json({ ok: true, mensaje: 'Datos maestros y de desarrollo sembrados.' });
}
