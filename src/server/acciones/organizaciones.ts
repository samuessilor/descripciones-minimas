/**
 * Organizaciones (M1, 10.4): areas internas y agencias de aduana. Crear, renombrar, activar o desactivar,
 * y «Retirar acceso» de una agencia a una ficha (8.3 regla 10). Nada se borra.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { exigir } from '../politicas/exigir';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { parsear, textoLimpio } from './validacion';

/**
 * El UNIQUE de la base distingue mayusculas: «Area Pruebas» y «area pruebas» pasarian las dos. Se compara sin
 * distinguirlas (y sin la propia organizacion al renombrar, para poder corregir su capitalizacion).
 */
async function exigirNombreLibre(tx: Ejecutor, nombre: string, excepto?: string): Promise<void> {
  const mismoNombre = sql`lower(trim(${organizacion.nombre})) = lower(${nombre})`;
  const [otra] = await tx
    .select({ id: organizacion.id })
    .from(organizacion)
    .where(excepto ? and(mismoNombre, ne(organizacion.id, excepto)) : mismoNombre)
    .limit(1);
  if (otra) throw new ErrorAccion('DUPLICADO', 'Ya existe una organización con ese nombre.');
}

const nombreOrg = () => textoLimpio().pipe(z.string().trim().min(2, 'Escribe el nombre (al menos 2 letras).').max(120, 'El nombre es muy largo.'));

export const entradaCrearOrganizacion = z.object({
  nombre: nombreOrg(),
  tipo: z.enum(['interna', 'agencia']),
});

export async function crearOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaCrearOrganizacion, entrada);
  const ahora = ahoraDe(ctx);
  try {
    return await ctx.db.transaction(async (tx) => {
      await exigirNombreLibre(tx, e.nombre);
      const [o] = await tx
        .insert(organizacion)
        .values({ nombre: e.nombre, tipo: e.tipo, creadaEn: ahora })
        .returning({ id: organizacion.id });
      if (!o) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear la organización.');
      await auditar(tx, {
        usuarioId: ctx.actor.usuarioId,
        accion: 'crear_organizacion',
        entidad: 'organizacion',
        entidadId: o.id,
        detalle: { nombre: e.nombre, tipo: e.tipo },
        ip: ctx.ip,
        creadoEn: ahora,
      });
      return { id: o.id };
    });
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorAccion('DUPLICADO', 'Ya existe una organización con ese nombre.');
    throw err;
  }
}

/** Renombrar. El tipo no cambia: los roles de sus usuarios dependen de el (D-28). */
export async function editarOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(z.object({ organizacionId: z.uuid(), nombre: nombreOrg() }), entrada);
  const ahora = ahoraDe(ctx);
  try {
    await ctx.db.transaction(async (tx) => {
      const [o] = await tx.select().from(organizacion).where(eq(organizacion.id, e.organizacionId)).for('update').limit(1);
      if (!o) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
      if (o.nombre === e.nombre) return;
      await exigirNombreLibre(tx, e.nombre, o.id);
      await tx.update(organizacion).set({ nombre: e.nombre }).where(eq(organizacion.id, o.id));
      await auditar(tx, {
        usuarioId: ctx.actor.usuarioId,
        accion: 'editar_organizacion',
        entidad: 'organizacion',
        entidadId: o.id,
        detalle: { de: o.nombre, a: e.nombre },
        ip: ctx.ip,
        creadoEn: ahora,
      });
    });
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorAccion('DUPLICADO', 'Ya existe una organización con ese nombre.');
    throw err;
  }
  return { ok: true };
}

/**
 * Activar / desactivar. Una organizacion con personas activas no se desactiva: su gente quedaria sin poder
 * entrar (13.1) sin que nadie haya decidido que pasa con sus pendientes. Primero se desactiva o se mueve a las
 * personas (con su reasignacion) y despues la organizacion.
 */
export async function cambiarEstadoOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigir(ctx.actor, 'administrar');
  const e = parsear(z.object({ organizacionId: z.uuid(), activa: z.boolean() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [o] = await tx.select().from(organizacion).where(eq(organizacion.id, e.organizacionId)).for('update').limit(1);
    if (!o) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
    if (o.activa === e.activa) return;
    if (!e.activa) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(usuario)
        .where(and(eq(usuario.organizacionId, o.id), eq(usuario.activo, true)));
      const n = r?.n ?? 0;
      if (n > 0) {
        throw new ErrorAccion(
          'VALIDACION',
          `${o.nombre} tiene ${n} ${n === 1 ? 'persona activa' : 'personas activas'}. Desactívalas o muévelas a otra organización y vuelve a intentar.`,
          { personasActivas: n },
        );
      }
    }
    await tx.update(organizacion).set({ activa: e.activa }).where(eq(organizacion.id, o.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'cambiar_estado_organizacion',
      entidad: 'organizacion',
      entidadId: o.id,
      detalle: { activa: e.activa, nombre: o.nombre },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

export interface ResultadoRetiroAcceso {
  ok: true;
  canceladas: number;
  accesosCerrados: number;
}

/**
 * «Retirar acceso a [agencia]» (8.3 regla 10): `acceso_hasta = ahora` y se cancelan las asignaciones activas
 * de esa agencia en la ficha. Corta TODA la organizacion, no solo a una persona. Auditado. Lo que la agencia
 * ya escribio sigue en el historial de la ficha (nada se borra).
 */
export async function retirarAccesoAgencia(ctx: Contexto, entrada: unknown): Promise<ResultadoRetiroAcceso> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(z.object({ referenciaId: z.uuid(), organizacionId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizacion).where(eq(organizacion.id, e.organizacionId)).limit(1);
    if (!org) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
    if (org.tipo !== 'agencia') throw new ErrorAccion('VALIDACION', 'Solo se retira el acceso a una agencia de aduana.');
    const [ficha] = await tx.select({ id: referencia.id, codigo: referencia.codigo }).from(referencia).where(eq(referencia.id, e.referenciaId)).limit(1);
    if (!ficha) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa referencia.');

    const personas = tx.select({ id: usuario.id }).from(usuario).where(eq(usuario.organizacionId, org.id));
    const canceladas = await tx
      .update(asignacion)
      .set({ estado: 'cancelada', completadaEn: ahora, accesoHasta: ahora })
      .where(
        and(
          eq(asignacion.referenciaId, ficha.id),
          inArray(asignacion.estado, ['pendiente', 'en_curso']),
          inArray(asignacion.aUsuarioId, personas),
        ),
      )
      .returning({ id: asignacion.id });
    const cerrados = await tx
      .update(asignacion)
      .set({ accesoHasta: ahora })
      .where(
        and(
          eq(asignacion.referenciaId, ficha.id),
          inArray(asignacion.estado, ['hecha', 'reasignada']),
          inArray(asignacion.aUsuarioId, personas),
          sql`${asignacion.accesoHasta} > ${ahora.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: asignacion.id });

    if (canceladas.length === 0 && cerrados.length === 0) {
      throw new ErrorAccion('VALIDACION', `${org.nombre} no tiene acceso a ${ficha.codigo}. No hay nada que retirar.`);
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'retirar_acceso_agencia',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { organizacionId: org.id, organizacion: org.nombre, canceladas: canceladas.length, accesosCerrados: cerrados.length },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, canceladas: canceladas.length, accesosCerrados: cerrados.length };
  });
}
