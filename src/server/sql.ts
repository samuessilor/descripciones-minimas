/**
 * Utilidades para SQL crudo (`db.execute`) y las funciones de borrado de la base (migracion 0015).
 * PGlite, `pg` y Neon devuelven `{ rows }`; se tolera tambien un arreglo directo.
 */
import { sql } from 'drizzle-orm';
import type { Ejecutor } from '@/db/tipos';

export function filasDe<T>(resultado: unknown): T[] {
  if (Array.isArray(resultado)) return resultado as T[];
  return ((resultado as { rows?: T[] } | null)?.rows ?? []) as T[];
}

/** Lo que devuelven `eliminar_referencia`, `eliminar_usuario` y `eliminar_organizacion` (JSON con cuanto borraron). */
export type ResumenBorrado = Record<string, unknown>;

/** Mensaje completo de un error de la base (el controlador envuelve el original en `cause`). */
export function mensajeDeBase(err: unknown): string {
  const partes: string[] = [];
  let actual: unknown = err;
  for (let i = 0; i < 6 && actual; i++) {
    const x = actual as { message?: string; cause?: unknown };
    if (x.message) partes.push(x.message);
    actual = x.cause;
  }
  return partes.join(' | ');
}

/** Llama a una de las funciones de borrado y devuelve su resumen. Los errores `P0001`/`P0002` llevan una palabra clave en el mensaje. */
export async function llamarBorrado(ej: Ejecutor, funcion: 'eliminar_referencia' | 'eliminar_usuario' | 'eliminar_organizacion', id: string): Promise<ResumenBorrado> {
  const r = await ej.execute(sql`select ${sql.raw(`public.${funcion}`)}(${id}::uuid) as r`);
  const fila = filasDe<{ r: ResumenBorrado | string }>(r)[0];
  const valor = fila?.r;
  return (typeof valor === 'string' ? (JSON.parse(valor) as ResumenBorrado) : valor) ?? {};
}
