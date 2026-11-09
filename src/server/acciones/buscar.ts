/**
 * `buscar` (SPEC 10.3, 12.4, D-18): sugerencias del buscador con lupa. Tokens normalizados (sin tildes ni
 * mayusculas) combinados con AND sobre `texto_busqueda`, con `LIKE ... ESCAPE '\'` y el texto escapado
 * (`%`, `_` y `\` son literales). Solo lo visible para el actor (la agencia nunca ve fichas ajenas) y nunca
 * las archivadas. Maximo 8 resultados, ordenados: codigo exacto > prefijo de codigo > nombre exacto >
 * contiene en codigo o nombre > el resto.
 */
import { and, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { referencia } from '@/db/esquema';
import type { TipoProducto } from '@/dominio/campos';
import { colorFicha, type ColorFicha, type EstadoFicha } from '@/dominio/estado';
import { escaparLike, normalizarCodigo, normalizarTexto, tokenizarBusqueda } from '@/dominio/normalizacion';
import { limitarTasa, REGLAS_TASA } from '../limite-tasa';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { condicionVisible } from '../politicas/referencias';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const MAX_SUGERENCIAS = 8;
const MIN_CARACTERES = 2;
const CANDIDATAS = 60;

export interface ResultadoBusqueda {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  color: ColorFicha;
  /** Donde coincide mejor lo escrito. */
  coincideEn: 'codigo' | 'nombre' | 'otro';
  /** El codigo normalizado o el nombre normalizado es EXACTAMENTE lo escrito. */
  exacta: boolean;
}

export interface RespuestaBusqueda {
  q: string;
  resultados: ResultadoBusqueda[];
  /** Cuantas fichas visibles coinciden en total (para «Ver los 14 resultados»). */
  total: number;
  /** Si hay UNA sola coincidencia exacta (codigo o nombre), su id: Enter navega directo a la ficha. */
  exactaId: string | null;
  /** Cuantas fichas tienen exactamente ese nombre (si son varias, Enter abre el listado filtrado). */
  exactasPorNombre: number;
}

const entrada = z.object({ q: textoLimpio().pipe(z.string().max(120)) });

/** Condicion AND de tokens sobre `texto_busqueda` (compartida con el listado). */
export function condicionTexto(q: string): SQL | null {
  const tokens = tokenizarBusqueda(q);
  if (tokens.length === 0) return null;
  const partes = tokens.map((t) => {
    const enTexto = sql`${referencia.textoBusqueda} like ${`%${escaparLike(t)}%`} escape '\\'`;
    // Partida escrita sin puntos o con guiones («8421399000», «8421-39-90-00»): se compara contra sus digitos.
    const digitos = t.replace(/[.-]/g, '');
    if (!/^[\d.-]+$/.test(t) || digitos.length < 4) return enTexto;
    return or(enTexto, sql`replace(${referencia.partida}, '.', '') like ${`%${digitos}%`}`) as SQL;
  });
  return and(...partes) ?? null;
}

/** Filtro por partida (L3): la partida guardada, sin puntos, empieza por esos digitos (ver `prefijoPartida`). */
export function condicionPartida(digitos: string): SQL | null {
  if (!/^\d{1,10}$/.test(digitos)) return null;
  return sql`replace(coalesce(${referencia.partida}, ''), '.', '') like ${`${digitos}%`}`;
}

export async function buscar(ctx: Contexto, entradaCruda: unknown): Promise<RespuestaBusqueda> {
  const { q } = parsear(entrada, entradaCruda);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const vacia: RespuestaBusqueda = { q, resultados: [], total: 0, exactaId: null, exactasPorNombre: 0 };

  const qn = normalizarTexto(q);
  if ([...qn].length < MIN_CARACTERES) return vacia;

  const tasa = await limitarTasa(ctx.db, `buscar:${actor.usuarioId}`, REGLAS_TASA.buscar, ahora);
  if (!tasa.permitido) {
    throw new ErrorAccion('LIMITE_TASA', 'Vas muy rápido. Espera unos segundos y vuelve a buscar.', { reintentarEnMs: tasa.reintentarEnMs });
  }

  const texto = condicionTexto(q);
  if (!texto) return vacia;
  const qCodigo = normalizarCodigo(q);
  const donde = and(condicionVisible(actor, ahora), sql`${referencia.archivadaEn} is null`, texto) as SQL;

  const prefijoCodigo = `${escaparLike(qCodigo)}%`;
  const contieneCodigo = `%${escaparLike(qCodigo)}%`;
  const orden = sql`case
    when ${referencia.codigoNorm} = ${qCodigo} then 0
    when ${referencia.codigoNorm} like ${prefijoCodigo} escape '\\' then 1
    when lower(${referencia.nombreProducto}) = ${qn} then 2
    when ${referencia.codigoNorm} like ${contieneCodigo} escape '\\' then 3
    when position(${qn} in lower(${referencia.nombreProducto})) > 0 then 3
    else 4 end`;

  const [filas, [conteo]] = await Promise.all([
    ctx.db
      .select({
        id: referencia.id,
        codigo: referencia.codigo,
        codigoNorm: referencia.codigoNorm,
        nombreProducto: referencia.nombreProducto,
        tipoProducto: referencia.tipoProducto,
        estado: referencia.estado,
      })
      .from(referencia)
      .where(donde)
      .orderBy(orden, sql`${referencia.actualizadaEn} desc`, referencia.id)
      .limit(CANDIDATAS),
    ctx.db.select({ n: sql<number>`count(*)::int` }).from(referencia).where(donde),
  ]);

  // Nombre normalizado (sin tildes) en memoria: la base solo guarda el nombre tal cual se escribio.
  const clasificadas = filas.map((f) => {
    const nombreN = normalizarTexto(f.nombreProducto);
    const exactaCodigo = qCodigo !== '' && f.codigoNorm === qCodigo;
    const exactaNombre = nombreN === qn;
    const enCodigo = qCodigo !== '' && f.codigoNorm.includes(qCodigo);
    const enNombre = nombreN.includes(qn);
    const rango = exactaCodigo ? 0 : f.codigoNorm.startsWith(qCodigo) && qCodigo !== '' ? 1 : exactaNombre ? 2 : enCodigo || enNombre ? 3 : 4;
    return { f, rango, exactaCodigo, exactaNombre, enCodigo, enNombre };
  });
  clasificadas.sort((a, b) => a.rango - b.rango); // estable: conserva el orden por actualizacion dentro de cada rango

  const exactas = clasificadas.filter((c) => c.exactaCodigo || c.exactaNombre);
  const exactasPorNombre = clasificadas.filter((c) => c.exactaNombre).length;

  const resultados: ResultadoBusqueda[] = clasificadas.slice(0, MAX_SUGERENCIAS).map((c) => ({
    id: c.f.id,
    codigo: c.f.codigo,
    nombreProducto: c.f.nombreProducto,
    tipoProducto: c.f.tipoProducto as TipoProducto,
    estado: c.f.estado as EstadoFicha,
    color: colorFicha(c.f.estado as EstadoFicha),
    coincideEn: c.enCodigo || c.exactaCodigo ? 'codigo' : c.enNombre ? 'nombre' : 'otro',
    exacta: c.exactaCodigo || c.exactaNombre,
  }));

  return {
    q,
    resultados,
    total: conteo?.n ?? resultados.length,
    exactaId: exactas.length === 1 ? (exactas[0]?.f.id ?? null) : null,
    exactasPorNombre,
  };
}
