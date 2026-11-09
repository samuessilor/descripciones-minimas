/** Lectura de catalogos administrables (listas de la ficha). Solo valores activos, por orden. */
import { and, asc, eq } from 'drizzle-orm';
import { catalogoItem } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export type NombreCatalogo = 'unidad_medida' | 'aspecto_fisico' | 'sugerencia_empaque';

export async function opcionesDeCatalogo(ej: Ejecutor, catalogo: NombreCatalogo): Promise<string[]> {
  const filas = await ej
    .select({ valor: catalogoItem.valor })
    .from(catalogoItem)
    .where(and(eq(catalogoItem.catalogo, catalogo), eq(catalogoItem.activo, true)))
    .orderBy(asc(catalogoItem.orden), asc(catalogoItem.valor));
  return filas.map((f) => f.valor);
}
