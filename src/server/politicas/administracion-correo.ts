/**
 * Cola de correo, lecturas de administracion (14, 10.4). Solo lee `entrega_correo` (y `correo_dev` en
 * desarrollo). No hay datos de la mercancia en los correos (D-23); aun asi, la vista previa tapa cualquier
 * `token=` por si algun enlace de acceso llegara a un cuerpo guardado.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { correoDev, entregaCorreo } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { escaparLike, esUuid, exigirAdmin } from './administracion';
import type { Actor } from './actor';

export const ESTADOS_CORREO = ['pendiente', 'enviando', 'enviado', 'fallido', 'abandonado'] as const;
export type EstadoCorreo = (typeof ESTADOS_CORREO)[number];
export const POR_PAGINA_CORREO = 25;

export interface FiltrosCorreo {
  estado?: EstadoCorreo | undefined;
  q?: string | undefined;
  pagina?: number | undefined;
}

export interface FilaCorreoAdmin {
  id: string;
  destinatario: string;
  plantilla: string;
  asunto: string;
  estado: EstadoCorreo;
  intentos: number;
  proximoIntento: string;
  enviadoEn: string | null;
  ultimoError: string | null;
  creadaEn: string;
}

export async function resumenColaCorreo(ej: Ejecutor, actor: Actor): Promise<Record<EstadoCorreo, number>> {
  exigirAdmin(actor);
  const filas = await ej
    .select({ estado: entregaCorreo.estado, n: sql<number>`count(*)::int` })
    .from(entregaCorreo)
    .groupBy(entregaCorreo.estado);
  const r: Record<EstadoCorreo, number> = { pendiente: 0, enviando: 0, enviado: 0, fallido: 0, abandonado: 0 };
  for (const f of filas) if ((ESTADOS_CORREO as readonly string[]).includes(f.estado)) r[f.estado as EstadoCorreo] = f.n;
  return r;
}

export async function listarCorreosAdmin(
  ej: Ejecutor,
  actor: Actor,
  filtros: FiltrosCorreo = {},
): Promise<{ filas: FilaCorreoAdmin[]; total: number; pagina: number; porPagina: number }> {
  exigirAdmin(actor);
  const condiciones: SQL[] = [];
  if (filtros.estado) condiciones.push(eq(entregaCorreo.estado, filtros.estado));
  const q = (filtros.q ?? '').trim().toLowerCase();
  if (q) condiciones.push(sql`lower(${entregaCorreo.destinatario}) like ${`%${escaparLike(q)}%`} escape '\\'`);
  const donde = condiciones.length ? and(...condiciones) : undefined;
  const pagina = Math.max(1, Math.floor(filtros.pagina ?? 1));

  const [t] = await ej.select({ n: sql<number>`count(*)::int` }).from(entregaCorreo).where(donde);
  const filas = await ej
    .select({
      id: entregaCorreo.id,
      destinatario: entregaCorreo.destinatario,
      plantilla: entregaCorreo.plantilla,
      asunto: entregaCorreo.asunto,
      estado: entregaCorreo.estado,
      intentos: entregaCorreo.intentos,
      proximoIntento: entregaCorreo.proximoIntento,
      enviadoEn: entregaCorreo.enviadoEn,
      ultimoError: entregaCorreo.ultimoError,
      creadaEn: entregaCorreo.creadaEn,
    })
    .from(entregaCorreo)
    .where(donde)
    .orderBy(desc(entregaCorreo.creadaEn), desc(entregaCorreo.id))
    .limit(POR_PAGINA_CORREO)
    .offset((pagina - 1) * POR_PAGINA_CORREO);
  return {
    total: t?.n ?? 0,
    pagina,
    porPagina: POR_PAGINA_CORREO,
    filas: filas.map((f) => ({
      ...f,
      estado: f.estado as EstadoCorreo,
      proximoIntento: f.proximoIntento.toISOString(),
      enviadoEn: f.enviadoEn?.toISOString() ?? null,
      creadaEn: f.creadaEn.toISOString(),
    })),
  };
}

/** Tapa el valor de cualquier `token=` en un texto (enlaces de acceso). */
export function taparTokens(texto: string): string {
  return texto.replace(/(token=)[^&"'\s<>)]+/gi, '$1••••••');
}

export interface CorreoVistaPrevia {
  id: string;
  origen: 'cola' | 'desarrollo';
  destinatario: string;
  plantilla: string | null;
  asunto: string;
  cuerpoTexto: string;
  cuerpoHtml: string;
  estado: EstadoCorreo | null;
  intentos: number | null;
  ultimoError: string | null;
  creadaEn: string;
}

export async function obtenerCorreoAdmin(ej: Ejecutor, actor: Actor, id: string, origen: 'cola' | 'desarrollo' = 'cola'): Promise<CorreoVistaPrevia | null> {
  exigirAdmin(actor);
  if (!esUuid(id)) return null;
  if (origen === 'desarrollo') {
    if ((process.env.NODE_ENV ?? 'development') !== 'development') return null;
    const [c] = await ej.select().from(correoDev).where(eq(correoDev.id, id)).limit(1);
    if (!c) return null;
    return {
      id: c.id,
      origen,
      destinatario: c.destinatario,
      plantilla: null,
      asunto: c.asunto,
      cuerpoTexto: taparTokens(c.cuerpoTexto),
      cuerpoHtml: taparTokens(c.cuerpoHtml),
      estado: null,
      intentos: null,
      ultimoError: null,
      creadaEn: c.creadoEn.toISOString(),
    };
  }
  const [c] = await ej.select().from(entregaCorreo).where(eq(entregaCorreo.id, id)).limit(1);
  if (!c) return null;
  return {
    id: c.id,
    origen,
    destinatario: c.destinatario,
    plantilla: c.plantilla,
    asunto: c.asunto,
    cuerpoTexto: taparTokens(c.cuerpoTexto),
    cuerpoHtml: taparTokens(c.cuerpoHtml),
    estado: c.estado as EstadoCorreo,
    intentos: c.intentos,
    ultimoError: c.ultimoError,
    creadaEn: c.creadaEn.toISOString(),
  };
}

export interface FilaCorreoDev {
  id: string;
  destinatario: string;
  asunto: string;
  creadoEn: string;
}

/** Solo desarrollo: los correos que salieron por consola (acceso, bienvenida). En produccion devuelve []. */
export async function listarCorreoDev(ej: Ejecutor, actor: Actor, limite = 15): Promise<FilaCorreoDev[]> {
  exigirAdmin(actor);
  if ((process.env.NODE_ENV ?? 'development') !== 'development') return [];
  const filas = await ej
    .select({ id: correoDev.id, destinatario: correoDev.destinatario, asunto: correoDev.asunto, creadoEn: correoDev.creadoEn })
    .from(correoDev)
    .orderBy(desc(correoDev.creadoEn))
    .limit(limite);
  return filas.map((f) => ({ ...f, creadoEn: f.creadoEn.toISOString() }));
}
