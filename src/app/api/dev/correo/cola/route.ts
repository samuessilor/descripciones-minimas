/** SOLO DESARROLLO: estado del outbox (`entrega_correo`) para ver y probar los reintentos. */
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { entregaCorreo } from '@/db/esquema';
import { contarCola } from '@/server/correo/despachar';
import { json, soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const url = new URL(request.url);
  const para = url.searchParams.get('para')?.toLowerCase();
  const limite = Math.min(Number(url.searchParams.get('limite') ?? 30) || 30, 200);
  const db = getDb();
  const consulta = db.select().from(entregaCorreo);
  const filas = await (para ? consulta.where(eq(entregaCorreo.destinatario, para)) : consulta)
    .orderBy(desc(entregaCorreo.creadaEn))
    .limit(limite);
  return json({
    cola: await contarCola(db),
    filas: filas.map((f) => ({
      id: f.id,
      para: f.destinatario,
      plantilla: f.plantilla,
      asunto: f.asunto,
      estado: f.estado,
      intentos: f.intentos,
      proximoIntento: f.proximoIntento.toISOString(),
      ultimoError: f.ultimoError,
      enviadoEn: f.enviadoEn ? f.enviadoEn.toISOString() : null,
      clave: f.claveIdempotencia,
    })),
  });
}
