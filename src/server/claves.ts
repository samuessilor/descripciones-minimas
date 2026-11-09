/**
 * Contrasenas: generar una temporal, hashear y verificar. El hash es el de Better Auth (scrypt con sal propia),
 * asi la contrasena que guardamos es la misma que Better Auth comprueba al iniciar sesion. Nunca se guarda ni se
 * registra una contrasena en claro: solo se muestra UNA vez a quien la crea o la restablece.
 */
import { randomInt } from 'node:crypto';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

/** Sin 0/O, 1/l/I: se dicta o se copia a mano sin confundirse. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** `Kp7m-Qx4r-Tn9w`: 12 caracteres al azar (~70 bits) en tres grupos, faciles de leer en voz alta. */
export function generarClave(): string {
  const grupo = () => Array.from({ length: 4 }, () => ALFABETO[randomInt(ALFABETO.length)]).join('');
  return `${grupo()}-${grupo()}-${grupo()}`;
}

export const hashearClave = (clave: string): Promise<string> => hashPassword(clave);

export const verificarClave = (hash: string, clave: string): Promise<boolean> => verifyPassword({ hash, password: clave });
