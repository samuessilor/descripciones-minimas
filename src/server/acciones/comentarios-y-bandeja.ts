/**
 * Comentarios con alcance (RV-29, 9 punto 9), bandeja de pendientes y notificaciones (SPEC 14).
 *
 *  - `comentar`: inmutable (no hay editar ni borrar), permitido tambien en fichas CLASIFICADAS; el rol
 *    aduana solo escribe `todos`; un comentario `interno` no se notifica ni se muestra a la aduana.
 *  - `listarMisPendientes`, `listarNotificaciones`, `marcarNotificacionLeida`, `marcarTodasLeidas`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, comentario, notificacion } from '@/db/esquema';
import { getCampo } from '@/dominio/campos';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { puede, visibilidadesComentarioPermitidas } from '@/dominio/permisos';
import { cargarPerfiles } from '../colaboracion/comun';
import { crearNotificacion } from '../notificaciones/crear';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { notificacionesDe, pendientesDe, type FilaPendiente, type ListaNotificaciones } from '../politicas/colaboracion';
import { cargarReferenciaVisible } from '../politicas/referencias';
import { agenciasConAcceso } from './asignaciones';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export type { FilaPendiente } from '../politicas/colaboracion';

export const entradaComentar = z.object({
  referenciaId: z.uuid(),
  campo: z.string().min(1).max(120).optional(),
  texto: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el comentario.').max(2000, 'El comentario puede tener hasta 2000 caracteres.')),
  visibilidad: z.enum(['interno', 'todos']),
});

export interface EntradaComentar {
  referenciaId: string;
  campo?: string;
  texto: string;
  visibilidad: 'interno' | 'todos';
}

export interface ResultadoComentar {
  id: string;
  notificados: number;
}

export async function comentar(ctx: Contexto, entrada: unknown): Promise<ResultadoComentar> {
  const e = parsear(entradaComentar, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  if (!puede(actor, 'comentar')) {
    throw new ErrorAccion('SIN_PERMISO', 'Tu rol puede consultar las referencias, pero no comentar.');
  }
  if (!visibilidadesComentarioPermitidas(actor.rol).includes(e.visibilidad)) {
    throw new ErrorAccion('SIN_PERMISO', 'Tus comentarios los ve todo el equipo con acceso a la referencia. Elige «Visible para todos».');
  }

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaVisible(tx, actor, e.referenciaId, ahora);
    if (ficha.archivadaEn) {
      throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia está archivada y no admite comentarios nuevos.');
    }
    let etiquetaCampo: string | null = null;
    if (e.campo) {
      const def = getCampo(e.campo);
      if (!def) throw new ErrorAccion('VALIDACION', 'Ese campo no existe.');
      etiquetaCampo = def.etiqueta;
    }

    const [fila] = await tx
      .insert(comentario)
      .values({
        referenciaId: ficha.id,
        campo: e.campo ?? null,
        autorId: actor.usuarioId,
        texto: e.texto,
        visibilidad: e.visibilidad,
        creadoEn: ahora,
      })
      .returning({ id: comentario.id });
    if (!fila) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo guardar el comentario.');

    // A quien se avisa: asignados activos, quien envio y quien creo la ficha; nunca al autor (14).
    const activas = await tx
      .select({ a: asignacion.aUsuarioId, de: asignacion.deUsuarioId })
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, ficha.id), inArray(asignacion.estado, ['pendiente', 'en_curso'])));
    const candidatos = new Set<string>([ficha.creadaPor, ...activas.flatMap((x) => [x.a, x.de])]);
    candidatos.delete(actor.usuarioId);
    const perfiles = await cargarPerfiles(tx, [...candidatos]);
    // Una agencia a la que se le retiro el acceso puede seguir como remitente de una asignacion activa: no se le avisa
    const agencias = new Set((await agenciasConAcceso(tx, ficha.id, ahora)).map((a) => a.id));
    let notificados = 0;
    for (const id of candidatos) {
      const p = perfiles.get(id);
      if (!p || !p.activo || !p.organizacionActiva || p.rol === 'lector') continue;
      // Un comentario interno jamas se notifica a una agencia, ni uno de todos a una agencia que ya no ve la ficha.
      if (p.organizacionTipo === 'agencia' && (e.visibilidad === 'interno' || !agencias.has(p.organizacionId))) continue;
      const donde = etiquetaCampo ? ` en «${etiquetaCampo}» de ${ficha.codigo}` : ` en ${ficha.codigo}`;
      const otraAgencia = p.organizacionTipo === 'agencia' && actor.organizacionTipo === 'agencia' && p.organizacionId !== actor.organizacionId;
      await crearNotificacion(tx, {
        usuarioId: p.id,
        tipo: 'comentario',
        referenciaId: ficha.id,
        titulo: `${otraAgencia ? 'Otra agencia' : nombreSinMarca(actor.nombre)} comentó${donde}`,
        creadaEn: ahora,
      });
      notificados += 1;
    }
    return { id: fila.id, notificados };
  });
}

// ---- Bandeja -------------------------------------------------------------------------------------------------

/** Asignaciones `pendiente`/`en_curso` hacia el actor; primero las que mas dias llevan en gestion (S-09). */
export async function listarMisPendientes(ctx: Contexto): Promise<FilaPendiente[]> {
  return pendientesDe(ctx.db, ctx.actor, ahoraDe(ctx));
}

export async function listarNotificaciones(
  ctx: Contexto,
  entrada: { soloNoLeidas?: boolean; soloLeidas?: boolean; limite?: number; antes?: string | null },
): Promise<ListaNotificaciones> {
  const e = parsear(
    z.object({
      soloNoLeidas: z.boolean().optional(),
      soloLeidas: z.boolean().optional(),
      limite: z.number().int().min(1).max(100).optional(),
      antes: z.string().max(100).nullish(),
    }),
    entrada ?? {},
  );
  return notificacionesDe(ctx.db, ctx.actor, e);
}

/** Marca una notificacion como leida. Idempotente; solo las propias. */
export async function marcarNotificacionLeida(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const { notificacionId } = parsear(z.object({ notificacionId: z.uuid() }), entrada);
  const propia = await ctx.db
    .select({ id: notificacion.id })
    .from(notificacion)
    .where(and(eq(notificacion.id, notificacionId), eq(notificacion.usuarioId, ctx.actor.usuarioId)))
    .limit(1);
  if (propia.length === 0) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese aviso.');
  await ctx.db
    .update(notificacion)
    .set({ leidaEn: ahoraDe(ctx) })
    .where(and(eq(notificacion.id, notificacionId), isNull(notificacion.leidaEn)));
  return { ok: true };
}

export async function marcarTodasLeidas(ctx: Contexto): Promise<{ marcadas: number }> {
  const filas = await ctx.db
    .update(notificacion)
    .set({ leidaEn: ahoraDe(ctx) })
    .where(and(eq(notificacion.usuarioId, ctx.actor.usuarioId), isNull(notificacion.leidaEn)))
    .returning({ id: notificacion.id });
  return { marcadas: filas.length };
}
