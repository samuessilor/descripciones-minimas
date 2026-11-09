/** Lecturas de «Mi cuenta»: solo lo del propio actor. */
import { eq } from 'drizzle-orm';
import { usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { Actor } from './actor';
import { sesionesDe, type SesionVista } from './administracion';

export interface SesionPropia extends SesionVista {
  esActual: boolean;
}

export async function misSesiones(ej: Ejecutor, actor: Actor): Promise<SesionPropia[]> {
  const filas = await sesionesDe(ej, actor.usuarioId);
  return filas.map((s) => ({ ...s, esActual: s.id === actor.sesionId }));
}

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
