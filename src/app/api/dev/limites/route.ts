/**
 * SOLO DESARROLLO: reinicia los contadores de limite de tasa. Las pruebas E2E piden muchos enlaces al
 * mismo correo en pocos segundos y el limite (5 por 15 min, 30 s de espera) es una regla del producto.
 */
import { limiteTasa } from '@/db/esquema';
import { getDb } from '@/db';
import { json, soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  await getDb().delete(limiteTasa);
  return json({ ok: true });
}
