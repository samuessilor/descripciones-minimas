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
  preferenciaAviso: 'inmediato' | 'solo_bandeja';
  atajosTeclado: boolean;
  ultimoIngreso: string | null;
}

export async function misPreferencias(ej: Ejecutor, actor: Actor): Promise<MisPreferencias> {
  const [u] = await ej
    .select({ preferenciaAviso: usuario.preferenciaAviso, atajosTeclado: usuario.atajosTeclado, ultimoIngreso: usuario.ultimoIngreso })
    .from(usuario)
    .where(eq(usuario.id, actor.usuarioId))
    .limit(1);
  return {
    preferenciaAviso: (u?.preferenciaAviso as MisPreferencias['preferenciaAviso']) ?? 'inmediato',
    atajosTeclado: u?.atajosTeclado ?? true,
    ultimoIngreso: u?.ultimoIngreso?.toISOString() ?? null,
  };
}
