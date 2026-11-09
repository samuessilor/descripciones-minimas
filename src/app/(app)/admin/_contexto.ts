import { puede } from '@/dominio/permisos';
import type { Contexto } from '@/server/politicas/actor';
import { exigirContexto } from '@/server/sesion';

/**
 * Contexto de una pagina de administracion, o `null` si quien entra no es administrador. El layout de /admin ya
 * muestra el aviso de permiso, pero las paginas hijas se ejecutan en paralelo con el: sin esta guarda, una pagina
 * intentaria leer y lanzaria `SIN_PERMISO` como error no controlado (E17).
 */
export async function contextoAdmin(): Promise<Contexto | null> {
  const ctx = await exigirContexto();
  return puede(ctx.actor, 'administrar') ? ctx : null;
}

/** Valor de un parametro de la URL como cadena (el primero si viene repetido). */
export function param(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === undefined || v === '' ? undefined : v;
}
