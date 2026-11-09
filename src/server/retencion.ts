/**
 * Retencion minima y segura (la dispara `GET /api/cron/retencion`, una vez por dia habil).
 *
 * Solo depura tablas OPERATIVAS que se acumulan sin valor de negocio: la bandeja de avisos, las ventanas del limite
 * de tasa, la presencia de edicion y las sesiones y verificaciones de Better Auth. NO toca el historial, los
 * comentarios, la auditoria ni los textos descartados: son hechos append-only (trigger + permisos, 0001) y la
 * medicion con un mes de uso alto (~51 MB en total) muestra que su volumen no amenaza ningun limite gratuito.
 *
 * Cada regla borra por LOTES acotados (`LIMIT` en una subconsulta por clave) y repite hasta vaciar lo vencido o
 * llegar a `MAX_LOTES`: una corrida nunca monopoliza la base ni la funcion, y lo que quede lo toma la del dia
 * siguiente. Es idempotente: correrla dos veces seguidas no hace nada la segunda vez.
 *
 * Los umbrales son conservadores a proposito: una sesion o verificacion vencida ya no sirve para nada, pero se
 * dejan unos dias por si hay que investigar un acceso; un aviso leido se conserva un mes y uno sin leer, tres.
 */
import { lt, and, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { edicionActiva, limiteTasa, notificacion, session, verification } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { auditar } from '@/server/auditoria';

const HORA = 3_600_000;
const DIA = 24 * HORA;

/** Cuanto se conserva cada cosa (contado desde la fecha indicada en cada regla). */
export const UMBRALES = {
  /** Aviso leido: desde que se leyo. */
  avisoLeidoMs: 30 * DIA,
  /** Aviso sin leer: desde que se creo. */
  avisoSinLeerMs: 90 * DIA,
  /** Ventana del limite de tasa: desde su inicio (las ventanas reales duran horas). */
  limiteTasaMs: 2 * DIA,
  /** Presencia de edicion: desde que vencio (`hasta`). */
  edicionVencidaMs: HORA,
  /** Sesion de Better Auth: desde que vencio. */
  sesionVencidaMs: 7 * DIA,
  /** Verificacion de Better Auth: desde que vencio. */
  verificacionVencidaMs: DIA,
} as const;

/** Tope de lotes por regla y corrida (con `lote` = 1000, hasta 50.000 filas por tabla). */
const MAX_LOTES = 50;

export interface ConteosRetencion {
  avisosLeidos: number;
  avisosSinLeer: number;
  limiteTasa: number;
  edicionesVencidas: number;
  sesiones: number;
  verificaciones: number;
}

export interface ResultadoRetencion extends ConteosRetencion {
  /** Total de filas borradas. */
  total: number;
  /** `true` si alguna regla se detuvo por el tope de lotes y queda trabajo para la proxima corrida. */
  quedaPendiente: boolean;
}

/**
 * Borra de `tabla` las filas que cumplen `condicion`, de `lote` en `lote`. La subconsulta elige las claves con
 * `LIMIT` y el `DELETE` las borra: cada sentencia es corta y no bloquea la tabla entera.
 */
async function borrarPorLotes(
  db: Db,
  tabla: PgTable,
  claves: PgColumn[],
  condicion: SQL,
  lote: number,
): Promise<{ borradas: number; completo: boolean }> {
  const lista = sql.join(claves, sql`, `);
  let borradas = 0;
  for (let i = 0; i < MAX_LOTES; i += 1) {
    const filas = await db
      .delete(tabla)
      .where(sql`(${lista}) in (select ${lista} from ${tabla} where ${condicion} limit ${lote})`)
      .returning({ uno: sql<number>`1` });
    borradas += filas.length;
    if (filas.length < lote) return { borradas, completo: true };
  }
  return { borradas, completo: false };
}

export async function ejecutarRetencion(db: Db, opciones: { lote?: number; ahora?: Date } = {}): Promise<ResultadoRetencion> {
  const lote = Math.max(1, Math.floor(opciones.lote ?? 1000));
  const ahora = opciones.ahora ?? new Date();
  const antes = (ms: number) => new Date(ahora.getTime() - ms);
  let quedaPendiente = false;

  const regla = async (tabla: PgTable, claves: PgColumn[], condicion: SQL): Promise<number> => {
    const r = await borrarPorLotes(db, tabla, claves, condicion, lote);
    if (!r.completo) quedaPendiente = true;
    return r.borradas;
  };

  const conteos: ConteosRetencion = {
    avisosLeidos: await regla(notificacion, [notificacion.id], and(isNotNull(notificacion.leidaEn), lt(notificacion.leidaEn, antes(UMBRALES.avisoLeidoMs)))!),
    avisosSinLeer: await regla(notificacion, [notificacion.id], and(isNull(notificacion.leidaEn), lt(notificacion.creadaEn, antes(UMBRALES.avisoSinLeerMs)))!),
    limiteTasa: await regla(limiteTasa, [limiteTasa.clave, limiteTasa.ventana], lt(limiteTasa.ventana, antes(UMBRALES.limiteTasaMs))),
    edicionesVencidas: await regla(
      edicionActiva,
      [edicionActiva.referenciaId, edicionActiva.campo, edicionActiva.usuarioId],
      lt(edicionActiva.hasta, antes(UMBRALES.edicionVencidaMs)),
    ),
    sesiones: await regla(session, [session.id], lt(session.expiresAt, antes(UMBRALES.sesionVencidaMs))),
    verificaciones: await regla(verification, [verification.id], lt(verification.expiresAt, antes(UMBRALES.verificacionVencidaMs))),
  };

  const total = Object.values(conteos).reduce((a, b) => a + b, 0);

  // Una sola fila compacta por corrida, y solo si hubo algo que borrar: la auditoria es durable y los registros de
  // funciones de Vercel Hobby duran poco. Va por `auditar()` como todo lo demas: es solo un INSERT, que el rol app
  // ya puede hacer en `auditoria` (append-only), asi que la inmutabilidad no cambia.
  if (total > 0) {
    await auditar(db, {
      usuarioId: null,
      accion: 'retencion',
      entidad: 'sistema',
      entidadId: 'retencion',
      detalle: { ...conteos, total, quedaPendiente },
      creadoEn: ahora,
    });
  }

  return { ...conteos, total, quedaPendiente };
}
