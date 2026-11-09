/**
 * Responsabilidad del AREA (C1, reunion con el area 2026-10-29). Cada referencia tiene un «Área responsable» y le
 * pertenece a esa area: mientras nadie tenga en la mano lo que le falta al area, la responsable es el area, sin crear
 * filas extra (se deriva al leer). Volumen bajo: se calcula sobre las fichas abiertas del area, sin cache.
 *
 * Una sola regla para todo:
 *  - «Para mí» e Inicio de las cuentas internas activas del area: las referencias abiertas del area con secciones del
 *    area pendientes que no tiene asignadas ninguna persona (`pendientesDelArea`).
 *  - Resumen y listado: «Área Mantenimiento» en vez de «Sin responsable» cuando el area tiene al menos una cuenta.
 *  - El KPI «Sin responsable» y el filtro `sinResponsable` del listado y del Excel: EN_GESTION, sin asignacion activa
 *    y sin un area con cuenta activa (`condicionSinResponsable`; el Resumen aplica lo mismo con `areasConCuenta`).
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { esArea } from '@/dominio/areas';
import { ETIQUETA_SECCION, SECCIONES, type Seccion, type TipoProducto } from '@/dominio/campos';
import { listaHumana, plural } from '@/dominio/colaboracion';
import { calcularCompletitud, type Completitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, type EstadoFicha } from '@/dominio/estado';
import type { Datos } from '@/db/esquema/nucleo';
import type { Actor } from './actor';
import { responsablesPorParte, type ResponsablesPorParte } from './tablero';

/** Area responsable guardada en la proyeccion `datos` (una sola fuente: el campo de la ficha). */
export const areaDeReferencia = sql<string | null>`(${referencia.datos} -> 'area_responsable' ->> 'v')`;

/** Cuentas que responden por un area: internas, activas, de organizacion activa y que pueden llenar (no lector). */
const condicionCuentaDeArea = sql`u.activo and o.activa and u.organizacion_tipo = 'interna' and u.rol <> 'lector'`;

/** Areas con al menos una cuenta que responde por ellas. */
export async function areasConCuenta(ej: Ejecutor): Promise<Set<string>> {
  const filas = await ej
    .selectDistinct({ area: usuario.area })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(
      and(
        eq(usuario.activo, true),
        eq(organizacion.activa, true),
        eq(usuario.organizacionTipo, 'interna'),
        sql`${usuario.rol} <> 'lector'`,
        sql`${usuario.area} is not null`,
      ),
    );
  return new Set(filas.map((f) => f.area).filter((a): a is string => !!a));
}

/** Area responsable de una ficha si tiene quien responda por ella; `null` si no hay area o no tiene cuentas. */
export function areaQueResponde(datos: Datos | null | undefined, areas: ReadonlySet<string>): string | null {
  const a = datos?.area_responsable?.v;
  return esArea(a) && areas.has(a) ? a : null;
}

/**
 * «Sin responsable» (regla 11 del SPEC + C1): en gestion, sin ninguna asignacion activa y sin un area responsable con
 * cuenta activa. La usan el filtro del listado, el Excel filtrado y el contador de Inicio.
 */
export function condicionSinResponsable(): SQL {
  return sql`(${referencia.estado} = 'EN_GESTION'
    and not exists (select 1 from ${asignacion} a where a.referencia_id = ${referencia.id} and a.estado in ('pendiente','en_curso'))
    and not exists (select 1 from ${usuario} u join ${organizacion} o on o.id = u.organizacion_id
                    where u.area = ${areaDeReferencia} and ${condicionCuentaDeArea}))`;
}

/** Secciones del area que faltan y que no tiene en la mano ninguna persona (con asignacion activa). */
export function seccionesSinDueno(c: Completitud, quien: ResponsablesPorParte | undefined): Seccion[] {
  return SECCIONES.filter((s) => c.secciones[s].estado === 'amarillo' && c.secciones[s].faltan > 0 && (quien?.[s].length ?? 0) === 0);
}

export interface PendienteDelArea {
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  area: string;
  secciones: Seccion[];
  /** Desde la creacion de la ficha (ISO). */
  desde: string;
  diasEnGestion: number;
  color: ReturnType<typeof colorFicha>;
  falta: string;
}

/**
 * Lo que el area del actor tiene pendiente sin que nadie se lo haya enviado: referencias abiertas (no clasificadas
 * ni archivadas) cuya area responsable es la suya, con secciones del area pendientes sin persona asignada. No repite
 * las que el actor ya tiene asignadas (esas salen como pendiente normal).
 */
export async function pendientesDelArea(ej: Ejecutor, actor: Actor, ahora: Date): Promise<PendienteDelArea[]> {
  const area = actor.area;
  if (actor.organizacionTipo !== 'interna' || actor.rol === 'lector' || !esArea(area)) return [];
  const filas = await ej
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estado: referencia.estado,
      datos: referencia.datos,
      creadaEn: referencia.creadaEn,
      fechaSolicitud: referencia.fechaSolicitud,
      clasificadaEn: referencia.clasificadaEn,
      diasPausa: referencia.diasPausa,
    })
    .from(referencia)
    .where(
      and(
        isNull(referencia.archivadaEn),
        sql`${referencia.estado} <> 'CLASIFICADA'`,
        sql`${areaDeReferencia} = ${area}`,
        sql`not exists (select 1 from ${asignacion} a where a.referencia_id = ${referencia.id} and a.a_usuario_id = ${actor.usuarioId}
              and a.estado in ('pendiente','en_curso'))`,
      ),
    );
  if (filas.length === 0) return [];
  const quien = await responsablesPorParte(ej, actor, filas.map((f) => f.id), ahora);
  const resultado: PendienteDelArea[] = [];
  for (const f of filas) {
    const valores: Record<string, unknown> = {};
    for (const [clave, e] of Object.entries(f.datos ?? {})) valores[clave] = e.v;
    const c = calcularCompletitud({ tipo: f.tipoProducto as TipoProducto, valores });
    const secciones = seccionesSinDueno(c, quien.get(f.id));
    if (secciones.length === 0) continue;
    const faltan = secciones.reduce((n, s) => n + c.secciones[s].faltan, 0);
    resultado.push({
      referenciaId: f.id,
      codigo: f.codigo,
      nombreProducto: f.nombreProducto,
      tipoProducto: f.tipoProducto as TipoProducto,
      area,
      secciones,
      desde: f.creadaEn.toISOString(),
      diasEnGestion: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora, diasPausa: f.diasPausa }),
      color: colorFicha(f.estado as EstadoFicha),
      falta: `Falta: ${listaHumana(secciones.map((s) => ETIQUETA_SECCION[s]))} (${plural(faltan, 'campo', 'campos')})`,
    });
  }
  return resultado;
}
