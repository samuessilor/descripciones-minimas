/**
 * Organizaciones (M1, 10.4): areas internas y agencias de aduana. Crear, renombrar, activar o desactivar,
 * y «Retirar acceso» de una agencia a una ficha (8.3 regla 10). Una agencia se borra con sus cuentas si ninguna dejo trabajo propio.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, campoHistorial, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor, Tx } from '@/db/tipos';
import { normalizarUsuario, usuarioSugeridoAgencia, validarUsuario } from '@/dominio/credenciales';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { generarClave, hashearClave } from '../claves';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { exigir } from '../politicas/exigir';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { insertarCuenta, traducirChoqueCuenta } from './usuarios';
import { filasDe, llamarBorrado, mensajeDeBase } from '../sql';
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

/** Crea la organizacion y deja su auditoria, dentro de la transaccion de quien llama. */
async function insertarOrganizacion(ctx: Contexto, tx: Tx, nombre: string, tipo: 'interna' | 'agencia', ahora: Date): Promise<string> {
  await exigirNombreLibre(tx, nombre);
  const [o] = await tx.insert(organizacion).values({ nombre, tipo, creadaEn: ahora }).returning({ id: organizacion.id });
  if (!o) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear la organización.');
  await auditar(tx, {
    usuarioId: ctx.actor.usuarioId,
    accion: 'crear_organizacion',
    entidad: 'organizacion',
    entidadId: o.id,
    detalle: { nombre, tipo },
    ip: ctx.ip,
    creadoEn: ahora,
  });
  return o.id;
}

export async function crearOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ id: string }> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaCrearOrganizacion, entrada);
  const ahora = ahoraDe(ctx);
  try {
    return await ctx.db.transaction(async (tx) => ({ id: await insertarOrganizacion(ctx, tx, e.nombre, e.tipo, ahora) }));
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorAccion('DUPLICADO', 'Ya existe una organización con ese nombre.');
    throw err;
  }
}

export const entradaCrearAgencia = z.object({
  nombre: nombreOrg(),
  /** Opcional: si falta, se usa el sugerido (`<empresa>.aduana`). */
  usuario: z.string().transform(normalizarUsuario).nullish(),
});

export interface ResultadoCrearAgencia {
  organizacionId: string;
  cuentaId: string;
  nombre: string;
  usuario: string;
  /** Solo si la crea el administrador. Con la supervisora es `null`: la cuenta nace con su clave y el administrador la ve y la entrega. */
  claveTemporal: string | null;
}

/**
 * Una agencia de aduana en UN solo paso: la organizacion y su unica cuenta (rol aduana, nombre = el de la empresa) en una
 * misma transaccion; si falla la cuenta no queda la organizacion. La clave se genera siempre; la ve en pantalla solo el
 * administrador. Si actua la supervisora, el administrador recibe el aviso y la ve (cifrada, `verClaveEntrega`) en la ficha de la cuenta.
 */
export async function crearAgencia(ctx: Contexto, entrada: unknown): Promise<ResultadoCrearAgencia> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(entradaCrearAgencia, entrada);
  const usuarioCuenta = e.usuario || usuarioSugeridoAgencia(e.nombre);
  const problema = validarUsuario(usuarioCuenta);
  if (problema) throw new ErrorAccion('VALIDACION', 'Revisa los datos marcados.', { problemas: [{ ruta: 'usuario', mensaje: problema }] });
  const ahora = ahoraDe(ctx);

  const generada = generarClave();
  const hash = await hashearClave(generada);
  const claveTemporal = puede(ctx.actor, 'administrar') ? generada : null;
  try {
    return await ctx.db.transaction(async (tx) => {
      const organizacionId = await insertarOrganizacion(ctx, tx, e.nombre, 'agencia', ahora);
      const cuentaId = await insertarCuenta(
        ctx,
        tx,
        { nombre: e.nombre, usuario: usuarioCuenta, organizacion: { id: organizacionId, nombre: e.nombre, tipo: 'agencia' }, rol: 'aduana' },
        hash,
        ahora,
        generada,
      );
      return { organizacionId, cuentaId, nombre: e.nombre, usuario: usuarioCuenta, claveTemporal };
    });
  } catch (err) {
    const traducido = traducirChoqueCuenta(err, false);
    if (traducido !== err) throw traducido;
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
      if (!o || o.eliminadaEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
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
  exigir(ctx.actor, 'supervisar');
  const e = parsear(z.object({ organizacionId: z.uuid(), activa: z.boolean() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [o] = await tx.select().from(organizacion).where(eq(organizacion.id, e.organizacionId)).for('update').limit(1);
    if (!o || o.eliminadaEn) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
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

/** Una cuenta de una organizacion, vista desde «¿se puede borrar?». */
export interface CuentaParaBorrar {
  id: string;
  nombre: string;
  usuario: string | null;
  rol: string;
  /** Dejo trabajo propio (historial, comentarios, fotos, fichas creadas o cerradas): al borrarla se RETIRA y su nombre sigue en el historial. */
  conTrabajo: boolean;
  /** Referencias que tiene pendientes ahora; al borrarla se le quitan. */
  pendientes: number;
}

/** Que se llevaria consigo borrar una organizacion y si algo lo impide. Lo usa la pagina (boton y aviso) y el nucleo. */
export interface DiagnosticoBorradoOrg {
  tipo: string;
  cuentas: CuentaParaBorrar[];
  /** Hay cambios de campos registrados a nombre de la organizacion: al borrarla queda como «… (eliminada)» en el historial. */
  conHistorial: boolean;
  /** Texto del impedimento, o `null` si se puede borrar. */
  impedimento: string | null;
}

export async function diagnosticoBorradoOrganizacion(ej: Ejecutor, organizacionId: string, nombre: string, tipo: string): Promise<DiagnosticoBorradoOrg> {
  const filas = filasDe<{ id: string; nombre: string; username: string | null; rol: string; con_trabajo: boolean; pendientes: number }>(
    await ej.execute(sql`
      select u.id, u.nombre, u.username, u.rol, public.usuario_tiene_trabajo(u.id) as con_trabajo,
             (select count(*)::int from asignacion a where a.a_usuario_id = u.id and a.estado in ('pendiente','en_curso')) as pendientes
        from usuario u where u.organizacion_id = ${organizacionId}::uuid and u.eliminado_en is null order by u.nombre`),
  );
  const cuentas: CuentaParaBorrar[] = filas.map((f) => ({ id: f.id, nombre: f.nombre, usuario: f.username, rol: f.rol, conTrabajo: f.con_trabajo, pendientes: Number(f.pendientes) }));
  const [h] = await ej.select({ n: sql<number>`count(*)::int` }).from(campoHistorial).where(eq(campoHistorial.organizacionId, organizacionId));
  const conHistorial = (h?.n ?? 0) > 0;
  let impedimento: string | null = null;
  if (tipo !== 'agencia' && cuentas.length > 0) {
    impedimento = `${nombre} tiene ${cuentas.length} ${cuentas.length === 1 ? 'cuenta' : 'cuentas'} (activas o desactivadas) y no se puede borrar: se perdería quién hizo cada cambio. Desactívala en su lugar.`;
  }
  return { tipo, cuentas, conHistorial, impedimento };
}

/**
 * Borrar una organizacion. Una INTERNA (creada por error) solo si no tiene ninguna cuenta. Una AGENCIA se va con sus cuentas
 * (reunion 2026-11-10: «si se elimina la organizacion se eliminan sus cuentas»). Si la agencia o sus cuentas YA TRABAJARON, no se pierde
 * quien hizo cada cambio (2026-11-11): la organizacion y esas cuentas se RETIRAN: quedan anonimizadas y fuera de las listas, renombradas
 * «… (eliminada)», y el historial de las referencias cerradas sigue diciendo que las hizo esa agencia. Lo que nunca trabajo se borra
 * del todo. Lo operativo (pendientes, avisos, sesiones, clave) se va siempre. Supervisora y administrador pueden. Auditado con el nombre.
 */
export async function eliminarOrganizacion(ctx: Contexto, entrada: unknown): Promise<{ ok: true; nombre: string; cuentasEliminadas: number }> {
  exigir(ctx.actor, 'supervisar');
  const e = parsear(z.object({ organizacionId: z.uuid() }), entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    // El bloqueo de la fila serializa con crear una cuenta en esta organizacion (su clave foranea toma el mismo candado).
    const [o] = await tx.select().from(organizacion).where(eq(organizacion.id, e.organizacionId)).for('update').limit(1);
    if (!o) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa organización.');
    if (o.eliminadaEn) throw new ErrorAccion('NO_ENCONTRADO', 'Esa organización ya fue eliminada.');
    const d = await diagnosticoBorradoOrganizacion(tx, o.id, o.nombre, o.tipo);
    if (d.impedimento) throw new ErrorAccion('VALIDACION', d.impedimento, { cuentas: d.cuentas.length });
    // No se borran cuentas de administrador ni de supervisora desde aqui (solo las de area y de agencia).
    if (d.cuentas.some((c) => c.rol === 'admin' || c.rol === 'supervisor')) {
      throw new ErrorAccion('VALIDACION', `${o.nombre} tiene cuentas de administración y no se puede borrar.`);
    }
    let resumen;
    try {
      resumen = await llamarBorrado(tx, 'eliminar_organizacion', o.id);
    } catch (err) {
      if (mensajeDeBase(err).includes('organizacion_interna_con_cuentas')) {
        throw new ErrorAccion('VALIDACION', `${o.nombre} es un área interna con cuentas y no se puede borrar. Desactívala en su lugar.`);
      }
      throw err;
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'eliminar_organizacion',
      entidad: 'organizacion',
      entidadId: o.id,
      detalle: { nombre: o.nombre, tipo: o.tipo, activa: o.activa, conservadaEnHistorial: resumen.retirada === true, cuentas: d.cuentas.map((c) => c.usuario ?? c.nombre), pendientesQuitados: d.cuentas.reduce((a, c) => a + c.pendientes, 0) },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, nombre: o.nombre, cuentasEliminadas: d.cuentas.length };
  });
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
