/**
 * `GET /api/cron/retencion`: depuracion diaria de tablas operativas (avisos viejos, ventanas de limite de tasa,
 * presencia de edicion vencida, sesiones y verificaciones vencidas). La dispara el cron de `vercel.json`
 * (lunes a viernes, 19:00 UTC = 14:00 Bogota; en Hobby el minuto exacto varia hasta una hora).
 *
 * No usa sesion: el proxy deja pasar `/api/cron/*` y la autorizacion es el secreto. Vercel envia
 * `Authorization: Bearer <CRON_SECRET>` cuando la variable existe en el proyecto. FALLA CERRADO: sin
 * `CRON_SECRET` definido, o con menos de 16 caracteres, responde 503 y no borra nada; con un secreto ausente o
 * errado en la peticion, 401. La longitud se valida aqui y no en `config.ts` para que un secreto mal pegado apague
 * solo la retencion y no toda la aplicacion.
 */
import { getDb } from '@/db';
import { getConfig } from '@/server/config';
import { json, respuestaDeError, secretoValido } from '@/server/http';
import { ejecutarRetencion } from '@/server/retencion';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Longitud minima del secreto; un valor mas corto se trata como no configurado. */
const LONGITUD_MINIMA_SECRETO = 16;

export async function GET(request: Request): Promise<Response> {
  try {
    const secreto = getConfig().CRON_SECRET;
    if (!secreto || secreto.length < LONGITUD_MINIMA_SECRETO) {
      return json(
        { ok: false, codigo: 'NO_CONFIGURADO', mensaje: `La retención no está activa: secreto no configurado (CRON_SECRET de al menos ${LONGITUD_MINIMA_SECRETO} caracteres).` },
        503,
      );
    }
    if (!secretoValido(request.headers.get('authorization'), `Bearer ${secreto}`)) {
      return json({ ok: false, codigo: 'SIN_PERMISO', mensaje: 'No autorizado.' }, 401);
    }
    const inicio = Date.now();
    const resultado = await ejecutarRetencion(getDb());
    const ms = Date.now() - inicio;
    // El registro durable es la fila de auditoria; esto ayuda mientras dure el registro de la funcion en Vercel.
    console.log('[retencion]', JSON.stringify({ ...resultado, ms }));
    return json({ ok: true, ...resultado, ms });
  } catch (e) {
    return respuestaDeError(e);
  }
}
