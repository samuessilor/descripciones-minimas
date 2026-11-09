/** Interfaz `Mailer` (12.1): consola / Resend / SMTP son intercambiables. */
export interface MensajeCorreo {
  para: string;
  asunto: string;
  texto: string;
  html: string;
  /** Enlace principal (en desarrollo se guarda aparte para que las pruebas E2E lo lean). */
  enlace?: string;
  /** Clave de idempotencia hacia el proveedor (las de Resend duran 24 h; el cuerpo debe ser el mismo). */
  claveIdempotencia?: string;
}

export interface Mailer {
  readonly nombre: 'consola' | 'resend' | 'smtp';
  enviar(mensaje: MensajeCorreo): Promise<void>;
}
