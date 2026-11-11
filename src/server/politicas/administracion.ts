/**
 * Lecturas de administracion (administrador y supervisora general, 10.4). Las pantallas no consultan la base
 * directamente: pasan por aqui, con el `Actor`, y quien no es ninguno de los dos recibe `SIN_PERMISO` antes de tocar
 * ninguna tabla.
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { account, asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { normalizarTexto } from '@/dominio/normalizacion';
import type { Rol } from '@/dominio/permisos';
import type { Actor } from './actor';
import { exigir } from './exigir';

/** Escapa `%`, `_` y `\` para usarlos dentro de un LIKE ... ESCAPE '\'. */
export function escaparLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Comparacion sin mayusculas ni tildes del lado de la base (no hay extension `unaccent` en PGlite). */
export function sinTildesSql(col: SQL): SQL {
  return sql`translate(lower(${col}), 'áéíóúüñàèìòù', 'aeiouunaeiou')`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (s: string | undefined | null): s is string => !!s && UUID.test(s);

// ---- Usuarios -----------------------------------------------------------------------------------

export type EstadoUsuarioFiltro = 'activo' | 'inactivo' | 'sin_ingreso';

export interface FiltrosUsuarios {
  q?: string | undefined;
  rol?: Rol | undefined;
  organizacionId?: string | undefined;
  estado?: EstadoUsuarioFiltro | undefined;
}

export interface FilaUsuarioAdmin {
  id: string;
  nombre: string;
  username: string | null;
  email: string;
  rol: string;
  area: string | null;
  encargado: string | null;
  activo: boolean;
  organizacion: string;
  organizacionId: string;
  organizacionTipo: string;
  ultimoIngreso: string | null;
  creadoEn: string;
  /** Sin credencial: la cuenta existe pero nadie le ha generado clave, asi que no puede ingresar (pendiente de entrega). */
  sinClave: boolean;
}

const COLUMNAS_USUARIO = {
  id: usuario.id,
  nombre: usuario.nombre,
  username: usuario.username,
  email: usuario.email,
  rol: usuario.rol,
  area: usuario.area,
  encargado: usuario.encargado,
  activo: usuario.activo,
  organizacion: organizacion.nombre,
  organizacionId: usuario.organizacionId,
  organizacionTipo: usuario.organizacionTipo,
  ultimoIngreso: usuario.ultimoIngreso,
  creadoEn: usuario.creadoEn,
  sinClave: sql<boolean>`not exists (select 1 from ${account} where ${account.userId} = ${usuario.id} and ${account.providerId} = 'credential')`,
};

export async function listarUsuariosAdmin(ej: Ejecutor, actor: Actor, filtros: FiltrosUsuarios = {}): Promise<FilaUsuarioAdmin[]> {
  exigir(actor, 'supervisar');
  // Una cuenta retirada (eliminada con trabajo en el historial) se conserva anonimizada pero no se lista.
  const condiciones: SQL[] = [isNull(usuario.eliminadoEn)];
  const q = normalizarTexto(filtros.q ?? '');
  if (q) {
    const patron = `%${escaparLike(q)}%`;
    condiciones.push(
      sql`(${sinTildesSql(sql`${usuario.nombre}`)} like ${patron} escape '\\' or coalesce(${usuario.username}, '') like ${patron} escape '\\' or lower(${usuario.email}) like ${patron} escape '\\' or ${sinTildesSql(sql`coalesce(${usuario.area}, '')`)} like ${patron} escape '\\')`,
    );
  }
  if (filtros.rol) condiciones.push(eq(usuario.rol, filtros.rol));
  if (filtros.organizacionId && esUuid(filtros.organizacionId)) condiciones.push(eq(usuario.organizacionId, filtros.organizacionId));
  switch (filtros.estado) {
    case 'activo':
      condiciones.push(eq(usuario.activo, true));
      break;
    case 'inactivo':
      condiciones.push(eq(usuario.activo, false));
      break;
    case 'sin_ingreso':
      condiciones.push(and(eq(usuario.activo, true), isNull(usuario.ultimoIngreso)) as SQL);
      break;
  }
  const filas = await ej
    .select(COLUMNAS_USUARIO)
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(usuario.activo), asc(organizacion.nombre), asc(usuario.nombre))
    .limit(500);
  return filas.map((f) => ({ ...f, ultimoIngreso: f.ultimoIngreso?.toISOString() ?? null, creadoEn: f.creadoEn.toISOString() }));
}

export async function obtenerUsuarioAdmin(ej: Ejecutor, actor: Actor, usuarioId: string): Promise<FilaUsuarioAdmin | null> {
  exigir(actor, 'supervisar');
  if (!esUuid(usuarioId)) return null;
  const [f] = await ej
    .select(COLUMNAS_USUARIO)
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(and(eq(usuario.id, usuarioId), isNull(usuario.eliminadoEn)))
    .limit(1);
  if (!f) return null;
  return { ...f, ultimoIngreso: f.ultimoIngreso?.toISOString() ?? null, creadoEn: f.creadoEn.toISOString() };
}

export interface PendienteUsuario {
  asignacionId: string;
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  pedido: string | null;
  estado: string;
  desde: string;
  deNombre: string;
}

/** Asignaciones abiertas (pendiente / en curso) de una persona: lo que hay que reasignar al desactivarla o moverla. */
export async function pendientesDeUsuario(ej: Ejecutor, actor: Actor, usuarioId: string): Promise<PendienteUsuario[]> {
  exigir(actor, 'supervisar');
  if (!esUuid(usuarioId)) return [];
  const de = alias(usuario, 'de');
  const filas = await ej
    .select({
      asignacionId: asignacion.id,
      referenciaId: asignacion.referenciaId,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      pedido: asignacion.pedido,
      estado: asignacion.estado,
      desde: asignacion.creadaEn,
      deNombre: de.nombre,
    })
    .from(asignacion)
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .innerJoin(de, eq(de.id, asignacion.deUsuarioId))
    .where(and(eq(asignacion.aUsuarioId, usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
    .orderBy(asc(asignacion.creadaEn));
  return filas.map((f) => ({ ...f, desde: f.desde.toISOString() }));
}

export interface CandidatoReasignacion {
  id: string;
  nombre: string;
  rol: string;
  organizacion: string;
  organizacionId: string;
  organizacionTipo: string;
  /** Pendientes que ya tiene (para repartir con criterio). */
  pendientes: number;
}

/** Personas a las que se puede reasignar: activas, no lectoras, distintas de quien sale. */
export async function candidatosReasignacion(ej: Ejecutor, actor: Actor, excluirUsuarioId: string): Promise<CandidatoReasignacion[]> {
  exigir(actor, 'supervisar');
  if (!esUuid(excluirUsuarioId)) return [];
  return ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      organizacion: organizacion.nombre,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
      pendientes: sql<number>`(select count(*)::int from ${asignacion} a where a.a_usuario_id = ${usuario.id} and a.estado in ('pendiente','en_curso'))`,
    })
    .from(usuario)
    .innerJoin(organizacion, and(eq(organizacion.id, usuario.organizacionId), eq(organizacion.activa, true)))
    .where(and(eq(usuario.activo, true), sql`${usuario.rol} <> 'lector'`, sql`${usuario.id} <> ${excluirUsuarioId}`))
    .orderBy(asc(organizacion.nombre), asc(usuario.nombre));
}

/** Cuantos administradores activos hay (para explicar por que no se puede quitar al ultimo). */
export async function contarAdminsActivos(ej: Ejecutor, actor: Actor): Promise<number> {
  exigir(actor, 'supervisar');
  const [r] = await ej
    .select({ n: sql<number>`count(*)::int` })
    .from(usuario)
    .where(and(eq(usuario.rol, 'admin'), eq(usuario.activo, true)));
  return r?.n ?? 0;
}

// ---- Organizaciones -----------------------------------------------------------------------------

export interface FilaOrganizacionAdmin {
  id: string;
  nombre: string;
  tipo: 'interna' | 'agencia';
  activa: boolean;
  usuariosActivos: number;
  usuariosTotal: number;
  /** Fichas a las que la organizacion tiene acceso vigente (solo tiene sentido en agencias). */
  fichasConAcceso: number;
  creadaEn: string;
}

export async function listarOrganizacionesAdmin(ej: Ejecutor, actor: Actor): Promise<FilaOrganizacionAdmin[]> {
  exigir(actor, 'supervisar');
  const filas = await ej
    .select({
      id: organizacion.id,
      nombre: organizacion.nombre,
      tipo: organizacion.tipo,
      activa: organizacion.activa,
      creadaEn: organizacion.creadaEn,
      usuariosActivos: sql<number>`(select count(*)::int from ${usuario} u where u.organizacion_id = "organizacion"."id" and u.activo)`,
      usuariosTotal: sql<number>`(select count(*)::int from ${usuario} u where u.organizacion_id = "organizacion"."id" and u.eliminado_en is null)`,
      fichasConAcceso: sql<number>`(select count(distinct a.referencia_id)::int from ${asignacion} a join ${usuario} u on u.id = a.a_usuario_id
        where u.organizacion_id = "organizacion"."id" and "organizacion"."tipo" = 'agencia'
          and (a.estado in ('pendiente','en_curso') or (a.estado in ('hecha','reasignada') and a.acceso_hasta is not null and a.acceso_hasta > now())))`,
    })
    .from(organizacion)
    .where(isNull(organizacion.eliminadaEn))
    .orderBy(asc(organizacion.tipo), desc(organizacion.activa), asc(organizacion.nombre));
  return filas.map((o) => ({ ...o, tipo: o.tipo as 'interna' | 'agencia', creadaEn: o.creadaEn.toISOString() }));
}

export async function obtenerOrganizacionAdmin(ej: Ejecutor, actor: Actor, organizacionId: string): Promise<FilaOrganizacionAdmin | null> {
  exigir(actor, 'supervisar');
  if (!esUuid(organizacionId)) return null;
  return (await listarOrganizacionesAdmin(ej, actor)).find((o) => o.id === organizacionId) ?? null;
}

export interface AccesoAgencia {
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  estadoFicha: string;
  archivada: boolean;
  /** `activo`: hay una asignacion abierta; `temporal`: la asignacion termino y el acceso corre hasta `accesoHasta`. */
  tipo: 'activo' | 'temporal';
  accesoHasta: string | null;
  personas: string[];
}

/** Fichas a las que una agencia tiene acceso hoy (para «Retirar acceso»). */
export async function accesosDeAgencia(ej: Ejecutor, actor: Actor, organizacionId: string): Promise<AccesoAgencia[]> {
  exigir(actor, 'supervisar');
  if (!esUuid(organizacionId)) return [];
  const filas = await ej
    .select({
      referenciaId: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      estadoFicha: referencia.estado,
      archivadaEn: referencia.archivadaEn,
      abiertas: sql<number>`(count(*) filter (where ${asignacion.estado} in ('pendiente','en_curso')))::int`,
      hasta: sql<Date | string | null>`max(${asignacion.accesoHasta}) filter (where ${asignacion.estado} in ('hecha','reasignada') and ${asignacion.accesoHasta} > now())`,
      personas: sql<string[]>`array_agg(distinct ${usuario.nombre})`,
    })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(
      and(
        eq(usuario.organizacionId, organizacionId),
        sql`(${asignacion.estado} in ('pendiente','en_curso') or (${asignacion.estado} in ('hecha','reasignada') and ${asignacion.accesoHasta} is not null and ${asignacion.accesoHasta} > now()))`,
      ),
    )
    .groupBy(referencia.id)
    .orderBy(asc(referencia.codigo))
    .limit(300);
  return filas.map((f) => ({
    referenciaId: f.referenciaId,
    codigo: f.codigo,
    nombreProducto: f.nombreProducto,
    estadoFicha: f.estadoFicha,
    archivada: f.archivadaEn !== null,
    tipo: f.abiertas > 0 ? 'activo' : 'temporal',
    accesoHasta: f.hasta ? new Date(f.hasta).toISOString() : null,
    personas: f.personas,
  }));
}

export interface FichaVariasAgencias {
  referenciaId: string;
  codigo: string;
  agencias: string[];
}

/** Regla «una agencia a la vez» (D-29): fichas que hoy estan abiertas a mas de una agencia. */
export async function fichasConVariasAgencias(ej: Ejecutor, actor: Actor): Promise<FichaVariasAgencias[]> {
  exigir(actor, 'supervisar');
  return ej
    .select({
      referenciaId: referencia.id,
      codigo: referencia.codigo,
      agencias: sql<string[]>`array_agg(distinct ${organizacion.nombre})`,
    })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .innerJoin(referencia, eq(referencia.id, asignacion.referenciaId))
    .where(
      and(
        eq(organizacion.tipo, 'agencia'),
        sql`(${asignacion.estado} in ('pendiente','en_curso') or (${asignacion.estado} in ('hecha','reasignada') and ${asignacion.accesoHasta} is not null and ${asignacion.accesoHasta} > now()))`,
      ),
    )
    .groupBy(referencia.id)
    .having(sql`count(distinct ${organizacion.id}) > 1`)
    .orderBy(asc(referencia.codigo))
    .limit(50);
}

// ---- Resumen ------------------------------------------------------------------------------------

export interface ResumenAdmin {
  usuarios: { activos: number; inactivos: number; sinIngreso: number };
  sinIngresoLista: Array<{ id: string; nombre: string; email: string; creadoEn: string }>;
  organizaciones: { internas: number; agencias: number };
  agenciasSinUsuarios: Array<{ id: string; nombre: string }>;
  fichasConVariasAgencias: FichaVariasAgencias[];
}

export async function resumenAdmin(ej: Ejecutor, actor: Actor): Promise<ResumenAdmin> {
  exigir(actor, 'supervisar');
  const [u] = await ej
    .select({
      activos: sql<number>`(count(*) filter (where ${usuario.activo}))::int`,
      inactivos: sql<number>`(count(*) filter (where not ${usuario.activo} and ${usuario.eliminadoEn} is null))::int`,
      sinIngreso: sql<number>`(count(*) filter (where ${usuario.activo} and ${usuario.ultimoIngreso} is null))::int`,
    })
    .from(usuario)
    .where(isNull(usuario.eliminadoEn));
  const sinIngresoLista = await ej
    .select({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, creadoEn: usuario.creadoEn })
    .from(usuario)
    .where(and(eq(usuario.activo, true), isNull(usuario.ultimoIngreso)))
    .orderBy(asc(usuario.creadoEn))
    .limit(5);
  const orgs = await ej
    .select({ tipo: organizacion.tipo, n: sql<number>`count(*)::int` })
    .from(organizacion)
    .where(eq(organizacion.activa, true))
    .groupBy(organizacion.tipo);
  const agenciasSinUsuarios = await ej
    .select({ id: organizacion.id, nombre: organizacion.nombre })
    .from(organizacion)
    .where(
      and(
        eq(organizacion.tipo, 'agencia'),
        eq(organizacion.activa, true),
        sql`not exists (select 1 from ${usuario} u where u.organizacion_id = ${organizacion.id} and u.activo)`,
      ),
    )
    .orderBy(asc(organizacion.nombre));
  return {
    usuarios: u ?? { activos: 0, inactivos: 0, sinIngreso: 0 },
    sinIngresoLista: sinIngresoLista.map((x) => ({ ...x, creadoEn: x.creadoEn.toISOString() })),
    organizaciones: {
      internas: orgs.find((o) => o.tipo === 'interna')?.n ?? 0,
      agencias: orgs.find((o) => o.tipo === 'agencia')?.n ?? 0,
    },
    agenciasSinUsuarios,
    fichasConVariasAgencias: await fichasConVariasAgencias(ej, actor),
  };
}
