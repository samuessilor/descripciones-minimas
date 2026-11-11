/**
 * `eliminarReferencia` (reunion 2026-11-10): el administrador y la supervisora general pueden ELIMINAR una referencia, cerrada o
 * pendiente (una creada por error, de prueba o duplicada). Es distinto de archivar: archivar la oculta pero conserva el codigo
 * reservado y todo su historial; eliminar la borra con TODO lo suyo (historial por campo, comentarios, pendientes, avisos y fotos)
 * y libera el codigo.
 *
 * El historial es de solo escritura (trigger): el borrado pasa por `public.eliminar_referencia()` (migracion 0015), una funcion de
 * la base que declara el permiso solo dentro de su propia transaccion. Aqui se exige el permiso, se confirma que la referencia
 * existe, se llama a la funcion y se deja UNA fila de auditoria que conserva quien era (codigo, nombre, estado, tipo) y cuanto se
 * llevo, porque la referencia deja de existir.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { referencia } from '@/db/esquema';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { exigir } from '../politicas/exigir';
import { llamarBorrado, mensajeDeBase } from '../sql';
import { ErrorAccion } from './resultado';
import { parsear } from './validacion';

export interface ResultadoEliminarReferencia {
  ok: true;
  codigo: string;
  nombreProducto: string;
  historial: number;
}

export async function eliminarReferencia(ctx: Contexto, entrada: unknown): Promise<ResultadoEliminarReferencia> {
  exigir(ctx.actor, 'supervisar');
  const { referenciaId } = parsear(z.object({ referenciaId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [f] = await tx.select().from(referencia).where(eq(referencia.id, referenciaId)).for('update').limit(1);
    if (!f) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa referencia.');
    let resumen;
    try {
      resumen = await llamarBorrado(tx, 'eliminar_referencia', f.id);
    } catch (err) {
      if (mensajeDeBase(err).includes('referencia_no_existe')) throw new ErrorAccion('NO_ENCONTRADO', 'Esa referencia ya no existe.');
      throw err;
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'eliminar_referencia',
      entidad: 'referencia',
      entidadId: f.id,
      detalle: {
        codigo: f.codigo,
        nombreProducto: f.nombreProducto,
        tipo: f.tipoProducto,
        estado: f.estado,
        archivada: f.archivadaEn !== null,
        partida: f.partida,
        historial: resumen.historial ?? 0,
        comentarios: resumen.comentarios ?? 0,
        asignaciones: resumen.asignaciones ?? 0,
        fotos: resumen.fotos ?? 0,
        llavesFotos: resumen.llaves ?? [], // el almacen no tiene borrado: queda constancia de cuales archivos quedaron huerfanos
      },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, codigo: f.codigo, nombreProducto: f.nombreProducto, historial: Number(resumen.historial ?? 0) };
  });
}
