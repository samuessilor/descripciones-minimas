import { getDb } from '@/db';
import { getConfig } from '../config';
import { crearMailerConsola } from './consola';
import { crearMailerResend, crearMailerSmtp } from './proveedores';
import type { Mailer } from './tipos';

export type { Mailer, MensajeCorreo } from './tipos';

/** Elige el proveedor segun el entorno: Resend, SMTP o consola (local sin credenciales). */
export function getMailer(): Mailer {
  const c = getConfig();
  if (c.RESEND_API_KEY) return crearMailerResend(c.RESEND_API_KEY, c.CORREO_REMITENTE);
  if (c.SMTP_URL) return crearMailerSmtp(c.SMTP_URL, c.CORREO_REMITENTE);
  if (c.NODE_ENV === 'production') {
    throw new Error('Falta configurar el correo: define RESEND_API_KEY o SMTP_URL (en produccion no se usa la consola).');
  }
  return crearMailerConsola(getDb());
}
