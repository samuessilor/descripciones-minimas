/**
 * `crearReferencia` (12.4, 6.3, F1, F10): crea la ficha con codigo, nombre y tipo.
 *  - normaliza el codigo (D-27) y, si ya existe uno --archivado o no--, devuelve `DUPLICADO` con el
 *    id y el estado existente; la violacion del indice unico por una carrera tambien es `DUPLICADO`;
 *  - lista "posibles duplicados" (mismo codigo sin ceros a la izquierda, o parecido por
 *    prefijo/contiene) SIN bloquear;
 *  - `similarDe` copia solo los campos compartidos (F10), nunca codigo, nombre, valor, cantidad,
 *    partida ni clasificacion.
 * Los datos iniciales se escriben como hechos en `campo_historial` (version 1), de modo que la
 * proyeccion `datos` siempre se pueda reconstruir desde el historial.
 */
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { referencia } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { AREAS, esArea } from '@/dominio/areas';
import { esVisible, getCampo, TIPOS_PRODUCTO, type TipoProducto } from '@/dominio/campos';
import { compararFechas, fechaBogota } from '@/dominio/dias-gestion';
import { escaparLike, normalizarCodigo } from '@/dominio/normalizacion';
import { puede } from '@/dominio/permisos';
import { esFechaValida, estaVacio } from '@/dominio/valores';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { cargarReferenciaVisible, condicionVisible } from '../politicas/referencias';
import { aplicarEscritura } from './escritura';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const entradaCrearReferencia = z.object({
  codigo: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el código de la referencia.').max(80)),
  nombreProducto: textoLimpio().pipe(z.string().trim().min(1, 'Escribe la descripción según factura.').max(500)),
  tipoProducto: z.enum(TIPOS_PRODUCTO),
  /** Area responsable (P4). Si no llega (API, pruebas), se toma la de la referencia de origen o la de quien crea; si no hay, queda pendiente. */
  areaResponsable: z.enum(AREAS, 'Elige el área responsable.').optional(),
  fechaSolicitud: z.string().optional(),
  similarDe: z.uuid().optional(),
});

export interface PosibleDuplicado {
  id: string;
  codigo: string;
  nombreProducto: string;
  estado: string;
  archivada: boolean;
}

export interface ResultadoCrearReferencia {
  id: string;
  codigo: string;
  posiblesDuplicados: PosibleDuplicado[];
}

/** Campos compartidos que "Crear similar" copia (F10). */
export const CAMPOS_SIMILAR: readonly string[] = [
  'maquina_destino',
  'proveedor',
  'marca',
  'pais_origen',
  'fabricante',
  'reembolsable',
  'unidad_medida',
  'aspecto_fisico',
  'tipo_empaque',
  'cantidad_empaque',
];

const ETIQUETA_ESTADO: Record<string, string> = {
  BORRADOR: 'Borrador',
  EN_GESTION: 'En gestión',
  CLASIFICADA: 'Clasificada',
};

async function buscarPorCodigoNorm(tx: Tx | Contexto['db'], norm: string) {
  const [f] = await tx
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      estado: referencia.estado,
      archivadaEn: referencia.archivadaEn,
    })
    .from(referencia)
    .where(eq(referencia.codigoNorm, norm))
    .limit(1);
  return f ?? null;
}

function errorDuplicado(f: NonNullable<Awaited<ReturnType<typeof buscarPorCodigoNorm>>>): ErrorAccion {
  const archivada = f.archivadaEn !== null;
  const mensaje = archivada
    ? 'Esa referencia existe pero está archivada. Pide a un administrador o a la supervisora general que la restaure.'
    : `Ya existe la referencia ${f.codigo} (${ETIQUETA_ESTADO[f.estado] ?? f.estado}). Ábrela en vez de crear otra.`;
  return new ErrorAccion('DUPLICADO', mensaje, {
    id: f.id,
    codigo: f.codigo,
    estado: f.estado,
    archivada,
  });
}

async function posiblesDuplicados(ctx: Contexto, norm: string, ahora: Date): Promise<PosibleDuplicado[]> {
  const sinCeros = norm.replace(/^0+/, '');
  const contiene = `%${escaparLike(norm)}%`;
  const filas = await ctx.db
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      estado: referencia.estado,
      archivadaEn: referencia.archivadaEn,
    })
    .from(referencia)
    .where(
      sql`${condicionVisible(ctx.actor, ahora)} and ${referencia.codigoNorm} <> ${norm} and (
        ${referencia.codigoNorm} like ${contiene} escape '\\'
        or (length(${referencia.codigoNorm}) >= 4 and starts_with(${norm}, ${referencia.codigoNorm}))
        or (${sinCeros} <> '' and ltrim(${referencia.codigoNorm}, '0') = ${sinCeros})
      )`,
    )
    .limit(5);
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    nombreProducto: f.nombreProducto,
    estado: f.estado,
    archivada: f.archivadaEn !== null,
  }));
}

export async function crearReferencia(ctx: Contexto, entrada: unknown): Promise<ResultadoCrearReferencia> {
  const e = parsear(entradaCrearReferencia, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  if (!puede(actor, 'crear_referencia')) {
    throw new ErrorAccion('SIN_PERMISO', 'No tienes permiso para crear referencias.');
  }

  const hoy = fechaBogota(ahora);
  const fechaSolicitud = e.fechaSolicitud ?? hoy;
  if (!esFechaValida(fechaSolicitud)) throw new ErrorAccion('VALIDACION', 'La fecha de solicitud no es válida.');
  if (compararFechas(fechaSolicitud, hoy) > 0) {
    throw new ErrorAccion('VALIDACION', 'La fecha de solicitud no puede ser futura.');
  }

  const codigoNorm = normalizarCodigo(e.codigo);
  if (codigoNorm === '') throw new ErrorAccion('VALIDACION', 'Escribe el código de la referencia.');

  const existente = await buscarPorCodigoNorm(ctx.db, codigoNorm);
  if (existente) throw errorDuplicado(existente);

  const similares = await posiblesDuplicados(ctx, codigoNorm, ahora);

  try {
    const id = await ctx.db.transaction(async (tx) => {
      // "Crear similar": se lee ANTES de insertar; si no la ve el actor, es 404.
      const origen = e.similarDe ? await cargarReferenciaVisible(tx, actor, e.similarDe, ahora) : null;

      const [creada] = await tx
        .insert(referencia)
        .values({
          codigo: e.codigo,
          codigoNorm,
          nombreProducto: e.nombreProducto,
          tipoProducto: e.tipoProducto,
          fechaSolicitud,
          creadaPor: actor.usuarioId,
          creadaEn: ahora,
          actualizadaEn: ahora,
        })
        .returning();
      if (!creada) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo crear la referencia.');

      // Hechos iniciales (version 1 de cada campo).
      let ficha = creada;
      const iniciales: Array<[string, unknown]> = [
        ['codigo', e.codigo],
        ['nombre_producto', e.nombreProducto],
        ['tipo_producto', e.tipoProducto],
        ['fecha_solicitud', fechaSolicitud],
      ];
      const areaOrigen = origen?.datos?.area_responsable?.v;
      const area = e.areaResponsable ?? (esArea(areaOrigen) ? areaOrigen : null) ?? (esArea(actor.area) ? actor.area : null);
      if (area) iniciales.push(['area_responsable', area]);
      for (const [campo, valor] of iniciales) {
        const r = await aplicarEscritura(tx, actor, ficha, {
          campo,
          valor,
          tipoEvento: 'fijar',
          versionEsperada: null,
          omitirIgualdad: true,
          ahora,
        });
        ficha = r.ficha;
      }

      if (origen) {
        const tipoNuevo = e.tipoProducto as TipoProducto;
        for (const clave of CAMPOS_SIMILAR) {
          const def = getCampo(clave);
          const v = origen.datos?.[clave]?.v;
          if (!def || estaVacio(v) || !esVisible(def, tipoNuevo)) continue;
          const r = await aplicarEscritura(tx, actor, ficha, {
            campo: clave,
            valor: v,
            tipoEvento: 'fijar',
            versionEsperada: null,
            ahora,
          });
          ficha = r.ficha;
        }
      }

      await auditar(tx, {
        usuarioId: actor.usuarioId,
        accion: 'crear_referencia',
        entidad: 'referencia',
        entidadId: ficha.id,
        detalle: { codigo: e.codigo, tipo: e.tipoProducto, area: e.areaResponsable ?? null, similarDe: e.similarDe ?? null },
        ip: ctx.ip,
        creadoEn: ahora,
      });
      return ficha.id;
    });
    return { id, codigo: e.codigo, posiblesDuplicados: similares };
  } catch (err) {
    // Dos creaciones simultaneas del mismo codigo: gana una, la otra recibe DUPLICADO (CA-02).
    if (esViolacionUnica(err, 'referencia_codigo_norm_unico')) {
      const ganadora = await buscarPorCodigoNorm(ctx.db, codigoNorm);
      if (ganadora) throw errorDuplicado(ganadora);
    }
    throw err;
  }
}

export interface RevisionCodigo {
  /** Ya existe una ficha con ese codigo (archivada o no): se enlaza en vez de crear otra. */
  existente: { id: string; codigo: string; nombreProducto: string; estado: string; archivada: boolean } | null;
  /** Codigos parecidos (mismo codigo sin ceros a la izquierda, o por prefijo / contiene). No bloquean. */
  parecidas: PosibleDuplicado[];
}

/**
 * Revision EN VIVO del codigo mientras se escribe en «Nueva referencia» (SPEC 6.3): avisa del duplicado exacto
 * y de los parecidos antes de crear. Solo informa; la creacion vuelve a comprobar todo en la transaccion.
 */
export async function revisarCodigo(ctx: Contexto, entrada: unknown): Promise<RevisionCodigo> {
  const { codigo } = parsear(z.object({ codigo: textoLimpio().pipe(z.string().trim().max(80)) }), entrada);
  const ahora = ahoraDe(ctx);
  if (!puede(ctx.actor, 'crear_referencia')) throw new ErrorAccion('SIN_PERMISO', 'No tienes permiso para crear referencias.');
  const norm = normalizarCodigo(codigo);
  if (norm === '') return { existente: null, parecidas: [] };
  const existente = await buscarPorCodigoNorm(ctx.db, norm);
  const parecidas = await posiblesDuplicados(ctx, norm, ahora);
  return {
    existente: existente
      ? {
          id: existente.id,
          codigo: existente.codigo,
          nombreProducto: existente.nombreProducto,
          estado: existente.estado,
          archivada: existente.archivadaEn !== null,
        }
      : null,
    parecidas,
  };
}
