/**
 * Sesiones de Better Auth que dependen solo de la base (sin Next): politica por rol (13.1, D-36)
 * y revocacion inmediata (RV-16). Better Auth solo ofrece `expiresIn`/`updateAge` globales y
 * deslizantes; la distincion interno/externo y el tope absoluto se imponen aqui.
 */
import { eq, sql } from 'drizzle-orm';
import { session } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { TipoOrganizacion } from '@/dominio/permisos';
import type { Config } from './config';

export interface PoliticaSesion {
  /** Milisegundos de inactividad tras los cuales la sesion deja de valer. */
  inactividadMs: number;
  /** Milisegundos maximos de vida de la sesion, usada o no. */
  absolutaMs: number;
}

const HORA = 3_600_000;

/** Internos 8 h de inactividad / 7 dias absolutos; externos 8 h / 72 h (S-12; ajustable por entorno). */
export function politicaSesion(tipo: TipoOrganizacion, c: Pick<
  Config,
  | 'SESION_INACTIVIDAD_HORAS_INTERNO'
  | 'SESION_INACTIVIDAD_HORAS_EXTERNO'
  | 'SESION_ABSOLUTA_HORAS_INTERNO'
  | 'SESION_ABSOLUTA_HORAS_EXTERNO'
>): PoliticaSesion {
  return tipo === 'agencia'
    ? { inactividadMs: c.SESION_INACTIVIDAD_HORAS_EXTERNO * HORA, absolutaMs: c.SESION_ABSOLUTA_HORAS_EXTERNO * HORA }
    : { inactividadMs: c.SESION_INACTIVIDAD_HORAS_INTERNO * HORA, absolutaMs: c.SESION_ABSOLUTA_HORAS_INTERNO * HORA };
}

/** Borra todas las sesiones de un usuario (desactivacion, "cerrar todas mis sesiones"). Devuelve cuantas. */
export async function revocarSesionesDeUsuario(ej: Ejecutor, usuarioId: string): Promise<number> {
  const borradas = await ej.delete(session).where(eq(session.userId, usuarioId)).returning({ id: session.id });
  return borradas.length;
}

export async function revocarSesion(ej: Ejecutor, sesionId: string): Promise<void> {
  await ej.delete(session).where(eq(session.id, sesionId));
}

/** Registra actividad como mucho una vez por minuto (13.1). */
export async function registrarActividad(ej: Ejecutor, sesionId: string, ahora: Date): Promise<void> {
  await ej
    .update(session)
    .set({ ultimaActividad: ahora })
    .where(sql`${session.id} = ${sesionId} and ${session.ultimaActividad} < ${new Date(ahora.getTime() - 60_000).toISOString()}::timestamptz`);
}
