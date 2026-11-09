/**
 * Mailer local (sin credenciales): imprime el correo en la consola del servidor y lo guarda en la
 * tabla `correo_dev`, de donde `GET /api/dev/correo` (solo desarrollo) lo entrega a las pruebas
 * E2E (12.2). NO usar en produccion.
 */
import { correoDev } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import type { Mailer, MensajeCorreo } from './tipos';

/**
 * Interruptor SOLO de desarrollo para simular la caida del proveedor de correo (lo mueve
 * `POST /api/dev/correo/falla`): el envio lanza un error y el despachador reintenta con espera creciente.
 */
const CLAVE_FALLA = Symbol.for('descripciones-minimas.correo.falla');
type ConFalla = typeof globalThis & { [CLAVE_FALLA]?: boolean };
export const fallaSimulada = {
  activa: (): boolean => (globalThis as ConFalla)[CLAVE_FALLA] === true,
  poner: (v: boolean): void => {
    (globalThis as ConFalla)[CLAVE_FALLA] = v;
  },
};

export function crearMailerConsola(db: Db, opciones: { silencioso?: boolean } = {}): Mailer {
  return {
    nombre: 'consola',
    async enviar(m: MensajeCorreo) {
      if (fallaSimulada.activa()) throw new Error('El proveedor de correo no responde (falla simulada en desarrollo).');
      await db.insert(correoDev).values({
        destinatario: m.para,
        asunto: m.asunto,
        cuerpoTexto: m.texto,
        cuerpoHtml: m.html,
        enlace: m.enlace ?? null,
      });
      if (!opciones.silencioso) {
        const barra = '─'.repeat(60);
        console.log(`\n${barra}\n[correo de desarrollo] Para: ${m.para}\nAsunto: ${m.asunto}\n${m.enlace ? `Enlace: ${m.enlace}\n` : ''}${barra}\n`);
      }
    },
  };
}

/** Mailer de pruebas: acumula en memoria. */
export function crearMailerMemoria(): Mailer & { enviados: MensajeCorreo[] } {
  const enviados: MensajeCorreo[] = [];
  return {
    nombre: 'consola',
    enviados,
    async enviar(m) {
      enviados.push(m);
    },
  };
}
