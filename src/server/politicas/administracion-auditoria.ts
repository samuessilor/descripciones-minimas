/**
 * Visor de auditoria (13.6): solo lectura, solo `admin`. La tabla es append-only; aqui nunca se escribe.
 * Los filtros viven en la URL, asi un enlace reproduce lo que se ve.
 */
import { and, asc, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { auditoria, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { normalizarCodigo } from '@/dominio/normalizacion';
import { esUuid } from './administracion';
import { exigir } from './exigir';
import type { Actor } from './actor';

export const POR_PAGINA_AUDITORIA = 50;
export const MAXIMO_FILAS_CSV = 10_000;

export interface FiltrosAuditoria {
  /** `AAAA-MM-DD` en hora de Bogota. */
  desde?: string | undefined;
  hasta?: string | undefined;
  usuarioId?: string | undefined;
  accion?: string | undefined;
  /** Codigo de referencia (se normaliza) o id de la ficha. */
  ficha?: string | undefined;
  pagina?: number | undefined;
}

export interface FilaAuditoria {
  id: number;
  creadoEn: string;
  usuarioId: string | null;
  usuarioNombre: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  /** Texto legible de la entidad (codigo de la ficha, nombre de la persona...). */
  entidadEtiqueta: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** 00:00 de ese dia en Bogota (UTC-5, sin horario de verano). */
export function inicioDia(fecha: string): Date | null {
  if (!FECHA.test(fecha)) return null;
  const d = new Date(`${fecha}T00:00:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function condiciones(ej: Ejecutor, f: FiltrosAuditoria): Promise<{ donde: SQL | undefined; fichaNoExiste: boolean }> {
  const c: SQL[] = [];
  let fichaNoExiste = false;
  const desde = f.desde ? inicioDia(f.desde) : null;
  if (desde) c.push(gte(auditoria.creadoEn, desde));
  const hasta = f.hasta ? inicioDia(f.hasta) : null;
  if (hasta) c.push(lt(auditoria.creadoEn, new Date(hasta.getTime() + 86_400_000)));
  if (f.usuarioId && esUuid(f.usuarioId)) c.push(eq(auditoria.usuarioId, f.usuarioId));
  if (f.accion) c.push(eq(auditoria.accion, f.accion));
  const ficha = (f.ficha ?? '').trim();
  if (ficha) {
    let id: string | undefined;
    if (esUuid(ficha)) id = ficha;
    else {
      const [r] = await ej.select({ id: referencia.id }).from(referencia).where(eq(referencia.codigoNorm, normalizarCodigo(ficha))).limit(1);
      id = r?.id;
    }
    if (!id) fichaNoExiste = true;
    // Los envios, recordatorios y fotos se auditan sobre su propia entidad y dejan la ficha en `detalle.referenciaId`.
    else {
      const sobreFicha = and(eq(auditoria.entidad, 'referencia'), eq(auditoria.entidadId, id));
      c.push(or(sobreFicha, sql`${auditoria.detalle}->>'referenciaId' = ${id}`) as SQL);
    }
  }
  return { donde: c.length ? and(...c) : undefined, fichaNoExiste };
}

function seleccion() {
  const objetivo = alias(usuario, 'objetivo');
  const columnas = {
    id: auditoria.id,
    creadoEn: auditoria.creadoEn,
    usuarioId: auditoria.usuarioId,
    usuarioNombre: usuario.nombre,
    accion: auditoria.accion,
    entidad: auditoria.entidad,
    entidadId: auditoria.entidadId,
    codigoFicha: referencia.codigo,
    nombreObjetivo: objetivo.nombre,
    detalle: auditoria.detalle,
    ip: auditoria.ip,
  };
  return { objetivo, columnas };
}

function aFila(f: {
  id: number;
  creadoEn: Date;
  usuarioId: string | null;
  usuarioNombre: string | null;
  accion: string;
  entidad: string;
  entidadId: string;
  codigoFicha: string | null;
  nombreObjetivo: string | null;
  detalle: Record<string, unknown>;
  ip: string | null;
}): FilaAuditoria {
  return {
    id: f.id,
    creadoEn: f.creadoEn.toISOString(),
    usuarioId: f.usuarioId,
    usuarioNombre: f.usuarioNombre,
    accion: f.accion,
    entidad: f.entidad,
    entidadId: f.entidadId,
    // Envios, fotos...: la ficha no se une por entidad, pero su codigo viaja en el detalle.
    entidadEtiqueta: f.codigoFicha ?? f.nombreObjetivo ?? (typeof f.detalle?.codigo === 'string' ? f.detalle.codigo : null),
    detalle: f.detalle,
    ip: f.ip,
  };
}

export async function listarAuditoriaAdmin(
  ej: Ejecutor,
  actor: Actor,
  filtros: FiltrosAuditoria = {},
): Promise<{ filas: FilaAuditoria[]; total: number; pagina: number; porPagina: number; fichaNoExiste: boolean }> {
  exigir(actor, 'supervisar');
  const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1));
  const { donde, fichaNoExiste } = await condiciones(ej, filtros);
  if (fichaNoExiste) return { filas: [], total: 0, pagina, porPagina: POR_PAGINA_AUDITORIA, fichaNoExiste };
  const { objetivo, columnas } = seleccion();
  const [t] = await ej.select({ n: sql<number>`count(*)::int` }).from(auditoria).where(donde);
  const filas = await ej
    .select(columnas)
    .from(auditoria)
    .leftJoin(usuario, eq(usuario.id, auditoria.usuarioId))
    .leftJoin(referencia, and(eq(auditoria.entidad, 'referencia'), sql`${referencia.id}::text = ${auditoria.entidadId}`))
    .leftJoin(objetivo, and(eq(auditoria.entidad, 'usuario'), sql`${objetivo.id}::text = ${auditoria.entidadId}`))
    .where(donde)
    .orderBy(desc(auditoria.id))
    .limit(POR_PAGINA_AUDITORIA)
    .offset((pagina - 1) * POR_PAGINA_AUDITORIA);
  return { filas: filas.map(aFila), total: t?.n ?? 0, pagina, porPagina: POR_PAGINA_AUDITORIA, fichaNoExiste };
}

/** Para el CSV: hasta `MAXIMO_FILAS_CSV` filas, de la mas nueva a la mas vieja. */
export async function auditoriaParaCsv(ej: Ejecutor, actor: Actor, filtros: FiltrosAuditoria = {}): Promise<{ filas: FilaAuditoria[]; truncado: boolean }> {
  exigir(actor, 'supervisar');
  const { donde, fichaNoExiste } = await condiciones(ej, filtros);
  if (fichaNoExiste) return { filas: [], truncado: false };
  const { objetivo, columnas } = seleccion();
  const filas = await ej
    .select(columnas)
    .from(auditoria)
    .leftJoin(usuario, eq(usuario.id, auditoria.usuarioId))
    .leftJoin(referencia, and(eq(auditoria.entidad, 'referencia'), sql`${referencia.id}::text = ${auditoria.entidadId}`))
    .leftJoin(objetivo, and(eq(auditoria.entidad, 'usuario'), sql`${objetivo.id}::text = ${auditoria.entidadId}`))
    .where(donde)
    .orderBy(desc(auditoria.id))
    .limit(MAXIMO_FILAS_CSV + 1);
  return { filas: filas.slice(0, MAXIMO_FILAS_CSV).map(aFila), truncado: filas.length > MAXIMO_FILAS_CSV };
}

export interface OpcionesFiltroAuditoria {
  acciones: string[];
  usuarios: Array<{ id: string; nombre: string }>;
}

export async function opcionesFiltroAuditoria(ej: Ejecutor, actor: Actor): Promise<OpcionesFiltroAuditoria> {
  exigir(actor, 'supervisar');
  const acciones = await ej.selectDistinct({ accion: auditoria.accion }).from(auditoria).orderBy(asc(auditoria.accion));
  const usuarios = await ej
    .select({ id: usuario.id, nombre: usuario.nombre })
    .from(usuario)
    .where(sql`exists (select 1 from ${auditoria} a where a.usuario_id = ${usuario.id})`)
    .orderBy(asc(usuario.nombre))
    .limit(300);
  return { acciones: acciones.map((a) => a.accion), usuarios };
}

/** Un evento por id (para la ficha de detalle). */
export async function obtenerEventoAuditoria(ej: Ejecutor, actor: Actor, id: number): Promise<FilaAuditoria | null> {
  exigir(actor, 'supervisar');
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const { objetivo, columnas } = seleccion();
  const [f] = await ej
    .select(columnas)
    .from(auditoria)
    .leftJoin(usuario, eq(usuario.id, auditoria.usuarioId))
    .leftJoin(referencia, and(eq(auditoria.entidad, 'referencia'), sql`${referencia.id}::text = ${auditoria.entidadId}`))
    .leftJoin(objetivo, and(eq(auditoria.entidad, 'usuario'), sql`${objetivo.id}::text = ${auditoria.entidadId}`))
    .where(eq(auditoria.id, id))
    .limit(1);
  return f ? aFila(f) : null;
}
