/**
 * Clave de entrega cifrada (reunion 2026-11-10): el administrador necesita volver a ver la contrasena que se le entrego a cada
 * persona (usuario + contrasena), no solo restablecerla. La contrasena de verdad sigue siendo un hash (`account.password`); aqui se
 * guarda ADEMAS una copia cifrada de la que se entrego, que:
 *   - la lee solo el administrador (`verClaveEntrega`, con una fila de auditoria cada vez),
 *   - se reemplaza al restablecerla y se BORRA en cuanto la persona cambia la suya (deja de ser la de entrega),
 *   - no existe para las cuentas creadas fuera de la plataforma (los scripts de despliegue): ahi se restablece y queda guardada.
 *
 * Cifrado AES-256-GCM con una llave derivada (HKDF) de `BETTER_AUTH_SECRET`: sin ese secreto, que vive solo en Vercel, la base no
 * sirve para recuperar nada. Si el secreto cambia, las copias viejas ya no se descifran y se muestran como «no disponible».
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { claveEntrega } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { getConfig } from './config';

const VERSION = 'v2';

function llave(): Buffer {
  const secreto = getConfig().BETTER_AUTH_SECRET;
  return Buffer.from(hkdfSync('sha256', secreto, 'descripciones-minimas', 'clave-entrega-v1', 32));
}

/** `usuarioId` va como dato autenticado (AAD): una copia cifrada pegada en la fila de OTRA cuenta no se descifra. */
export function cifrarClave(clave: string, usuarioId: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', llave(), iv);
  c.setAAD(Buffer.from(usuarioId, 'utf8'));
  const cifrado = Buffer.concat([c.update(clave, 'utf8'), c.final()]);
  return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), cifrado.toString('base64')].join('.');
}

/** La clave en claro, o `null` si el texto esta alterado o se cifro con otro secreto. */
export function descifrarClave(cifrada: string, usuarioId: string): string | null {
  const [version, iv, tag, cifrado] = cifrada.split('.');
  if (version !== VERSION || !iv || !tag || !cifrado) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', llave(), Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(usuarioId, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(cifrado, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Guarda (o reemplaza) la clave de entrega de una cuenta. Va dentro de la transaccion que la crea o la restablece. */
export async function guardarClaveEntrega(tx: Ejecutor, usuarioId: string, clave: string, ahora: Date): Promise<void> {
  const cifrada = cifrarClave(clave, usuarioId);
  // Borrar e insertar (no UPDATE): `creada_en` es una columna de creacion que el rol `app` no puede actualizar.
  await tx.delete(claveEntrega).where(eq(claveEntrega.usuarioId, usuarioId));
  await tx.insert(claveEntrega).values({ usuarioId, cifrada, creadaEn: ahora });
}

/** La persona cambio su contrasena: la de entrega ya no es la vigente. */
export async function borrarClaveEntrega(tx: Ejecutor, usuarioId: string): Promise<void> {
  await tx.delete(claveEntrega).where(eq(claveEntrega.usuarioId, usuarioId));
}
