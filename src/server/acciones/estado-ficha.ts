/**
 * Presencia y sondeo (D-17, 12.4): sin websockets (Vercel). Al enfocar un campo el cliente envia un
 * latido cada 15 s (`edicion_activa.hasta = ahora + 45 s`); la ficha abierta consulta `estadoFicha`
 * cada ~15 s y, si cambio `version`, refresca los campos modificados. Es un AVISO, no un candado:
 * el conflicto real lo cubre `versionEsperada`.
 */
import { and, asc, desc, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { edicionActiva, usuario } from '@/db/esquema';
import type { TipoOrganizacion } from '@/dominio/permisos';
import { autorVisible, puedeEscribirCampo } from '@/dominio/permisos';
import { getCampo } from '@/dominio/campos';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { cargarReferenciaVisible, NOMBRE_OTRA_AGENCIA } from '../politicas/referencias';
import { ErrorAccion } from './resultado';
import { parsear } from './validacion';

export const VIGENCIA_LATIDO_MS = 45_000;

/**
 * Tope de campos que una persona puede tener marcados como "editando" a la vez en una ficha. Quien teclea
 * esta en uno o dos; el tope impide que un cliente defectuoso o hostil llene la tabla y ensucie el aviso de
 * los demas. Al pasarlo se descartan los latidos MAS VIEJOS de esa persona en esa ficha.
 */
export const MAX_LATIDOS_ACTIVOS = 10;

export interface EstadoFicha {
  /** `referencia.version`: cambia con cada escritura. */
  version: number;
  estado: string;
  actualizadaEn: string;
  /** Version de cada campo con valor: el cliente compara con la suya para ver que cambio. */
  camposVersion: Record<string, number>;
  /** Otras personas editando ahora (sin contar al propio actor). */
  editando: Array<{ campo: string; usuario: string; hasta: string }>;
}

const entradaFicha = z.object({ referenciaId: z.uuid() });
const entradaLatido = z.object({ referenciaId: z.uuid(), campo: z.string().min(1).max(120) });

export async function estadoFicha(ctx: Contexto, entrada: unknown): Promise<EstadoFicha> {
  const { referenciaId } = parsear(entradaFicha, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const ficha = await cargarReferenciaVisible(ctx.db, actor, referenciaId, ahora);

  const activos = await ctx.db
    .select({
      campo: edicionActiva.campo,
      hasta: edicionActiva.hasta,
      usuarioId: edicionActiva.usuarioId,
    })
    .from(edicionActiva)
    .where(
      and(
        eq(edicionActiva.referenciaId, ficha.id),
        gt(edicionActiva.hasta, ahora),
        ne(edicionActiva.usuarioId, actor.usuarioId),
      ),
    )
    .orderBy(asc(edicionActiva.campo));

  const autores = activos.length
    ? await ctx.db
        .select({
          id: usuario.id,
          nombre: usuario.nombre,
          organizacionId: usuario.organizacionId,
          organizacionTipo: usuario.organizacionTipo,
        })
        .from(usuario)
        .where(inArray(usuario.id, [...new Set(activos.map((a) => a.usuarioId))]))
    : [];
  const porId = new Map(autores.map((a) => [a.id, a]));

  const camposVersion: Record<string, number> = {};
  for (const [clave, e] of Object.entries(ficha.datos ?? {})) camposVersion[clave] = e.n;

  return {
    version: ficha.version,
    estado: ficha.estado,
    actualizadaEn: ficha.actualizadaEn.toISOString(),
    camposVersion,
    editando: activos.map((a) => {
      const u = porId.get(a.usuarioId);
      const nombre = !u
        ? 'Alguien'
        : autorVisible(actor, { organizacionId: u.organizacionId, organizacionTipo: u.organizacionTipo as TipoOrganizacion }) ===
            'otra_agencia'
          ? NOMBRE_OTRA_AGENCIA
          : u.nombre;
      return { campo: a.campo, usuario: nombre, hasta: a.hasta.toISOString() };
    }),
  };
}

/** Latido de edicion: marca que el actor tiene el campo enfocado. Solo para quien puede escribirlo. */
export async function latidoEdicion(ctx: Contexto, entrada: unknown): Promise<{ hasta: string }> {
  const e = parsear(entradaLatido, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const ficha = await cargarReferenciaVisible(ctx.db, actor, e.referenciaId, ahora);

  const campo = getCampo(e.campo);
  if (!campo) throw new ErrorAccion('VALIDACION', 'Campo desconocido.');
  const permiso = puedeEscribirCampo(actor, campo, {
    estado: ficha.estado as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA',
    archivada: ficha.archivadaEn !== null,
    creadaPor: ficha.creadaPor,
  });
  if (!permiso.ok) throw new ErrorAccion(permiso.codigo, 'No puedes editar este campo.');

  const hasta = new Date(ahora.getTime() + VIGENCIA_LATIDO_MS);
  await ctx.db
    .insert(edicionActiva)
    .values({ referenciaId: ficha.id, campo: e.campo, usuarioId: actor.usuarioId, hasta })
    .onConflictDoUpdate({
      target: [edicionActiva.referenciaId, edicionActiva.campo, edicionActiva.usuarioId],
      set: { hasta },
    });
  // Tope por (ficha, persona): se descartan los latidos mas viejos, nunca el que acaba de llegar.
  const mios = await ctx.db
    .select({ campo: edicionActiva.campo })
    .from(edicionActiva)
    .where(and(eq(edicionActiva.referenciaId, ficha.id), eq(edicionActiva.usuarioId, actor.usuarioId), ne(edicionActiva.campo, e.campo)))
    .orderBy(desc(edicionActiva.hasta));
  const sobran = mios.slice(MAX_LATIDOS_ACTIVOS - 1).map((m) => m.campo);
  if (sobran.length > 0) {
    await ctx.db
      .delete(edicionActiva)
      .where(and(eq(edicionActiva.referenciaId, ficha.id), eq(edicionActiva.usuarioId, actor.usuarioId), inArray(edicionActiva.campo, sobran)));
  }
  // Limpieza oportunista de latidos vencidos de esta ficha.
  await ctx.db.delete(edicionActiva).where(and(eq(edicionActiva.referenciaId, ficha.id), lt(edicionActiva.hasta, ahora)));
  return { hasta: hasta.toISOString() };
}

/** El actor dejo el campo: deja de aparecer como "escribiendo". */
export async function terminarEdicion(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const e = parsear(entradaLatido, entrada);
  await ctx.db
    .delete(edicionActiva)
    .where(
      and(
        eq(edicionActiva.referenciaId, e.referenciaId),
        eq(edicionActiva.campo, e.campo),
        eq(edicionActiva.usuarioId, ctx.actor.usuarioId),
      ),
    );
  return { ok: true };
}
