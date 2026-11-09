/**
 * Despachador del outbox de correo (SPEC 14). Lo llama Vercel Cron cada 5 min (o `npm run worker` en
 * desarrollo) con `Authorization: Bearer $CRON_SECRET`. Reclama hasta 50 filas con `FOR UPDATE SKIP LOCKED`,
 * envia, y deja el resultado por mensaje. Dos llamadas simultaneas jamas envian el mismo correo.
 */
import { getDb } from '@/db';
import { getConfig } from '@/server/config';
import { getMailer } from '@/server/correo';
import { contarCola, despachar } from '@/server/correo/despachar';
import { json, secretoValido } from '@/server/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const cabecera = request.headers.get('authorization');
  const token = cabecera?.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!secretoValido(token, getConfig().CRON_SECRET)) return json({ ok: false, codigo: 'SIN_PERMISO' }, 401);

  try {
    const db = getDb();
    const r = await despachar({ db, mailer: getMailer() });
    const cola = await contarCola(db);
    return json({
      ok: true,
      tomados: r.tomados,
      enviados: r.enviados,
      fallidos: r.fallidos,
      abandonados: r.abandonados,
      recuperados: r.recuperados,
      errores: r.filas
        .filter((f) => f.error)
        .slice(0, 10)
        .map((f) => ({ id: f.id, resultado: f.resultado, intentos: f.intentos, error: f.error })),
      cola,
    });
  } catch (e) {
    console.error('[cron] el despachador fallo:', e);
    return json({ ok: false, codigo: 'ERROR_INTERNO', mensaje: 'El despachador no pudo correr. Se reintenta en la siguiente pasada.' }, 500);
  }
}
