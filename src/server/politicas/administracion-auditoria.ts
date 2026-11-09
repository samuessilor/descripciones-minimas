/**
 * Visor de auditoria (13.6): solo lectura, solo `admin` y supervisora. La tabla es append-only; aqui nunca se escribe.
 * Los filtros y el cursor viven en la URL, asi un enlace reproduce lo que se ve. Se pagina por cursor sobre el id
 * (sin `count(*)` ni OFFSET): cada pagina cuesta lo mismo con 1.000 o con 10 millones de eventos.
 */
import { and, asc, desc, eq, gt, gte, lt, or, sql, type SQL } from 'drizzle-orm';
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
  /** Cursor: la pagina de eventos anteriores (mas antiguos) al id dado. */
  antes?: number | undefined;
  /** Cursor: la pagina de eventos posteriores (mas recientes) al id dado. */
  despues?: number | undefined;
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

function cursorValido(n: number | undefined): n is number {
  return n !== undefined && Number.isSafeInteger(n) && n > 0;
}

export interface PaginaAuditoria {
  filas: FilaAuditoria[];
  /** Cursor (`antes`) de la pagina con eventos mas antiguos; `null` si no hay mas. */
  siguiente: number | null;
  /** Cursor (`despues`) de la pagina con eventos mas recientes; `null` si esta es la primera. */
  anterior: number | null;
  porPagina: number;
  fichaNoExiste: boolean;
}

export async function listarAuditoriaAdmin(ej: Ejecutor, actor: Actor, filtros: FiltrosAuditoria = {}): Promise<PaginaAuditoria> {
  exigir(actor, 'supervisar');
  const { donde, fichaNoExiste } = await condiciones(ej, filtros);
  if (fichaNoExiste) return { filas: [], siguiente: null, anterior: null, porPagina: POR_PAGINA_AUDITORIA, fichaNoExiste };
  const haciaAtras = cursorValido(filtros.despues) && !cursorValido(filtros.antes);
  const cursor = haciaAtras ? gt(auditoria.id, filtros.despues!) : cursorValido(filtros.antes) ? lt(auditoria.id, filtros.antes) : undefined;
  const { objetivo, columnas } = seleccion();
  // Se pide una fila de mas solo para saber si hay otra pagina.
  const leidas = await ej
    .select(columnas)
    .from(auditoria)
    .leftJoin(usuario, eq(usuario.id, auditoria.usuarioId))
    .leftJoin(referencia, and(eq(auditoria.entidad, 'referencia'), sql`${referencia.id}::text = ${auditoria.entidadId}`))
    .leftJoin(objetivo, and(eq(auditoria.entidad, 'usuario'), sql`${objetivo.id}::text = ${auditoria.entidadId}`))
    .where(and(donde, cursor))
    .orderBy(haciaAtras ? asc(auditoria.id) : desc(auditoria.id))
    .limit(POR_PAGINA_AUDITORIA + 1);
  const hayMas = leidas.length > POR_PAGINA_AUDITORIA;
  const filas = leidas.slice(0, POR_PAGINA_AUDITORIA).map(aFila);
  if (haciaAtras) filas.reverse();
  const primero = filas[0]?.id;
  const ultimo = filas[filas.length - 1]?.id;
  const hayCursor = cursorValido(filtros.antes) || haciaAtras;
  return {
    filas,
    // Viniendo de una pagina mas reciente, siempre quedan eventos mas antiguos (los de la pagina de origen).
    siguiente: ultimo !== undefined && (haciaAtras || hayMas) ? ultimo : null,
    anterior: primero !== undefined && (haciaAtras ? hayMas : hayCursor) ? primero : null,
    porPagina: POR_PAGINA_AUDITORIA,
    fichaNoExiste,
  };
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
  // Acciones distintas sin recorrer la tabla: salta de valor en valor por `auditoria_accion_idx` (loose index scan).
  const r = await ej.execute<{ accion: string }>(sql`
    with recursive a(accion) as (
      (select accion from ${auditoria} order by accion limit 1)
      union all
      select (select x.accion from ${auditoria} x where x.accion > a.accion order by x.accion limit 1) from a where a.accion is not null
    )
    select accion from a where accion is not null`);
  const usuarios = await ej
    .select({ id: usuario.id, nombre: usuario.nombre })
    .from(usuario)
    .where(sql`exists (select 1 from ${auditoria} a where a.usuario_id = ${usuario.id})`)
    .orderBy(asc(usuario.nombre))
    .limit(300);
  // Segun el controlador (PGlite, pg, Neon) el resultado es la lista o un objeto con `rows`.
  const filas = (Array.isArray(r) ? r : ((r as unknown as { rows?: Array<{ accion: string }> }).rows ?? [])) as Array<{ accion: string }>;
  return { acciones: filas.map((f) => f.accion), usuarios };
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
