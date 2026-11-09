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
import type { Datos } from '@/db/esquema/nucleo';
import type { Ejecutor } from '@/db/tipos';
import { esArea } from '@/dominio/areas';
import { ETIQUETA_SECCION, SECCIONES, TIPOS_PRODUCTO, camposObligatoriosCliente, type Seccion, type TipoProducto } from '@/dominio/campos';
import { listaHumana, plural } from '@/dominio/colaboracion';
import { calcularCompletitud, type Completitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, type EstadoFicha } from '@/dominio/estado';
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
 * Claves de `datos` de las que depende lo que esta lista pregunta: las secciones del area con campos por llenar
 * (`calcularCompletitud` solo mira los obligatorios del cliente y los campos que los condicionan con `soloSi`). El
 * resto de la ficha (≈50 campos con autor, fecha y version) no hace falta para saber que le falta al area.
 */
const CLAVES_COMPLETITUD_AREA: readonly string[] = (() => {
  const claves = new Set<string>();
  for (const tipo of TIPOS_PRODUCTO) {
    for (const c of camposObligatoriosCliente(tipo)) {
      claves.add(c.clave);
      if (c.soloSi) claves.add(c.soloSi.clave);
    }
  }
  return [...claves];
})();

/**
 * Valor vigente (`v`) solo de esas claves, armado en la base con operadores jsonb: cada carga de Inicio deja de traer y
 * parsear el jsonb completo de cada ficha abierta del area. Una clave ausente queda en `null`, que para la completitud
 * es lo mismo que vacia.
 */
const valoresParaCompletitudArea = sql<Record<string, unknown>>`jsonb_build_object(${sql.join(
  CLAVES_COMPLETITUD_AREA.flatMap((clave) => [sql`${clave}::text`, sql`${referencia.datos} -> ${clave}::text -> 'v'`]),
  sql`, `,
)})`;

export interface PendientesDelArea {
  /** Las `limite` primeras en el orden de la bandeja (mas dias en gestion primero). */
  filas: PendienteDelArea[];
  /** Cuantas son en total, para decir «mostrando N de TOTAL» y para el contador de Inicio. */
  total: number;
}

/**
 * Lo que el area del actor tiene pendiente sin que nadie se lo haya enviado: referencias abiertas (no clasificadas
 * ni archivadas) cuya area responsable es la suya, con secciones del area pendientes sin persona asignada. No repite
 * las que el actor ya tiene asignadas (esas salen como pendiente normal).
 *
 * Para saber cuales cuentan hay que evaluar la completitud de todas las abiertas del area (el contador lo necesita),
 * pero eso se hace sobre los valores minimos (`valoresParaCompletitudArea`) y solo se arma la fila completa de las
 * `limite` que se van a mostrar.
 */
export async function pendientesDelArea(
  ej: Ejecutor,
  actor: Actor,
  ahora: Date,
  limite: number = Number.POSITIVE_INFINITY,
): Promise<PendientesDelArea> {
  const area = actor.area;
  if (actor.organizacionTipo !== 'interna' || actor.rol === 'lector' || !esArea(area)) return { filas: [], total: 0 };
  const abiertas = await ej
    .select({
      id: referencia.id,
      codigo: referencia.codigo,
      nombreProducto: referencia.nombreProducto,
      tipoProducto: referencia.tipoProducto,
      estado: referencia.estado,
      valores: valoresParaCompletitudArea,
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
  // Primero lo barato: solo las que aun tienen algo por llenar necesitan saber quien las tiene en la mano.
  const conFaltantes = abiertas
    .map((f) => ({ f, c: calcularCompletitud({ tipo: f.tipoProducto as TipoProducto, valores: f.valores ?? {} }) }))
    .filter(({ c }) => SECCIONES.some((s) => c.secciones[s].estado === 'amarillo' && c.secciones[s].faltan > 0));
  if (conFaltantes.length === 0) return { filas: [], total: 0 };
  const quien = await responsablesPorParte(ej, actor, conFaltantes.map(({ f }) => f.id), ahora);
  const candidatas = conFaltantes
    .map(({ f, c }) => ({
      f,
      c,
      secciones: seccionesSinDueno(c, quien.get(f.id)),
      dias: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora, diasPausa: f.diasPausa }),
    }))
    .filter((x) => x.secciones.length > 0)
    // Mismo orden que la bandeja (S-09): mas dias en gestion primero y, a igual dias, la mas antigua.
    .sort((a, b) => b.dias - a.dias || a.f.creadaEn.getTime() - b.f.creadaEn.getTime());
  const filas = candidatas.slice(0, limite).map(({ f, c, secciones, dias }): PendienteDelArea => {
    const faltan = secciones.reduce((n, s) => n + c.secciones[s].faltan, 0);
    return {
      referenciaId: f.id,
      codigo: f.codigo,
      nombreProducto: f.nombreProducto,
      tipoProducto: f.tipoProducto as TipoProducto,
      area,
      secciones,
      desde: f.creadaEn.toISOString(),
      diasEnGestion: dias,
      color: colorFicha(f.estado as EstadoFicha),
      falta: `Falta: ${listaHumana(secciones.map((s) => ETIQUETA_SECCION[s]))} (${plural(faltan, 'campo', 'campos')})`,
    };
  });
  return { filas, total: candidatas.length };
}
