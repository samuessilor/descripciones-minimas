/** Ayudas de las pruebas de acceso: dar usuario y contrasena a las cuentas del escenario. */
import { eq } from 'drizzle-orm';
import { account, usuario } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { hashearClave } from '@/server/claves';

export const CLAVE_PRUEBA = 'clave-de-prueba-123';

let hashUnico: string | undefined;

/** Un solo hash para todas las cuentas de prueba: cada una lleva su sal y calcularlo cuesta ~100 ms. */
async function hashDePrueba(clave: string): Promise<string> {
  if (clave !== CLAVE_PRUEBA) return hashearClave(clave);
  hashUnico ??= await hashearClave(CLAVE_PRUEBA);
  return hashUnico;
}

/** Deja la cuenta lista para entrar: `username` + contrasena (por defecto `CLAVE_PRUEBA`). */
export async function conCredenciales(db: Db, usuarioId: string, username: string, clave: string = CLAVE_PRUEBA): Promise<void> {
  await db.update(usuario).set({ username }).where(eq(usuario.id, usuarioId));
  const password = await hashDePrueba(clave);
  const [ya] = await db.select({ id: account.id }).from(account).where(eq(account.userId, usuarioId)).limit(1);
  if (ya) await db.update(account).set({ password }).where(eq(account.id, ya.id));
  else await db.insert(account).values({ accountId: usuarioId, providerId: 'credential', userId: usuarioId, password });
}
