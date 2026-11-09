/** Ayudas de las pruebas de colaboracion (H3): lecturas directas de la base para verificar el outbox. */
import { asc, eq } from 'drizzle-orm';
import { asignacion, auditoria, entregaCorreo, notificacion, referencia } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import type { Actor } from '@/server/politicas/actor';
import type { Escenario } from './ayudas';

export async function asignacionesDe(db: Db, referenciaId: string) {
  return db.select().from(asignacion).where(eq(asignacion.referenciaId, referenciaId)).orderBy(asc(asignacion.creadaEn));
}

export async function notificacionesDe(db: Db, usuarioId: string) {
  return db.select().from(notificacion).where(eq(notificacion.usuarioId, usuarioId)).orderBy(asc(notificacion.creadaEn));
}

export async function correos(db: Db) {
  return db.select().from(entregaCorreo).orderBy(asc(entregaCorreo.creadaEn));
}

export async function correosPara(db: Db, email: string) {
  return db.select().from(entregaCorreo).where(eq(entregaCorreo.destinatario, email)).orderBy(asc(entregaCorreo.creadaEn));
}

export async function estadoFicha(db: Db, id: string): Promise<string> {
  const [f] = await db.select({ estado: referencia.estado }).from(referencia).where(eq(referencia.id, id)).limit(1);
  return f?.estado ?? '';
}

export async function auditorias(db: Db, accion: string) {
  return db.select().from(auditoria).where(eq(auditoria.accion, accion)).orderBy(asc(auditoria.id));
}

export const ID = (a: Actor): { usuarioId: string } => ({ usuarioId: a.usuarioId });

export function dest(a: Actor, pedido?: 'completar' | 'clasificar' | 'responder' | 'revisar') {
  return pedido ? { usuarioId: a.usuarioId, pedido } : { usuarioId: a.usuarioId };
}

export function d(base: Date, dias: number, horas = 0): Date {
  return new Date(base.getTime() + dias * 86_400_000 + horas * 3_600_000);
}

export type { Escenario };
