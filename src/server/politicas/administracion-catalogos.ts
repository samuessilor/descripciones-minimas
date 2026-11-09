/**
 * Catalogos, restricciones y partidas: lecturas de administracion (solo `admin`).
 * Cada fila trae cuanto se usa, para decidir con datos antes de desactivar.
 */
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { catalogoItem, partidaArancelaria, referencia, restriccionPlantilla } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { listarPaises, nombrePais, PAIS_NO_SE_CONOCE } from '@/dominio/paises';
import { normalizarTexto } from '@/dominio/normalizacion';
import { escaparLike, exigirAdmin } from './administracion';
import type { Actor } from './actor';

/** Clave de la ficha donde se guarda cada lista (para contar usos). */
const CLAVE_FICHA: Record<'unidad_medida' | 'aspecto_fisico' | 'sugerencia_empaque', string> = {
  unidad_medida: 'unidad_medida',
  aspecto_fisico: 'aspecto_fisico',
  sugerencia_empaque: 'tipo_empaque',
};

export interface ItemCatalogoAdmin {
  id: string;
  valor: string;
  orden: number;
  activo: boolean;
  usos: number;
}

export async function listarItemsCatalogo(
  ej: Ejecutor,
  actor: Actor,
  catalogo: 'unidad_medida' | 'aspecto_fisico' | 'sugerencia_empaque',
): Promise<ItemCatalogoAdmin[]> {
  exigirAdmin(actor);
  const clave = CLAVE_FICHA[catalogo];
  const items = await ej
    .select()
    .from(catalogoItem)
    .where(eq(catalogoItem.catalogo, catalogo))
    .orderBy(asc(catalogoItem.orden), asc(catalogoItem.valor));
  // `clave` sale de una lista fija en este archivo, no de la entrada: es seguro incrustarla.
  const usos = await ej.execute<{ valor: string | null; n: number }>(
    sql`select ${referencia.datos} -> ${sql.raw(`'${clave}'`)} ->> 'v' as valor, count(*)::int as n from ${referencia} group by 1`,
  );
  const filas = (Array.isArray(usos) ? usos : ((usos as unknown as { rows?: Array<{ valor: string | null; n: number }> }).rows ?? [])) as Array<{ valor: string | null; n: number }>;
  const conteo = new Map(filas.filter((f) => f.valor !== null).map((f) => [f.valor as string, Number(f.n)]));
  return items.map((i) => ({ id: i.id, valor: i.valor, orden: i.orden, activo: i.activo, usos: conteo.get(i.valor) ?? 0 }));
}

export interface PaisAdmin {
  codigo: string;
  nombre: string;
  usos: number;
}

/**
 * Paises: lista ISO completa de solo lectura. Los «principales» son los mas usados en la base (6.3); mientras
 * no haya datos suficientes, empiezan Francia y China (NI!J). Nunca se inventa una lista.
 */
export async function listarPaisesAdmin(ej: Ejecutor, actor: Actor): Promise<{ principales: PaisAdmin[]; todos: PaisAdmin[] }> {
  exigirAdmin(actor);
  const r = await ej.execute<{ codigo: string | null; n: number }>(
    sql`select ${referencia.datos} -> 'pais_origen' ->> 'v' as codigo, count(*)::int as n from ${referencia} group by 1`,
  );
  const filas = (Array.isArray(r) ? r : ((r as unknown as { rows?: Array<{ codigo: string | null; n: number }> }).rows ?? [])) as Array<{ codigo: string | null; n: number }>;
  const conteo = new Map(filas.filter((f) => f.codigo && f.codigo !== PAIS_NO_SE_CONOCE).map((f) => [f.codigo as string, Number(f.n)]));
  const todos: PaisAdmin[] = listarPaises().map((p) => ({ ...p, usos: conteo.get(p.codigo) ?? 0 }));
  const masUsados = [...todos].filter((p) => p.usos > 0).sort((a, b) => b.usos - a.usos || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 8);
  const principales = masUsados.length >= 2 ? masUsados : ['FR', 'CN'].map((c) => todos.find((p) => p.codigo === c)).filter((p): p is PaisAdmin => !!p);
  return { principales, todos };
}

export function nombrePaisAdmin(codigo: string): string {
  return nombrePais(codigo);
}

export interface RestriccionAdmin {
  id: string;
  codigo: string;
  texto: string;
  activa: boolean;
  partidas: number;
}

export async function listarRestricciones(ej: Ejecutor, actor: Actor): Promise<RestriccionAdmin[]> {
  exigirAdmin(actor);
  return ej
    .select({
      id: restriccionPlantilla.id,
      codigo: restriccionPlantilla.codigo,
      texto: restriccionPlantilla.texto,
      activa: restriccionPlantilla.activa,
      partidas: sql<number>`(select count(*)::int from ${partidaArancelaria} p where p.restriccion_id = "restriccion_plantilla"."id")`,
    })
    .from(restriccionPlantilla)
    .orderBy(desc(restriccionPlantilla.activa), asc(restriccionPlantilla.codigo));
}

export interface PartidaAdmin {
  codigo: string;
  descripcion: string | null;
  activa: boolean;
  origen: string;
  restriccionId: string | null;
  restriccionCodigo: string | null;
  fichas: number;
}

export async function listarPartidas(ej: Ejecutor, actor: Actor, filtros: { q?: string | undefined } = {}): Promise<PartidaAdmin[]> {
  exigirAdmin(actor);
  const condiciones: SQL[] = [];
  const q = normalizarTexto(filtros.q ?? '');
  if (q) {
    const patron = `%${escaparLike(q)}%`;
    condiciones.push(
      sql`(${partidaArancelaria.codigo} like ${`%${escaparLike((filtros.q ?? '').trim())}%`} escape '\\' or translate(lower(coalesce(${partidaArancelaria.descripcion}, '')), 'áéíóúüñ', 'aeiouun') like ${patron} escape '\\')`,
    );
  }
  const rows = await ej
    .select({
      codigo: partidaArancelaria.codigo,
      descripcion: partidaArancelaria.descripcion,
      activa: partidaArancelaria.activa,
      origen: partidaArancelaria.origen,
      restriccionId: partidaArancelaria.restriccionId,
      restriccionCodigo: restriccionPlantilla.codigo,
      fichas: sql<number>`(select count(*)::int from ${referencia} r where r.partida = ${partidaArancelaria.codigo})`,
    })
    .from(partidaArancelaria)
    .leftJoin(restriccionPlantilla, eq(restriccionPlantilla.id, partidaArancelaria.restriccionId))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(partidaArancelaria.activa), asc(partidaArancelaria.codigo))
    .limit(500);
  return rows;
}

export interface OpcionesPartida {
  restricciones: Array<{ id: string; codigo: string }>;
}

export async function opcionesParaPartida(ej: Ejecutor, actor: Actor): Promise<OpcionesPartida> {
  exigirAdmin(actor);
  const restricciones = await ej
    .select({ id: restriccionPlantilla.id, codigo: restriccionPlantilla.codigo })
    .from(restriccionPlantilla)
    .where(eq(restriccionPlantilla.activa, true))
    .orderBy(asc(restriccionPlantilla.codigo));
  return { restricciones };
}
