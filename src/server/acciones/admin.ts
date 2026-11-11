/**
 * Administracion (SPEC 10.4, M14), punto de entrada unico de las operaciones de H5. Las operaciones viven en
 * modulos por tema; este archivo conserva los nombres que el resto del codigo ya conocia.
 *
 *   usuarios.ts          crear cuenta, restablecer contrasena, desactivar (con reasignacion), reactivar, cambiar rol y organizacion
 *   usuarios-admin.ts    editar, cerrar sesiones de otra persona
 *   organizaciones.ts    crear, renombrar, activar/desactivar, retirar acceso de una agencia
 *   catalogos-admin.ts   valores de lista, restricciones, partidas
 */
import type { Contexto } from '../politicas/actor';
import { listarUsuariosAdmin } from '../politicas/administracion';
import { listarAuditoriaAdmin, type FiltrosAuditoria } from '../politicas/administracion-auditoria';

export { crearOrganizacion, editarOrganizacion, cambiarEstadoOrganizacion, retirarAccesoAgencia } from './organizaciones';
export { guardarItemCatalogo, activarItemCatalogo, moverItemCatalogo, guardarRestriccion, guardarPartida } from './catalogos-admin';
export { editarUsuario } from './usuarios-admin';

export async function listarUsuarios(
  ctx: Contexto,
): Promise<Array<{ id: string; nombre: string; email: string; rol: string; activo: boolean }>> {
  const filas = await listarUsuariosAdmin(ctx.db, ctx.actor);
  return filas.map((f) => ({ id: f.id, nombre: f.nombre, email: f.email, rol: f.rol, activo: f.activo }));
}

export async function listarAuditoria(
  ctx: Contexto,
  entrada: { entidad?: string; entidadId?: string; limite?: number } & FiltrosAuditoria = {},
): Promise<Array<{ id: number; accion: string; entidad: string; entidadId: string; creadoEn: string }>> {
  const { filas } = await listarAuditoriaAdmin(ctx.db, ctx.actor, entrada);
  const limite = Math.min(Math.max(entrada.limite ?? 50, 1), 200);
  return filas
    .filter((f) => (!entrada.entidad || f.entidad === entrada.entidad) && (!entrada.entidadId || f.entidadId === entrada.entidadId))
    .slice(0, limite)
    .map((f) => ({ id: f.id, accion: f.accion, entidad: f.entidad, entidadId: f.entidadId, creadoEn: f.creadoEn }));
}
