import { and, eq } from 'drizzle-orm';
import { referencia } from '@/db/esquema';
import type { Actor } from '@/server/politicas/actor';
import { condicionVisible } from '@/server/politicas/referencias';
import type { Escenario } from './ayudas';

/** ¿Ve `actor` esta ficha? Usa la MISMA condicion SQL de visibilidad que las lecturas reales (13.2, 8.3 regla 10). */
export async function fichaVisibleParaTest(e: Escenario, referenciaId: string, actor: Actor, ahora: Date): Promise<boolean> {
  const filas = await e.db
    .select({ id: referencia.id })
    .from(referencia)
    .where(and(eq(referencia.id, referenciaId), condicionVisible(actor, ahora)));
  return filas.length === 1;
}
