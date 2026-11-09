/**
 * Piezas compartidas por las acciones de colaboracion (asignaciones, comentarios, bandeja):
 * perfiles de personas, auditoria de las acciones que el SPEC no listaba y configuracion de avisos.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { auditoria, notificacion, organizacion, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { Rol, TipoOrganizacion } from '@/dominio/permisos';
import { getConfig } from '../config';
import type { DestinoAviso } from '../notificaciones/avisar';

export interface Perfil {
  id: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  organizacionId: string;
  organizacionTipo: TipoOrganizacion;
  organizacionNombre: string;
  organizacionActiva: boolean;
  area: string | null;
}

export async function cargarPerfiles(ej: Ejecutor, ids: readonly string[]): Promise<Map<string, Perfil>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<string, Perfil>();
  if (unicos.length === 0) return mapa;
  const filas = await ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      activo: usuario.activo,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
      organizacionNombre: organizacion.nombre,
      organizacionActiva: organizacion.activa,
      area: usuario.area,
    })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(inArray(usuario.id, unicos));
  for (const f of filas) {
    mapa.set(f.id, { ...f, rol: f.rol as Rol, organizacionTipo: f.organizacionTipo as TipoOrganizacion });
  }
  return mapa;
}

export function comoDestino(p: Perfil): DestinoAviso {
  return { id: p.id };
}

/** Reglas que usan los avisos y las asignaciones (tope de recordatorios y dias de acceso de una agencia). */
export function configAvisos(): { maxRecordatoriosDia: number; diasAcceso: number } {
  const c = getConfig();
  return {
    maxRecordatoriosDia: c.RECORDATORIO_MANUAL_MAX_DIA,
    diasAcceso: c.ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR,
  };
}

/** Acciones de colaboracion que el SPEC no listaba en `auditoria`; la columna es texto libre. */
export type AccionColaboracion = 'marcar_listo' | 'cancelar_asignacion' | 'comentar' | 'ver_asignacion';

export async function auditarColaboracion(
  ej: Ejecutor,
  e: {
    usuarioId: string;
    accion: AccionColaboracion;
    entidad: string;
    entidadId: string;
    detalle?: Record<string, unknown>;
    ip?: string | null | undefined;
    creadoEn?: Date;
  },
): Promise<void> {
  await ej.insert(auditoria).values({
    usuarioId: e.usuarioId,
    accion: e.accion,
    entidad: e.entidad,
    entidadId: e.entidadId,
    detalle: e.detalle ?? {},
    ip: e.ip ?? null,
    ...(e.creadoEn ? { creadoEn: e.creadoEn } : {}),
  });
}

/** Marca leidas todas las notificaciones sin leer de una persona sobre una ficha. */
export async function marcarLeidasDeFicha(tx: Ejecutor, usuarioId: string, referenciaId: string, ahora: Date): Promise<number> {
  const filas = await tx
    .update(notificacion)
    .set({ leidaEn: ahora })
    .where(and(eq(notificacion.usuarioId, usuarioId), eq(notificacion.referenciaId, referenciaId), sql`${notificacion.leidaEn} is null`))
    .returning({ id: notificacion.id });
  return filas.length;
}
