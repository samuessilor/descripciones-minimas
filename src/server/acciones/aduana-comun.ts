/**
 * Piezas compartidas por las acciones del lado aduana (partida, cierre, exportacion):
 * auditoria libre, resolucion de destinatarios de avisos y nombres con el enmascaramiento de agencias (A5).
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { asignacion, auditoria, usuario } from '@/db/esquema';
import type { Ejecutor, Tx } from '@/db/tipos';
import { autorVisible, type TipoOrganizacion } from '@/dominio/permisos';
import { enlaceReferencia, nombreSinMarca } from '@/dominio/colaboracion';
import { cargarPerfiles, comoDestino, configAvisos } from '../colaboracion/comun';
import type { PlantillaAviso } from '../correo/plantillas';
import { avisar } from '../notificaciones/avisar';
import type { TipoNotificacion } from '../notificaciones/crear';
import type { Actor } from '../politicas/actor';
import { NOMBRE_OTRA_AGENCIA } from '../politicas/referencias';

/**
 * Auditoria append-only con nombre de accion libre. `auditar()` de `server/auditoria.ts` restringe la lista
 * de acciones; las propias del lado aduana (finalizar, cambiar_partida...) se registran aqui, en la misma
 * transaccion que la accion.
 */
export async function auditarAduana(
  ej: Ejecutor,
  e: {
    usuarioId: string | null;
    accion: string;
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

export interface PersonaAviso {
  id: string;
  nombre: string;
  rol: string;
  organizacionId: string;
  organizacionTipo: TipoOrganizacion;
}

/** Usuarios ACTIVOS por id (para avisar). */
export async function personasActivas(ej: Ejecutor, ids: string[]): Promise<PersonaAviso[]> {
  const unicos = [...new Set(ids)];
  if (unicos.length === 0) return [];
  const filas = await ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
    })
    .from(usuario)
    .where(and(inArray(usuario.id, unicos), eq(usuario.activo, true)));
  return filas.map((f) => ({ ...f, organizacionTipo: f.organizacionTipo as TipoOrganizacion }));
}

/**
 * Aviso del lado aduana (clasificada, reabierta, reapertura solicitada): el MISMO mecanismo
 * que «Enviar a» (`avisar`). En la transaccion de quien llama deja la notificacion en la bandeja y, si la persona
 * acepta correo, la fila del outbox con el mensaje ya armado y el enlace directo a la ficha. Si la transaccion se
 * revierte no queda ni aviso ni correo. Devuelve el id del correo encolado (o `null`).
 */
export async function avisarAduana(
  tx: Ejecutor,
  p: {
    actor: Actor;
    persona: PersonaAviso;
    tipo: TipoNotificacion & PlantillaAviso;
    ficha: { id: string; codigo: string };
    titulo: string;
    ahora: Date;
    asignacionId?: string | null;
  },
): Promise<string | null> {
  const perfil = (await cargarPerfiles(tx, [p.persona.id])).get(p.persona.id);
  if (!perfil || !perfil.activo) return null;
  const cfg = configAvisos();
  const r = await avisar(tx, {
    destino: comoDestino(perfil),
    tipo: p.tipo,
    referenciaId: p.ficha.id,
    asignacionId: p.asignacionId ?? null,
    titulo: p.titulo,
    ahora: p.ahora,
    contacto: cfg.contacto,
    correo: {
      plantilla: p.tipo,
      params: { quien: nombreParaDestinatario(p.actor, p.persona), enlace: enlaceReferencia(cfg.appUrl, p.ficha.id), codigo: cfg.incluirReferencia ? p.ficha.codigo : null },
    },
  });
  return r.correoId;
}

/** Nombre de `actor` tal como lo debe ver `destinatario` (una agencia no ve a otra, A5). */
export function nombreParaDestinatario(actor: Actor, destinatario: PersonaAviso): string {
  const visible = autorVisible(
    { usuarioId: destinatario.id, rol: 'aduana', organizacionId: destinatario.organizacionId, organizacionTipo: destinatario.organizacionTipo },
    { organizacionId: actor.organizacionId, organizacionTipo: actor.organizacionTipo },
  );
  return visible === 'otra_agencia' ? NOMBRE_OTRA_AGENCIA : nombreSinMarca(actor.nombre);
}

/** Administradores activos (destino de las solicitudes de reapertura), sin contar a `excepto`. */
export async function administradoresActivos(ej: Ejecutor, excepto?: string): Promise<PersonaAviso[]> {
  const filas = await ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
    })
    .from(usuario)
    .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true), excepto ? ne(usuario.id, excepto) : undefined));
  return filas.map((f) => ({ ...f, organizacionTipo: f.organizacionTipo as TipoOrganizacion }));
}

/** Quienes enviaron la ficha (asignaciones no canceladas) mas quien la creo: a ellos les importa el cierre. */
export async function interesadosEnFicha(tx: Tx | Ejecutor, referenciaId: string, creadaPor: string): Promise<string[]> {
  const filas = await tx
    .select({ de: asignacion.deUsuarioId })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, referenciaId), ne(asignacion.estado, 'cancelada')));
  return [...new Set([creadaPor, ...filas.map((f) => f.de)])];
}

/** `fecha + dias`, en milisegundos exactos (los 30 dias del acceso de la agencia, 8.3 regla 10). */
export function masDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}
