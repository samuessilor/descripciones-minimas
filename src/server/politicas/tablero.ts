/**
 * Tablero (vista general): que esta cerrado, que esta pendiente y, sobre todo, DE QUIEN esta pendiente.
 *
 * Una fila por referencia abierta con sus cuatro partes (Producto, Detalle, Especificaciones y Datos de la
 * aduana): cada una verde o amarilla y, si esta amarilla, la persona a la que se le dejo. De ahi sale la frase
 * «Esperando a Edgar (Detalle)» o «Sin responsable en Detalle», que es la pista para destrabar el paso.
 *
 * Volumen bajo (cientos de referencias): se calcula al leer, sin tablas de resumen ni cache.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { SECCIONES, type TipoProducto } from '@/dominio/campos';
import { ETIQUETA_PARTE, listaHumana, nombreSinMarca, partesDeAsignacion, type ParteFicha, type Pedido } from '@/dominio/colaboracion';
import { calcularCompletitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { nombreDeArea } from '@/dominio/areas';
import type { EstadoFicha } from '@/dominio/estado';
import type { Rol, TipoOrganizacion } from '@/dominio/permisos';
import type { Actor } from './actor';
import { condicionVisible, nombreDeAutor } from './referencias';
import { areaQueResponde, areasConCuenta } from './responsable-area';

/** Dias sin movimiento a partir de los cuales una referencia abierta se marca como detenida. */
export const DIAS_DETENIDA = 5;

export const PARTES: readonly ParteFicha[] = [...SECCIONES, 'aduana'];

export interface ResponsableParte {
  asignacionId: string;
  usuarioId: string;
  nombre: string;
  organizacion: string;
  desde: string;
  /** Dias calendario aproximados desde que se le dejo. */
  dias: number;
  /** Lo que se le pidio. `responder` = la aduana (o un admin) le pidio informacion con «Enviar a». */
  pedido?: Pedido | null;
}

export type ResponsablesPorParte = Record<ParteFicha, ResponsableParte[]>;

const vacio = (): ResponsablesPorParte => ({ producto: [], detalle: [], especificaciones: [], aduana: [] });

const diasDesde = (d: Date, ahora: Date) => Math.max(0, Math.floor((ahora.getTime() - d.getTime()) / 86_400_000));

/** Quien tiene pendiente cada parte de cada referencia (asignaciones activas). Respeta el enmascarado de agencias. */
export async function responsablesPorParte(
  ej: Ejecutor,
  actor: Actor,
  referenciaIds: readonly string[],
  ahora: Date,
): Promise<Map<string, ResponsablesPorParte>> {
  const mapa = new Map<string, ResponsablesPorParte>();
  if (referenciaIds.length === 0) return mapa;
  const filas = await ej
    .select({
      asignacionId: asignacion.id,
      referenciaId: asignacion.referenciaId,
      secciones: asignacion.secciones,
      pedido: asignacion.pedido,
      creadaEn: asignacion.creadaEn,
      usuarioId: usuario.id,
      nombre: usuario.nombre,
      rol: usuario.rol,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
      organizacionNombre: organizacion.nombre,
    })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(and(inArray(asignacion.referenciaId, [...referenciaIds]), sql`${asignacion.estado} in ('pendiente','en_curso')`))
    .orderBy(asignacion.creadaEn);

  for (const f of filas) {
    const por = mapa.get(f.referenciaId) ?? vacio();
    const nombre = nombreDeAutor(actor, {
      id: f.usuarioId,
      nombre: nombreSinMarca(f.nombre),
      organizacionId: f.organizacionId,
      organizacionTipo: f.organizacionTipo as TipoOrganizacion,
    });
    const r: ResponsableParte = {
      asignacionId: f.asignacionId,
      usuarioId: f.usuarioId,
      nombre,
      organizacion: nombreSinMarca(f.organizacionNombre),
      desde: f.creadaEn.toISOString(),
      dias: diasDesde(f.creadaEn, ahora),
      pedido: (f.pedido as Pedido | null) ?? null,
    };
    for (const parte of partesDeAsignacion(f.secciones, f.rol as Rol)) por[parte].push(r);
    mapa.set(f.referenciaId, por);
  }
  return mapa;
}

export interface ParteVista {
  estado: 'verde' | 'amarillo';
  faltan: number;
  responsables: ResponsableParte[];
}

export interface Bloqueo {
  /** `ninguno` = cerrada. `sin_enviar` = borrador que nadie ha enviado. `sin_responsable` = una parte no la tiene nadie en la mano. */
  clase: 'ninguno' | 'persona' | 'sin_enviar' | 'sin_responsable';
  /** Frase lista para mostrar: «Esperando a Edgar (Detalle)». */
  texto: string;
  /** Personas de las que se espera algo. */
  personas: string[];
}

export interface FilaTablero {
  id: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  /** Area responsable con cuentas activas (C1); `null` si no tiene o nadie responde por ella. */
  area: string | null;
  partida: string | null;
  diasEnGestion: number;
  /** Dias desde el ultimo cambio. */
  diasSinMovimiento: number;
  detenida: boolean;
  actualizadaEn: string;
  clasificadaEn: string | null;
  partes: Record<ParteFicha, ParteVista>;
  bloqueo: Bloqueo;
}

export interface Tablero {
  resumen: { total: number; clasificadas: number; abiertas: number; sinResponsable: number; detenidas: number };
  /** Cuantas referencias abiertas espera cada persona y desde hace cuanto. */
  porPersona: Array<{ usuarioId: string; nombre: string; organizacion: string; pendientes: number; masAntiguaDias: number }>;
  abiertas: FilaTablero[];
  /** Ultimas cerradas, con producto y fecha. */
  cerradas: FilaTablero[];
}

const LIMITE_CERRADAS = 30;

/**
 * Quien falta: la razon inmediata por la que una referencia abierta no avanza. `area` es el area responsable de la
 * ficha cuando tiene cuentas activas (C1): lo que no tiene ninguna persona en la mano espera a esa area.
 */
export function calcularBloqueo(
  partes: Record<ParteFicha, ParteVista>,
  estado: EstadoFicha,
  area: string | null = null,
): Bloqueo {
  if (estado === 'CLASIFICADA') return { clase: 'ninguno', texto: 'Clasificada', personas: [] };
  const delArea = area ? nombreDeArea(area) : null;
  // Borrador que su autor aun no envia a nadie: lo mismo que dice el listado, no «Sin responsable» (regla 11 del SPEC).
  if (estado === 'BORRADOR' && !delArea && PARTES.every((p) => partes[p].responsables.length === 0)) {
    return { clase: 'sin_enviar', texto: 'Aún sin enviar', personas: [] };
  }

  // Una seccion amarilla sin campos por llenar solo espera a la aduana (pidio mas informacion): no es del area.
  const amarillasArea = SECCIONES.filter((s) => partes[s].estado === 'amarillo' && partes[s].faltan > 0);
  const sinDueno = amarillasArea.filter((s) => partes[s].responsables.length === 0);
  if (sinDueno.length > 0 && !delArea) {
    const nombres = sinDueno.map((s) => ETIQUETA_PARTE[s]);
    return { clase: 'sin_responsable', texto: `Sin responsable en ${listaHumana(nombres)}`, personas: [] };
  }

  const porPersona = new Map<string, string[]>();
  const agregar = (nombre: string, parte: ParteFicha) =>
    porPersona.set(nombre, [...(porPersona.get(nombre) ?? []), ETIQUETA_PARTE[parte]]);
  if (delArea) for (const s of sinDueno) agregar(delArea, s);
  for (const s of amarillasArea) for (const r of partes[s].responsables) agregar(r.nombre, s);

  // A quien la aduana le pidio informacion («Responder») detiene la ficha aunque sus secciones ya esten en verde.
  const responden = SECCIONES.flatMap((s) => partes[s].responsables).filter((r) => r.pedido === 'responder');
  for (const r of responden) porPersona.set(r.nombre, [...(porPersona.get(r.nombre) ?? []), 'Información pedida']);

  if (amarillasArea.length === 0 && responden.length === 0) {
    // El area termino: lo que falta es la aduana.
    if (partes.aduana.responsables.length === 0) {
      return delArea
        ? { clase: 'persona', texto: `El área terminó: ${delArea} debe enviarla a la aduana`, personas: [delArea] }
        : { clase: 'sin_responsable', texto: 'El área terminó: falta enviarla a la aduana', personas: [] };
    }
    for (const r of partes.aduana.responsables) agregar(r.nombre, 'aduana');
  }

  const personas = [...porPersona.keys()];
  // De una persona basta el primer nombre; el area se nombra completa («Área Mantenimiento»).
  const frases = personas.map((n) => `${n === delArea ? n : n.split(' ')[0]} (${listaHumana([...new Set(porPersona.get(n) ?? [])])})`);
  return { clase: 'persona', texto: `Esperando a ${listaHumana(frases)}`, personas };
}

export async function tableroDe(ej: Ejecutor, actor: Actor, ahora: Date): Promise<Tablero> {
  const visible = condicionVisible(actor, ahora);
  const sinArchivar = isNull(referencia.archivadaEn);

  const [cont] = await ej
    .select({
      total: sql<number>`count(*)::int`,
      cerradas: sql<number>`(count(*) filter (where ${referencia.estado} = 'CLASIFICADA'))::int`,
    })
    .from(referencia)
    .where(and(visible, sinArchivar));

  const abiertasFilas = await ej
    .select()
    .from(referencia)
    .where(and(visible, sinArchivar, sql`${referencia.estado} <> 'CLASIFICADA'`))
    .orderBy(referencia.fechaSolicitud, referencia.id);
  const cerradasFilas = await ej
    .select()
    .from(referencia)
    .where(and(visible, sinArchivar, eq(referencia.estado, 'CLASIFICADA')))
    .orderBy(desc(referencia.clasificadaEn))
    .limit(LIMITE_CERRADAS);

  const responsables = await responsablesPorParte(ej, actor, abiertasFilas.map((r) => r.id), ahora);
  const areas = await areasConCuenta(ej);

  const construir = (r: (typeof abiertasFilas)[number]): FilaTablero => {
    const tipo = r.tipoProducto as TipoProducto;
    const estado = r.estado as EstadoFicha;
    const valores: Record<string, unknown> = {};
    for (const [clave, e] of Object.entries(r.datos ?? {})) valores[clave] = e.v;
    const comp = calcularCompletitud({ tipo, valores });
    const cerrada = estado === 'CLASIFICADA';
    const quien = responsables.get(r.id) ?? vacio();
    const partes = {} as Record<ParteFicha, ParteVista>;
    for (const s of SECCIONES) {
      partes[s] = { estado: cerrada ? 'verde' : comp.secciones[s].estado, faltan: cerrada ? 0 : comp.secciones[s].faltan, responsables: cerrada ? [] : quien[s] };
    }
    partes.aduana = { estado: cerrada ? 'verde' : 'amarillo', faltan: cerrada ? 0 : comp.aduana.faltan, responsables: cerrada ? [] : quien.aduana };
    const diasSin = diasDesde(r.actualizadaEn, ahora);
    const area = areaQueResponde(r.datos, areas);
    return {
      id: r.id,
      area,
      codigo: r.codigo,
      nombreProducto: r.nombreProducto,
      tipoProducto: tipo,
      estado,
      partida: r.partida,
      diasEnGestion: diasEnGestion({ fechaSolicitud: r.fechaSolicitud, clasificadaEn: r.clasificadaEn, ahora, diasPausa: r.diasPausa }),
      diasSinMovimiento: diasSin,
      detenida: !cerrada && diasSin >= DIAS_DETENIDA,
      actualizadaEn: r.actualizadaEn.toISOString(),
      clasificadaEn: r.clasificadaEn ? r.clasificadaEn.toISOString() : null,
      partes,
      bloqueo: calcularBloqueo(partes, estado, area),
    };
  };

  const abiertas = abiertasFilas.map(construir);
  const cerradas = cerradasFilas.map(construir);

  // Cuantas referencias espera cada persona (una persona cuenta una vez por referencia).
  const cuenta = new Map<string, { usuarioId: string; nombre: string; organizacion: string; refs: Set<string>; masAntigua: number }>();
  for (const f of abiertas) {
    for (const parte of PARTES) {
      for (const r of f.partes[parte].responsables) {
        // Una parte en verde ya no espera a nadie, salvo que se le haya pedido informacion a esa persona.
        if (f.partes[parte].estado === 'verde' && r.pedido !== 'responder') continue;
        const e = cuenta.get(r.usuarioId) ?? { usuarioId: r.usuarioId, nombre: r.nombre, organizacion: r.organizacion, refs: new Set<string>(), masAntigua: 0 };
        e.refs.add(f.id);
        e.masAntigua = Math.max(e.masAntigua, r.dias);
        cuenta.set(r.usuarioId, e);
      }
    }
  }
  const porPersona = [...cuenta.values()]
    .map((e) => ({ usuarioId: e.usuarioId, nombre: e.nombre, organizacion: e.organizacion, pendientes: e.refs.size, masAntiguaDias: e.masAntigua }))
    .sort((a, b) => b.pendientes - a.pendientes || b.masAntiguaDias - a.masAntiguaDias);

  return {
    resumen: {
      total: cont?.total ?? 0,
      clasificadas: cont?.cerradas ?? 0,
      abiertas: abiertas.length,
      // Regla 11 del SPEC (RV-35, CA-35) + C1: EN_GESTION sin ninguna asignacion activa ni area responsable con cuenta,
      // igual que el filtro del listado y el contador de Inicio (`condicionSinResponsable`). La falta de dueno por
      // seccion la sigue diciendo la columna «Quien falta».
      sinResponsable: abiertas.filter((f) => f.estado === 'EN_GESTION' && !responsables.has(f.id) && !f.area).length,
      detenidas: abiertas.filter((f) => f.detenida).length,
    },
    porPersona,
    abiertas,
    cerradas,
  };
}
