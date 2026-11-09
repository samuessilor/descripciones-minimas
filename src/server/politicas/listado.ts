/**
 * Listado de referencias (SPEC 10.3, 13.2): TODA fila pasa por la visibilidad del actor (la agencia solo ve lo
 * que tiene asignado). Filtros por estado, tipo, «mis pendientes», agencia, «sin responsable», texto y prefijo de
 * partida (L3, ignora los puntos); orden;
 * paginacion de 25 en 25; contadores amarillas/verdes que respetan los demas filtros.
 *
 * El listado NO trae `datos` completo al navegador: se leen solo las 25 filas de la pagina para calcular que
 * seccion falta (funcion pura `calcularCompletitud`) y se descartan.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { ETIQUETA_SECCION, SECCIONES, TIPOS_PRODUCTO, type Seccion, type TipoProducto } from '@/dominio/campos';
import { prefijoPartida } from '@/dominio/busqueda';
import { calcularCompletitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, type ColorFicha, type EstadoFicha } from '@/dominio/estado';
import type { TipoOrganizacion } from '@/dominio/permisos';
import { condicionPartida, condicionTexto } from '../acciones/buscar';
import type { Actor } from './actor';
import { condicionVisible, nombreDeAutor } from './referencias';
import { areaQueResponde, areasConCuenta, condicionSinResponsable } from './responsable-area';

export const POR_PAGINA = 25;

export const ESTADOS_FILTRO = ['todas', 'amarillas', 'verdes', 'archivadas'] as const;
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

export const ORDENES = ['recientes', 'codigo', 'dias', 'creacion'] as const;
export type OrdenListado = (typeof ORDENES)[number];

export const ETIQUETA_ORDEN: Record<OrdenListado, string> = {
  recientes: 'Última actualización',
  codigo: 'Código (A–Z)',
  dias: 'Más días en gestión',
  creacion: 'Creadas hace poco',
};

export interface FiltrosListado {
  estado: EstadoFiltro;
  tipo: TipoProducto | null;
  /** Solo lo que tengo pendiente (asignacion activa hacia mi). */
  mias: boolean;
  /** Organizacion de agencia que tiene la ficha en su mano. Solo para roles internos. */
  agencia: string | null;
  sinResponsable: boolean;
  q: string;
  /** Prefijo de partida arancelaria tal como se escribio (`8421.39`); el filtro compara solo los digitos. */
  partida: string;
  orden: OrdenListado;
  pagina: number;
}

export const FILTROS_VACIOS: FiltrosListado = {
  estado: 'todas',
  tipo: null,
  mias: false,
  agencia: null,
  sinResponsable: false,
  q: '',
  partida: '',
  orden: 'recientes',
  pagina: 1,
};

type Param = string | string[] | undefined;
const uno = (p: Param): string => (Array.isArray(p) ? (p[0] ?? '') : (p ?? ''));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lee los filtros de la URL con valores seguros: lo que no se entiende se ignora, nunca se confia. */
export function filtrosDesdeParametros(p: Record<string, Param>): FiltrosListado {
  const estado = uno(p.estado);
  const tipo = uno(p.tipo);
  const orden = uno(p.orden);
  const agencia = uno(p.agencia);
  const pagina = Number.parseInt(uno(p.pagina), 10);
  return {
    estado: (ESTADOS_FILTRO as readonly string[]).includes(estado) ? (estado as EstadoFiltro) : 'todas',
    tipo: (TIPOS_PRODUCTO as readonly string[]).includes(tipo) ? (tipo as TipoProducto) : null,
    mias: uno(p.mias) === '1',
    agencia: UUID.test(agencia) ? agencia : null,
    sinResponsable: uno(p.sinResponsable) === '1',
    q: uno(p.q).slice(0, 120),
    partida: prefijoPartida(uno(p.partida)) ? uno(p.partida).trim().slice(0, 13) : '',
    orden: (ORDENES as readonly string[]).includes(orden) ? (orden as OrdenListado) : 'recientes',
    pagina: Number.isFinite(pagina) && pagina >= 1 ? Math.min(pagina, 10_000) : 1,
  };
}

/** Parametros de URL para estos filtros (omite los valores por defecto). */
export function parametrosDeFiltros(f: Partial<FiltrosListado>): URLSearchParams {
  const u = new URLSearchParams();
  if (f.estado && f.estado !== 'todas') u.set('estado', f.estado);
  if (f.tipo) u.set('tipo', f.tipo);
  if (f.mias) u.set('mias', '1');
  if (f.agencia) u.set('agencia', f.agencia);
  if (f.sinResponsable) u.set('sinResponsable', '1');
  if (f.q) u.set('q', f.q);
  if (f.partida) u.set('partida', f.partida);
  if (f.orden && f.orden !== 'recientes') u.set('orden', f.orden);
  if (f.pagina && f.pagina > 1) u.set('pagina', String(f.pagina));
  return u;
}

export interface FilaListadoVista {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  color: ColorFicha;
  archivada: boolean;
  /** Partida arancelaria FINAL: solo se entrega si la ficha esta clasificada (L1); en pendientes es `null`. */
  partida: string | null;
  diasEnGestion: number;
  actualizadaEn: string;
  /** Primera seccion en amarillo (lo que falta del area); `null` si el area ya termino o la ficha esta clasificada. */
  pendiente: { seccion: Seccion; etiqueta: string; faltan: number; texto: string } | null;
  /** La aduana pidio informacion y el area no ha respondido (A2): lo que falta es del area, no de la aduana. */
  esperaRespuesta: boolean;
  /** Campos que faltan en total y de cuantos (area). */
  faltan: number;
  total: number;
  /** Quien la tiene en la mano (asignaciones activas). */
  responsables: string[];
  /** Area responsable con cuentas activas (C1): sin personas en la mano, la referencia es de esa area. */
  area: string | null;
  sinResponsable: boolean;
}

export interface ResultadoListado {
  filas: FilaListadoVista[];
  total: number;
  pagina: number;
  paginas: number;
  desde: number;
  hasta: number;
  contadores: { amarillas: number; verdes: number };
  /** Agencias entre las que se puede filtrar (solo roles internos). */
  agencias: Array<{ id: string; nombre: string }>;
}

const ACTIVAS = sql`('pendiente','en_curso')`;

function existeAsignacionActiva(extra: SQL | null = null): SQL {
  return sql`exists (select 1 from ${asignacion} a ${extra ? sql`join ${usuario} u on u.id = a.a_usuario_id` : sql``}
      where a.referencia_id = ${referencia.id} and a.estado in ${ACTIVAS} ${extra ? sql`and ${extra}` : sql``})`;
}

/** Condiciones comunes (todas menos el estado), ya con la visibilidad del actor. */
function condicionesBase(actor: Actor, f: FiltrosListado, ahora: Date): SQL[] {
  const c: SQL[] = [condicionVisible(actor, ahora)];
  if (f.tipo) c.push(sql`${referencia.tipoProducto} = ${f.tipo}`);
  if (f.mias) c.push(existeAsignacionActiva(sql`a.a_usuario_id = ${actor.usuarioId}`));
  if (f.agencia && actor.organizacionTipo === 'interna') {
    c.push(existeAsignacionActiva(sql`u.organizacion_id = ${f.agencia}`));
  }
  // Misma regla que el KPI del Resumen y el contador de Inicio (C1: el area responsable con cuenta cuenta como dueno).
  if (f.sinResponsable) c.push(condicionSinResponsable());
  const texto = condicionTexto(f.q);
  if (texto) c.push(texto);
  const partida = condicionPartida(prefijoPartida(f.partida));
  if (partida) c.push(partida);
  return c;
}

function ordenSql(orden: OrdenListado): SQL[] {
  switch (orden) {
    case 'codigo':
      return [sql`${referencia.codigoNorm} asc`, sql`${referencia.id} asc`];
    case 'dias':
      return [
        sql`((coalesce(${referencia.clasificadaEn}, now()) at time zone 'America/Bogota')::date - ${referencia.fechaSolicitud} - ${referencia.diasPausa}) desc`,
        sql`${referencia.id} desc`,
      ];
    case 'creacion':
      return [sql`${referencia.creadaEn} desc`, sql`${referencia.id} desc`];
    case 'recientes':
      return [sql`${referencia.actualizadaEn} desc`, sql`${referencia.id} desc`];
  }
}

export async function listarPagina(ej: Ejecutor, actor: Actor, f: FiltrosListado, ahora: Date): Promise<ResultadoListado> {
  const base = condicionesBase(actor, f, ahora);

  // Archivadas: solo roles internos (la aduana nunca las ve, 8.3 regla 10).
  const archivadas = f.estado === 'archivadas' && actor.rol !== 'aduana';
  const condEstado: SQL[] = [archivadas ? sql`${referencia.archivadaEn} is not null` : sql`${referencia.archivadaEn} is null`];
  if (!archivadas && f.estado === 'amarillas') condEstado.push(sql`${referencia.estado} <> 'CLASIFICADA'`);
  if (!archivadas && f.estado === 'verdes') condEstado.push(sql`${referencia.estado} = 'CLASIFICADA'`);

  const donde = and(...base, ...condEstado) as SQL;
  const dondeContadores = and(...base, sql`${referencia.archivadaEn} is null`) as SQL;

  const [[total], [cont]] = await Promise.all([
    ej.select({ n: sql<number>`count(*)::int` }).from(referencia).where(donde),
    ej
      .select({
        amarillas: sql<number>`(count(*) filter (where ${referencia.estado} <> 'CLASIFICADA'))::int`,
        verdes: sql<number>`(count(*) filter (where ${referencia.estado} = 'CLASIFICADA'))::int`,
      })
      .from(referencia)
      .where(dondeContadores),
  ]);

  const n = total?.n ?? 0;
  const paginas = Math.max(1, Math.ceil(n / POR_PAGINA));
  const pagina = Math.min(f.pagina, paginas);

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
      datos: referencia.datos,
    })
    .from(referencia)
    .where(donde)
    .orderBy(...ordenSql(f.orden))
    .limit(POR_PAGINA)
    .offset((pagina - 1) * POR_PAGINA);

  const ids = filas.map((r) => r.id);
  const asignaciones = ids.length
    ? await ej
        .select({
          referenciaId: asignacion.referenciaId,
          nombre: usuario.nombre,
          organizacionId: usuario.organizacionId,
          organizacionTipo: usuario.organizacionTipo,
        })
        .from(asignacion)
        .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
        .where(and(inArray(asignacion.referenciaId, ids), sql`${asignacion.estado} in ${ACTIVAS}`))
        .orderBy(asignacion.creadaEn)
    : [];

  const areas = filas.length ? await areasConCuenta(ej) : new Set<string>();
  const respPor = new Map<string, string[]>();
  for (const a of asignaciones) {
    const nombre = nombreDeAutor(actor, {
      id: '',
      nombre: a.nombre,
      organizacionId: a.organizacionId,
      organizacionTipo: a.organizacionTipo as TipoOrganizacion,
    });
    respPor.set(a.referenciaId, [...new Set([...(respPor.get(a.referenciaId) ?? []), nombre])]);
  }

  const vista: FilaListadoVista[] = filas.map((r) => {
    const tipo = r.tipoProducto as TipoProducto;
    const estado = r.estado as EstadoFicha;
    const valores: Record<string, unknown> = {};
    for (const [clave, e] of Object.entries(r.datos ?? {})) valores[clave] = e.v;
    const comp = calcularCompletitud({ tipo, valores });
    const primera = SECCIONES.find((s) => comp.secciones[s].estado === 'amarillo');
    const responsables = estado === 'CLASIFICADA' ? [] : (respPor.get(r.id) ?? []);
    const area = estado === 'CLASIFICADA' ? null : areaQueResponde(r.datos, areas);
    return {
      id: r.id,
      codigo: r.codigo,
      nombreProducto: r.nombreProducto,
      tipoProducto: tipo,
      estado,
      color: colorFicha(estado),
      archivada: r.archivadaEn !== null,
      partida: estado === 'CLASIFICADA' ? r.partida : null,
      diasEnGestion: diasEnGestion({ fechaSolicitud: r.fechaSolicitud, clasificadaEn: r.clasificadaEn, ahora, diasPausa: r.diasPausa }),
      actualizadaEn: r.actualizadaEn.toISOString(),
      pendiente:
        estado === 'CLASIFICADA' || !primera
          ? null
          : {
              seccion: primera,
              etiqueta: ETIQUETA_SECCION[primera],
              faltan: comp.secciones[primera].faltan,
              texto: comp.secciones[primera].texto,
            },
      esperaRespuesta: estado !== 'CLASIFICADA' && comp.aduana.faltantes.includes('respuesta_area'),
      faltan: comp.area.faltan,
      total: comp.area.total,
      responsables,
      area,
      sinResponsable: estado === 'EN_GESTION' && responsables.length === 0 && !area,
    };
  });

  // Agencias para el filtro (solo internos).
  const agencias =
    actor.organizacionTipo === 'interna'
      ? await ej
          .select({ id: organizacion.id, nombre: organizacion.nombre })
          .from(organizacion)
          .where(and(eq(organizacion.tipo, 'agencia'), eq(organizacion.activa, true)))
          .orderBy(organizacion.nombre)
      : [];

  return {
    filas: vista,
    total: n,
    pagina,
    paginas,
    desde: n === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1,
    hasta: (pagina - 1) * POR_PAGINA + vista.length,
    contadores: { amarillas: cont?.amarillas ?? 0, verdes: cont?.verdes ?? 0 },
    agencias,
  };
}
