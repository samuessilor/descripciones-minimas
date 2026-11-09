/**
 * Politicas de lectura de referencias (13.2): TODA consulta de fichas pasa por aqui y recibe el
 * `Actor`; las paginas no hacen consultas crudas. Aplican, en el servidor y en SQL (no con RLS,
 * D-18), las mismas reglas que `dominio/permisos.ts`:
 *   - roles internos ven todas las fichas;
 *   - la aduana solo ve fichas con asignacion vigente hacia su organizacion (8.3 regla 10);
 *   - ficha ajena o inexistente => NO_ENCONTRADO (404, no 403);
 *   - se enmascara a usuarios de otra agencia y se ocultan motivos a la aduana (A5, RV-28, PA-38).
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { asignacion, campoHistorial, referencia, usuario } from '@/db/esquema';
import type { Ejecutor, Tx } from '@/db/tipos';
import { type TipoProducto } from '@/dominio/campos';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { calcularCompletitud, type Completitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, etiquetaFicha, type ColorFicha, type EstadoFicha, type EtiquetaFicha } from '@/dominio/estado';
import { autorVisible, campoConHistorialVisible, motivoVisible, type OrigenAutor, type TipoOrganizacion } from '@/dominio/permisos';
import { ErrorAccion } from '../acciones/resultado';
import type { Actor } from './actor';
import { condicionHistorialVisible } from './historial-visible';
import { fueReabierta } from './reapertura';

export type FilaReferencia = typeof referencia.$inferSelect;

export const NOMBRE_OTRA_AGENCIA = 'Otra agencia';

// ---- Visibilidad ------------------------------------------------------------------------------

/** Condicion SQL de visibilidad sobre `referencia` (alias por defecto: la tabla misma). */
export function condicionVisible(actor: Actor, ahora: Date): SQL {
  if (actor.rol !== 'aduana') return sql`true`;
  return sql`(${referencia.archivadaEn} is null and exists (
    select 1 from ${asignacion} a
      join ${usuario} u on u.id = a.a_usuario_id
     where a.referencia_id = ${referencia.id}
       and u.organizacion_id = ${actor.organizacionId}
       and (a.estado in ('pendiente','en_curso')
            or (a.estado in ('hecha','reasignada') and a.acceso_hasta is not null and a.acceso_hasta > ${ahora.toISOString()}::timestamptz))
  ))`;
}

async function tieneAcceso(ej: Ejecutor, actor: Actor, fila: Pick<FilaReferencia, 'id' | 'archivadaEn'>, ahora: Date): Promise<boolean> {
  if (actor.rol !== 'aduana') return true;
  if (fila.archivadaEn) return false;
  const r = await ej
    .select({ n: sql<number>`1` })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .where(
      and(
        eq(asignacion.referenciaId, fila.id),
        eq(usuario.organizacionId, actor.organizacionId),
        sql`(${asignacion.estado} in ('pendiente','en_curso')
              or (${asignacion.estado} in ('hecha','reasignada') and ${asignacion.accesoHasta} is not null
                  and ${asignacion.accesoHasta} > ${ahora.toISOString()}::timestamptz))`,
      ),
    )
    .limit(1);
  return r.length > 0;
}

const NO_ENCONTRADO_INTERNO = 'No encontramos esa referencia. Revisa el enlace o búscala por código.';
const NO_ENCONTRADO_ADUANA = 'Esta referencia no está asignada a tu cuenta. Pide acceso a quien te la envió.';

export function errorNoEncontrado(actor: Actor): ErrorAccion {
  return new ErrorAccion('NO_ENCONTRADO', actor.rol === 'aduana' ? NO_ENCONTRADO_ADUANA : NO_ENCONTRADO_INTERNO);
}

/** Lee una ficha visible para el actor (sin bloquear). 404 si no existe o no la ve. */
export async function cargarReferenciaVisible(ej: Ejecutor, actor: Actor, id: string, ahora: Date): Promise<FilaReferencia> {
  const [fila] = await ej.select().from(referencia).where(eq(referencia.id, id)).limit(1);
  if (!fila || !(await tieneAcceso(ej, actor, fila, ahora))) throw errorNoEncontrado(actor);
  return fila;
}

/**
 * Columnas que necesitan los sondeos (estado de la ficha, latido de edicion): NUNCA `datos` ni `texto_busqueda`, que son
 * el grueso de la fila (varios KB) y se pagan como red de Neon en cada consulta.
 */
const COLUMNAS_LIGERAS = {
  id: referencia.id,
  version: referencia.version,
  estado: referencia.estado,
  actualizadaEn: referencia.actualizadaEn,
  archivadaEn: referencia.archivadaEn,
  creadaPor: referencia.creadaPor,
};

export type FilaReferenciaLigera = Pick<FilaReferencia, keyof typeof COLUMNAS_LIGERAS>;

/** Igual que `cargarReferenciaVisible`, pero solo con las columnas ligeras: para lo que se consulta una y otra vez. */
export async function cargarReferenciaLigera(ej: Ejecutor, actor: Actor, id: string, ahora: Date): Promise<FilaReferenciaLigera> {
  const [fila] = await ej.select(COLUMNAS_LIGERAS).from(referencia).where(eq(referencia.id, id)).limit(1);
  if (!fila || !(await tieneAcceso(ej, actor, fila, ahora))) throw errorNoEncontrado(actor);
  return fila;
}

/** Igual, pero con `SELECT ... FOR UPDATE`: serializa las escrituras de la ficha (12.4 `guardarCampo`). */
export async function cargarReferenciaBloqueada(tx: Tx, actor: Actor, id: string, ahora: Date): Promise<FilaReferencia> {
  const [fila] = await tx.select().from(referencia).where(eq(referencia.id, id)).for('update').limit(1);
  if (!fila || !(await tieneAcceso(tx, actor, fila, ahora))) throw errorNoEncontrado(actor);
  return fila;
}

// ---- Resolucion de autores ----------------------------------------------------------------------

interface InfoAutor extends OrigenAutor {
  id: string;
  nombre: string;
}

async function cargarAutores(ej: Ejecutor, ids: string[]): Promise<Map<string, InfoAutor>> {
  const unicos = [...new Set(ids)];
  const mapa = new Map<string, InfoAutor>();
  if (unicos.length === 0) return mapa;
  const filas = await ej
    .select({
      id: usuario.id,
      nombre: usuario.nombre,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
    })
    .from(usuario)
    .where(inArray(usuario.id, unicos));
  for (const f of filas) {
    mapa.set(f.id, { ...f, organizacionTipo: f.organizacionTipo as TipoOrganizacion });
  }
  return mapa;
}

export function nombreDeAutor(actor: Actor, autor: InfoAutor | undefined): string {
  if (!autor) return 'Alguien';
  return autorVisible(actor, autor) === 'otra_agencia' ? NOMBRE_OTRA_AGENCIA : nombreSinMarca(autor.nombre);
}

/** Autor de un valor vigente, con el enmascaramiento que corresponde al actor. */
export async function describirAutor(ej: Ejecutor, actor: Actor, autorId: string): Promise<string> {
  const mapa = await cargarAutores(ej, [autorId]);
  return nombreDeAutor(actor, mapa.get(autorId));
}

// ---- Vistas -----------------------------------------------------------------------------------------

export interface CampoVista {
  clave: string;
  valor: unknown;
  version: number;
  autor: string;
  /** El valor vigente lo puso el propio actor (no pide motivo para cambiarlo). */
  propio: boolean;
  instante: string;
}

export interface FichaVista {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  archivada: boolean;
  version: number;
  fechaSolicitud: string;
  diasEnGestion: number;
  partida: string | null;
  creadaPor: string;
  creadaEn: string;
  actualizadaEn: string;
  campos: Record<string, CampoVista>;
  completitud: Completitud;
  etiqueta: EtiquetaFicha;
  color: ColorFicha;
}

export function valoresVigentes(fila: FilaReferencia): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const [clave, e] of Object.entries(fila.datos ?? {})) v[clave] = e.v;
  return v;
}

/** La ficha tal como la ve el actor: campos con autor y fecha, y semaforo calculado. */
export async function vistaFicha(ej: Ejecutor, actor: Actor, id: string, ahora: Date): Promise<FichaVista> {
  const fila = await cargarReferenciaVisible(ej, actor, id, ahora);
  const datos = fila.datos ?? {};
  const autores = await cargarAutores(ej, [fila.creadaPor, ...Object.values(datos).map((e) => e.a)]);

  const campos: Record<string, CampoVista> = {};
  for (const [clave, e] of Object.entries(datos)) {
    campos[clave] = {
      clave,
      valor: e.v,
      version: e.n,
      autor: nombreDeAutor(actor, autores.get(e.a)),
      propio: e.a === actor.usuarioId,
      instante: e.t,
    };
  }

  const valores = valoresVigentes(fila);
  const tipo = fila.tipoProducto as TipoProducto;
  const completitud = calcularCompletitud({ tipo, valores });
  const estado = fila.estado as EstadoFicha;
  const archivada = fila.archivadaEn !== null;

  return {
    id: fila.id,
    codigo: fila.codigo,
    nombreProducto: fila.nombreProducto,
    tipoProducto: tipo,
    estado,
    archivada,
    version: fila.version,
    fechaSolicitud: fila.fechaSolicitud,
    diasEnGestion: diasEnGestion({
      fechaSolicitud: fila.fechaSolicitud,
      clasificadaEn: fila.clasificadaEn,
      ahora,
      diasPausa: fila.diasPausa,
    }),
    partida: fila.partida,
    creadaPor: nombreDeAutor(actor, autores.get(fila.creadaPor)),
    creadaEn: fila.creadaEn.toISOString(),
    actualizadaEn: fila.actualizadaEn.toISOString(),
    campos,
    completitud,
    etiqueta: etiquetaFicha({
      estado,
      archivada,
      reabierta: estado === 'EN_GESTION' ? await fueReabierta(ej, fila.id) : false,
      finalizada: completitud.finalizada,
      tresSeccionesVerdes: completitud.tresSeccionesVerdes,
      esperaRespuesta: completitud.aduana.faltantes.includes('respuesta_area'),
    }),
    color: colorFicha(estado),
  };
}

export interface EntradaHistorialVista {
  id: number;
  version: number;
  tipoEvento: string;
  valor: unknown;
  /** `null` si el actor no puede ver el motivo (PA-38) o no hubo. */
  motivo: string | null;
  hayMotivoOculto: boolean;
  autor: string;
  autorEsPropio: boolean;
  creadoEn: string;
  restauraId: number | null;
}

/** Historial inmutable de un campo, del mas nuevo al mas viejo, filtrado para el actor. */
export async function historialDeCampo(
  ej: Ejecutor,
  actor: Actor,
  referenciaId: string,
  campo: string,
  ahora: Date,
): Promise<EntradaHistorialVista[]> {
  await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  // Una agencia solo ve el historial de su zona de aduana (y lo de su organizacion): del resto responde como si no existiera.
  if (!campoConHistorialVisible(actor, campo)) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos el historial de ese campo.');
  const filas = await ej
    .select()
    .from(campoHistorial)
    .where(and(eq(campoHistorial.referenciaId, referenciaId), eq(campoHistorial.campo, campo), condicionHistorialVisible(actor)))
    .orderBy(desc(campoHistorial.versionCampo));
  const autores = await cargarAutores(ej, filas.map((f) => f.autorId));
  return filas.map((f) => {
    const autor = autores.get(f.autorId);
    const origen: OrigenAutor = autor ?? { organizacionId: f.organizacionId, organizacionTipo: 'interna' };
    const veMotivo = motivoVisible(actor, { organizacionId: f.organizacionId, organizacionTipo: origen.organizacionTipo });
    return {
      id: f.id,
      version: f.versionCampo,
      tipoEvento: f.tipoEvento,
      valor: f.valor,
      motivo: veMotivo ? f.motivo : null,
      hayMotivoOculto: !veMotivo && !!f.motivo,
      autor: nombreDeAutor(actor, autor),
      autorEsPropio: f.autorId === actor.usuarioId,
      creadoEn: f.creadoEn.toISOString(),
      restauraId: f.restauraId,
    };
  });
}

export interface FilaListado {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  partida: string | null;
  archivada: boolean;
  diasEnGestion: number;
  color: ColorFicha;
  actualizadaEn: string;
}

/** Listado minimo (H1). Filtros, busqueda y paginacion por cursor llegan en H2. */
export async function listarReferencias(
  ej: Ejecutor,
  actor: Actor,
  opciones: { limite?: number; ahora: Date },
): Promise<FilaListado[]> {
  const filas = await ej
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estado: referencia.estado,
      partida: referencia.partida,
      archivadaEn: referencia.archivadaEn,
      fechaSolicitud: referencia.fechaSolicitud,
      clasificadaEn: referencia.clasificadaEn,
      diasPausa: referencia.diasPausa,
      actualizadaEn: referencia.actualizadaEn,
    })
    .from(referencia)
    .where(and(condicionVisible(actor, opciones.ahora), isNull(referencia.archivadaEn)))
    .orderBy(desc(referencia.creadaEn), desc(referencia.id))
    .limit(Math.min(opciones.limite ?? 25, 100));
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    nombreProducto: f.nombreProducto,
    tipoProducto: f.tipoProducto as TipoProducto,
    estado: f.estado as EstadoFicha,
    partida: f.partida,
    archivada: f.archivadaEn !== null,
    diasEnGestion: diasEnGestion({
      fechaSolicitud: f.fechaSolicitud,
      clasificadaEn: f.clasificadaEn,
      ahora: opciones.ahora,
      diasPausa: f.diasPausa,
    }),
    color: colorFicha(f.estado as EstadoFicha),
    actualizadaEn: f.actualizadaEn.toISOString(),
  }));
}
