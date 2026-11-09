/**
 * Envio inmediato tras una accion (SPEC 14): `after()` corre DESPUES de responder al usuario, asi que
 * "Enviado a Brian" no espera al proveedor de correo. Si el envio falla o la funcion se corta, la fila
 * sigue en el outbox y el despachador (cron / worker) la reintenta: nada se pierde.
 */
import { after } from 'next/server';
import { getDb } from '@/db';
import { getMailer } from './index';
import { despacharSinFallar } from './despachar';

export function programarEnvioInmediato(correoIds: readonly string[]): void {
  const ids = [...new Set(correoIds.filter(Boolean))];
  if (ids.length === 0) return;
  try {
    after(async () => {
      await despacharSinFallar({ db: getDb(), mailer: getMailer(), ids });
    });
  } catch (e) {
    // Fuera de un contexto de peticion (pruebas, scripts) `after` no existe: lo hara el despachador.
    console.warn('[correo] no se pudo programar el envio inmediato; lo tomara el despachador:', (e as Error).message);
  }
}
