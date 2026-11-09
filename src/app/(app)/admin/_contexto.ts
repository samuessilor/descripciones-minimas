import { puede, type Accion } from '@/dominio/permisos';
import type { Contexto } from '@/server/politicas/actor';
import { exigirContexto } from '@/server/sesion';

/**
 * Contexto de una pagina de administracion, o `null` si quien entra no tiene el permiso que la pagina exige
 * (`supervisar`: administrador y supervisora general; `administrar`: solo el administrador). La pagina debe pintar
 * `SinPermiso` cuando recibe `null`: el layout de /admin solo conoce el nivel de entrada, y las paginas hijas se
 * ejecutan en paralelo con el, asi que sin esta guarda una pagina leeria y lanzaria `SIN_PERMISO` como error no
 * controlado (E17) o quedaria en blanco.
 */
export async function contextoAdmin(accion: Extract<Accion, 'supervisar' | 'administrar'> = 'supervisar'): Promise<Contexto | null> {
  const ctx = await exigirContexto();
  return puede(ctx.actor, accion) ? ctx : null;
}

/** Valor de un parametro de la URL como cadena (el primero si viene repetido). */
export function param(valor: string | string[] | undefined): string | undefined {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === undefined || v === '' ? undefined : v;
}
