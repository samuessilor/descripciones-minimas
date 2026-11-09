/**
 * El `Actor` es la identidad que toda lectura y escritura recibe (13.2). Se resuelve en cada
 * peticion con `getActor()` (que relee `usuario.activo`, 13.1) y NUNCA se confia al cliente.
 */
import { and, eq } from 'drizzle-orm';
import type { Db, Ejecutor } from '@/db/tipos';
import { organizacion, usuario } from '@/db/esquema';
import type { ActorLike, Rol, TipoOrganizacion } from '@/dominio/permisos';

export interface Actor extends ActorLike {
  nombre: string;
  /** Con lo que entra (nulo en cuentas anteriores al acceso por contrasena). */
  username?: string | null;
  email: string;
  area: string | null;
  organizacionNombre: string;
  /** Sesion con la que llega (nula en scripts y pruebas de nucleo). */
  sesionId?: string;
  sesionCreadaEn?: Date;
}

export interface Contexto {
  db: Db;
  actor: Actor;
  /** Reloj inyectable (pruebas). */
  ahora?: Date;
  ip?: string | null;
}

export const ahoraDe = (ctx: { ahora?: Date | undefined }): Date => ctx.ahora ?? new Date();

/** Carga un actor activo (usuario y organizacion activos) o `null`. */
export async function cargarActorPorId(ej: Ejecutor, usuarioId: string): Promise<Actor | null> {
  const filas = await ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      username: usuario.username,
      email: usuario.email,
      rol: usuario.rol,
      area: usuario.area,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
      organizacionNombre: organizacion.nombre,
    })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(and(eq(usuario.id, usuarioId), eq(usuario.activo, true), eq(organizacion.activa, true)))
    .limit(1);
  const f = filas[0];
  if (!f) return null;
  return {
    usuarioId: f.id,
    nombre: f.nombre,
    username: f.username,
    email: f.email,
    rol: f.rol as Rol,
    area: f.area,
    organizacionId: f.organizacionId,
    organizacionTipo: f.organizacionTipo as TipoOrganizacion,
    organizacionNombre: f.organizacionNombre,
  };
}
