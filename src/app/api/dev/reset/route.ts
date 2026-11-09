/** SOLO DESARROLLO: borra y recrea la base local (esquema, migraciones y semillas) con el servidor en marcha. */
import { json, soloDesarrollo } from '@/server/http';
import { reiniciarBase } from '@/server/preparar-bd';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  // `?ejemplos=0`: solo la semilla minima (usuarios y 3 referencias TEST-*), la que esperan las pruebas E2E.
  const ejemplos = new URL(request.url).searchParams.get('ejemplos') !== '0';
  await reiniciarBase(undefined, { desarrollo: true, ejemplos });
  return json({ ok: true, mensaje: ejemplos ? 'Base local reiniciada con las referencias de ejemplo.' : 'Base local reiniciada (semilla minima).' });
}
