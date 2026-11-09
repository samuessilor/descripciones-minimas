/**
 * Piezas compartidas por las acciones de colaboracion (asignaciones, comentarios, bandeja):
 * perfiles de personas, retiro de correos que ya no aplican, auditoria de las acciones que el
 * SPEC no listaba y configuracion de avisos.
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
  email: string;
  rol: Rol;
  activo: boolean;
  correoInvalido: boolean;
  preferenciaAviso: string;
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
      email: usuario.email,
      rol: usuario.rol,
      activo: usuario.activo,
      correoInvalido: usuario.correoInvalido,
      preferenciaAviso: usuario.preferenciaAviso,
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
  return {
    id: p.id,
    nombre: p.nombre,
    email: p.email,
    preferenciaAviso: p.preferenciaAviso,
    correoInvalido: p.correoInvalido,
  };
}

/** Configuracion que usan los avisos (enlaces y contacto del pie). */
export function configAvisos(): { appUrl: string; contacto: string; incluirReferencia: boolean; maxRecordatoriosDia: number; diasAcceso: number } {
  const c = getConfig();
  return {
    appUrl: c.APP_URL,
    contacto: c.CONTACTO_ADMIN,
    incluirReferencia: c.CORREO_INCLUIR_REFERENCIA,
    maxRecordatoriosDia: c.RECORDATORIO_MANUAL_MAX_DIA,
    diasAcceso: c.ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR,
  };
}

/**
 * Cuando una asignacion se cancela, se termina o se reasigna, el correo "tienes pendiente..." que AUN no
 * salio ya no aplica: se cierra como `abandonado` para que no llegue un aviso viejo. Un envio en curso
 * (`enviando`) o ya enviado no se toca.
 */
export async function retirarCorreosPendientes(tx: Ejecutor, asignacionIds: readonly string[], motivo: string): Promise<number> {
  if (asignacionIds.length === 0) return 0;
  const r = await tx.execute(sql`
    UPDATE entrega_correo
       SET estado = 'abandonado', bloqueado_hasta = NULL, ultimo_error = ${motivo}
     WHERE estado IN ('pendiente', 'fallido')
       AND notificacion_id IN (
         SELECT id FROM notificacion WHERE asignacion_id IN (${sql.join(asignacionIds.map((id) => sql`${id}::uuid`), sql`, `)}))
    RETURNING id`);
  const filas = Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? []);
  return filas.length;
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
