/** Preferencia de la persona para los atajos de teclado del buscador (SPEC 10.1, WCAG 2.1.4). */
import { eq } from 'drizzle-orm';
import { usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export async function atajosDeTecladoActivos(ej: Ejecutor, usuarioId: string): Promise<boolean> {
  const [u] = await ej.select({ atajos: usuario.atajosTeclado }).from(usuario).where(eq(usuario.id, usuarioId)).limit(1);
  return u?.atajos ?? true;
}
