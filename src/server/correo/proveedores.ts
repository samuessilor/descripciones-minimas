/**
 * Proveedores reales de correo. NO se pudieron probar contra las cuentas reales (sin credenciales):
 * se escribieron contra la API documentada de cada uno y se prueban contra dobles locales que hablan
 * el mismo protocolo (`tests/integracion/proveedores-correo.test.ts`). Verificar con una cuenta real
 * antes de salir en vivo (SPEC 22.5).
 */
import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { Mailer, MensajeCorreo } from './tipos';

/**
 * Resend: la clave de idempotencia viaja en la cabecera `Idempotency-Key` (dura 24 h; la misma clave con
 * otro cuerpo responde 409, por eso el cuerpo de cada fila del outbox es inmutable). La API de envio solo
 * confirma ACEPTACION, no entrega (RV-18).
 */
export function crearMailerResend(apiKey: string, remitente: string): Mailer {
  const cliente = new Resend(apiKey);
  return {
    nombre: 'resend',
    async enviar(m: MensajeCorreo) {
      const { error } = await cliente.emails.send(
        { from: remitente, to: [m.para], subject: m.asunto, text: m.texto, html: m.html },
        m.claveIdempotencia ? { idempotencyKey: m.claveIdempotencia } : undefined,
      );
      if (error) {
        const estado = 'statusCode' in error && error.statusCode ? ` (HTTP ${error.statusCode})` : '';
        throw new Error(`Resend${estado}: ${error.name}: ${error.message}`);
      }
    },
  };
}

/** SMTP con nodemailer. Sin idempotencia del lado del servidor: la cola evita duplicar con su reclamo atomico. */
export function crearMailerSmtp(url: string, remitente: string): Mailer {
  // Los tiempos de espera viajan como parametros de la URL (nodemailer los lee): un servidor colgado no bloquea la cola.
  const sep = url.includes('?') ? '&' : '?';
  const transporte = nodemailer.createTransport(`${url}${sep}connectionTimeout=10000&greetingTimeout=10000&socketTimeout=15000`);
  return {
    nombre: 'smtp',
    async enviar(m: MensajeCorreo) {
      const info = await transporte.sendMail({
        from: remitente,
        to: m.para,
        subject: m.asunto,
        text: m.texto,
        html: m.html,
        ...(m.claveIdempotencia ? { headers: { 'X-Entity-Ref-ID': m.claveIdempotencia } } : {}),
      });
      if (info.rejected && info.rejected.length > 0) {
        throw new Error(`SMTP rechazó al destinatario: ${info.rejected.join(', ')}`);
      }
    },
  };
}
