/** Auditoria append-only (13.6). Siempre se escribe en la MISMA transaccion que la accion. */
import { auditoria } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export type AccionAuditada =
  | 'login'
  | 'login_fallido'
  | 'cerrar_sesion'
  | 'crear_cuenta'
  | 'restablecer_clave'
  | 'cambiar_clave'
  | 'desactivar'
  | 'reactivar'
  | 'cambiar_rol'
  | 'cambiar_organizacion'
  | 'enviar_a'
  | 'enviar_lote'
  | 'recordar'
  | 'reasignar'
  | 'exportar'
  | 'restaurar'
  | 'reabrir'
  | 'solicitar_reapertura'
  | 'archivar'
  | 'desarchivar'
  | 'corregir_codigo'
  | 'retirar_acceso_agencia'
  | 'retirar_adjunto'
  | 'leer_adjunto'
  | 'crear_referencia'
  // Administracion (H5)
  | 'editar_usuario'
  | 'crear_organizacion'
  | 'editar_organizacion'
  | 'cambiar_estado_organizacion'
  | 'guardar_catalogo'
  | 'guardar_restriccion'
  | 'guardar_partida'
  | 'actualizar_preferencias';

export interface EntradaAuditoria {
  usuarioId: string | null;
  accion: AccionAuditada;
  entidad: string;
  entidadId: string;
  detalle?: Record<string, unknown>;
  ip?: string | null | undefined;
  creadoEn?: Date;
}

export async function auditar(ej: Ejecutor, e: EntradaAuditoria): Promise<void> {
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
