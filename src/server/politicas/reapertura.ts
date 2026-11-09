/**
 * Marca "Reabierta" (SPEC 8.1): la ficha esta EN_GESTION y su ultimo evento del sistema sobre
 * `clasificacion_finalizada` fue una reapertura (`NO`), es decir, no hay una clasificacion posterior.
 * Se deriva del historial inmutable; no se guarda aparte.
 */
import { and, desc, eq } from 'drizzle-orm';
import { campoHistorial } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export async function fueReabierta(ej: Ejecutor, referenciaId: string): Promise<boolean> {
  const [ultimo] = await ej
    .select({ valor: campoHistorial.valor })
    .from(campoHistorial)
    .where(
      and(
        eq(campoHistorial.referenciaId, referenciaId),
        eq(campoHistorial.campo, 'clasificacion_finalizada'),
        eq(campoHistorial.tipoEvento, 'sistema'),
      ),
    )
    .orderBy(desc(campoHistorial.id))
    .limit(1);
  return ultimo?.valor === 'NO';
}
