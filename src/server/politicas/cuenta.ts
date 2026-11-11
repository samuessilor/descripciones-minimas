/** Lecturas de «Mi cuenta»: solo lo del propio actor (la lista de sesiones abiertas se quito el 2026-11-10). */
import { eq } from 'drizzle-orm';
import { usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { Actor } from './actor';

export interface MisPreferencias {
  atajosTeclado: boolean;
  ultimoIngreso: string | null;
  encargado: string | null;
}

export async function misPreferencias(ej: Ejecutor, actor: Actor): Promise<MisPreferencias> {
  const [u] = await ej
    .select({ atajosTeclado: usuario.atajosTeclado, ultimoIngreso: usuario.ultimoIngreso, encargado: usuario.encargado })
    .from(usuario)
    .where(eq(usuario.id, actor.usuarioId))
    .limit(1);
  return {
    atajosTeclado: u?.atajosTeclado ?? true,
    ultimoIngreso: u?.ultimoIngreso?.toISOString() ?? null,
    encargado: u?.encargado ?? null,
  };
}
