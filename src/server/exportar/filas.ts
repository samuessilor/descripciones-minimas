/**
 * Convierte fichas de la base en filas de Excel (SPEC 15.1). Trabaja por LOTES de ids para que la memoria sea
 * constante aunque la base crezca. Aplica el enmascaramiento de agencias (A5): una agencia no ve el nombre de
 * personas de otra agencia, tampoco en el Excel.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { adjunto, asignacion, campoHistorial, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { CAMPOS, ETIQUETA_TIPO, type Seccion, type TipoProducto } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, etiquetaFicha, type EstadoFicha } from '@/dominio/estado';
import { nombrePais } from '@/dominio/paises';
import type { TipoOrganizacion } from '@/dominio/permisos';
import { estaVacio, textoDeValor } from '@/dominio/valores';
import type { Actor } from '../politicas/actor';
import { nombreDeAutor, type FilaReferencia } from '../politicas/referencias';

export type ValorCelda = string | number | Date | null;

export interface FilaBase {
  valores: Record<string, ValorCelda>;
  estadoColor: 'amarillo' | 'verde' | null;
}

interface InfoUsuario {
  id: string;
  nombre: string;
  organizacionId: string;
  organizacionTipo: TipoOrganizacion;
}

/** Cache de nombres para toda la exportacion (los usuarios son pocos). */
export class NombresUsuarios {
  private mapa = new Map<string, InfoUsuario>();
  constructor(private readonly actor: Actor) {}

  async cargar(ej: Ejecutor, ids: Iterable<string>): Promise<void> {
    const faltan = [...new Set(ids)].filter((i) => !this.mapa.has(i));
    if (faltan.length === 0) return;
    const filas = await ej
      .select({ id: usuario.id, nombre: usuario.nombre, organizacionId: usuario.organizacionId, organizacionTipo: usuario.organizacionTipo })
      .from(usuario)
      .where(inArray(usuario.id, faltan));
    for (const f of filas) this.mapa.set(f.id, { ...f, organizacionTipo: f.organizacionTipo as TipoOrganizacion });
  }

  nombre(id: string | null | undefined): string {
    if (!id) return '';
    return nombreDeAutor(this.actor, this.mapa.get(id));
  }

  /** Tipo de organizacion de una persona ya cargada (interna si no se conoce, como en el historial de la ficha). */
  tipoOrganizacion(id: string): TipoOrganizacion {
    return this.mapa.get(id)?.organizacionTipo ?? 'interna';
  }
}

/** Una fecha `YYYY-MM-DD` como fecha de Excel (medianoche UTC: el numero de serie queda entero). */
export function fechaSolo(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/**
 * Excel no tiene zonas horarias: un instante se escribe con la hora de pared de Bogota (UTC-5, sin horario de
 * verano) para que la persona vea la hora que vivio.
 */
export function fechaHoraBogota(instante: Date | string | null | undefined): Date | null {
  if (!instante) return null;
  const d = typeof instante === 'string' ? new Date(instante) : instante;
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() - 5 * 3_600_000);
}

const SECCION_DE: Record<string, Seccion> = Object.fromEntries(CAMPOS.map((c) => [c.clave, c.seccion]));

export interface ParametrosLote {
  ej: Ejecutor;
  actor: Actor;
  ahora: Date;
  nombres: NombresUsuarios;
}

export async function filasDeLote(p: ParametrosLote, ids: string[]): Promise<FilaBase[]> {
  const { ej, actor, ahora, nombres } = p;
  if (ids.length === 0) return [];

  const fichas = await ej.select().from(referencia).where(inArray(referencia.id, ids));
  const porId = new Map(fichas.map((f) => [f.id, f]));

  const fotos = await ej
    .select({ id: adjunto.referenciaId, n: sql<number>`count(*)::int` })
    .from(adjunto)
    .where(and(inArray(adjunto.referenciaId, ids), isNull(adjunto.retiradoEn)))
    .groupBy(adjunto.referenciaId);
  const fotosDe = new Map(fotos.map((f) => [f.id, f.n]));

  const activas = await ej
    .select({ ref: asignacion.referenciaId, a: asignacion.aUsuarioId })
    .from(asignacion)
    .where(and(inArray(asignacion.referenciaId, ids), inArray(asignacion.estado, ['pendiente', 'en_curso'])));
  const pendienteDe = new Map<string, string[]>();
  for (const a of activas) pendienteDe.set(a.ref, [...(pendienteDe.get(a.ref) ?? []), a.a]);

  // Reabierta: el ultimo evento del sistema sobre la clasificacion fue una reapertura (NO).
  const eventos = await ej
    .select({ ref: campoHistorial.referenciaId, valor: campoHistorial.valor })
    .from(campoHistorial)
    .where(and(inArray(campoHistorial.referenciaId, ids), eq(campoHistorial.campo, 'clasificacion_finalizada'), eq(campoHistorial.tipoEvento, 'sistema')))
    .orderBy(asc(campoHistorial.id));
  const reabierta = new Map<string, boolean>();
  for (const e of eventos) reabierta.set(e.ref, e.valor === 'NO');

  // Personas que hay que nombrar.
  const idsPersonas = new Set<string>();
  for (const f of fichas) {
    idsPersonas.add(f.creadaPor);
    for (const e of Object.values(f.datos ?? {})) idsPersonas.add(e.a);
  }
  for (const l of pendienteDe.values()) for (const i of l) idsPersonas.add(i);
  await nombres.cargar(ej, idsPersonas);

  const base: FilaBase[] = [];
  for (const id of ids) {
    const f = porId.get(id);
    if (!f) continue; // desaparecio entre el listado de ids y la lectura (no deberia): se omite
    base.push(
      construirFila(f, {
        actor,
        ahora,
        nombres,
        fotos: fotosDe.get(f.id) ?? 0,
        pendienteCon: pendienteDe.get(f.id) ?? [],
        reabierta: reabierta.get(f.id) ?? false,
      }),
    );
  }
  return base;
}

function construirFila(
  f: FilaReferencia,
  c: {
    actor: Actor;
    ahora: Date;
    nombres: NombresUsuarios;
    fotos: number;
    pendienteCon: string[];
    reabierta: boolean;
  },
): FilaBase {
  const datos = f.datos ?? {};
  const valores: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(datos)) valores[k] = e.v;
  const tipo = f.tipoProducto as TipoProducto;
  const estado = f.estado as EstadoFicha;
  const archivada = f.archivadaEn !== null;

  const completitud = calcularCompletitud({ tipo, valores });
  const etiqueta = etiquetaFicha({
    estado,
    archivada,
    reabierta: estado === 'EN_GESTION' && c.reabierta,
    finalizada: completitud.finalizada,
    tresSeccionesVerdes: completitud.tresSeccionesVerdes,
    esperaRespuesta: completitud.aduana.faltantes.includes('respuesta_area'),
  });
  const color = colorFicha(estado);
  const textoEstado = archivada ? 'Archivada' : color === 'verde' ? 'Clasificada' : 'Pendiente';

  const texto = (clave: string): string | null => {
    const v = valores[clave];
    if (estaVacio(v)) return null;
    return textoDeValor(v) || null;
  };
  // Autoria por seccion: la ultima edicion de cualquier campo de esa seccion.
  const ultima: Record<Seccion, { t: string; a: string } | null> = { producto: null, detalle: null, especificaciones: null };
  for (const [clave, e] of Object.entries(datos)) {
    const seccion = SECCION_DE[clave];
    if (!seccion) continue;
    const previa = ultima[seccion];
    if (!previa || e.t > previa.t) ultima[seccion] = { t: e.t, a: e.a };
  }

  const fabricacion = valores.fecha_fabricacion as { fecha?: string; por_confirmar?: boolean; nota?: string } | null | undefined;
  const rim = valores.requiere_rim;
  const pais = valores.pais_origen;

  const v: Record<string, ValorCelda> = {
    codigo: f.codigo,
    nombre: f.nombreProducto,
    tipo: ETIQUETA_TIPO[tipo],
    area_responsable: texto('area_responsable'),
    estado: textoEstado,
    etiqueta,
    fecha_solicitud: fechaSolo(f.fechaSolicitud),
    dias: diasEnGestion({ fechaSolicitud: f.fechaSolicitud, clasificadaEn: f.clasificadaEn, ahora: c.ahora, diasPausa: f.diasPausa }),
    creada_por: c.nombres.nombre(f.creadaPor),
    descripcion_factura: texto('descripcion_factura'),
    uso: texto('uso'),
    funciones: texto('funciones'),
    unidad_medida: texto('unidad_medida'),
    materia_constitutiva: texto('materia_constitutiva'),
    aspecto_fisico: texto('aspecto_fisico'),
    marca: texto('marca'),
    pais_origen: typeof pais === 'string' && pais !== '' ? nombrePais(pais) : null,
    fabricante: texto('fabricante'),
    // «El proveedor es el mismo fabricante» esta vinculado: el Excel muestra el nombre del fabricante.
    proveedor: (valores.proveedor as { mismo_fabricante?: boolean } | null)?.mismo_fabricante ? texto('fabricante') : texto('proveedor'),
    reembolsable: texto('reembolsable'),
    tipo_empaque: texto('tipo_empaque'),
    cantidad_empaque: texto('cantidad_empaque'),
    maquina_destino: texto('maquina_destino'),
    requiere_rim: rim === 'SI' ? 'Sí' : rim === 'NO' ? 'No' : null,
    fecha_fabricacion: fabricacion?.por_confirmar
      ? `Por confirmar${fabricacion.nota ? ` (${fabricacion.nota})` : ''}`
      : fechaSolo(fabricacion?.fecha ?? null),
    fotos: c.fotos > 0 ? `Sí (${c.fotos})` : 'No',
    informacion_adicional: texto('informacion_adicional'),
    partida: estado === 'CLASIFICADA' ? f.partida : null,
    arancel: texto('arancel'),
    iva: texto('iva'),
    descripciones_minimas: texto('descripciones_minimas'),
    respuesta_area: texto('respuesta_area'),
    restricciones: texto('restricciones'),
    observaciones_aduana: texto('observaciones_aduana'),
    finalizada: valores.clasificacion_finalizada === 'SI' ? 'SÍ' : valores.clasificacion_finalizada === 'NO' ? 'NO' : null,
    fecha_clasificacion: fechaSolo(f.clasificadaEn ? f.clasificadaEn.toISOString() : null),
    pendiente_con: c.pendienteCon.length > 0 ? [...new Set(c.pendienteCon.map((i) => c.nombres.nombre(i)))].join(', ') : null,
    actualizada: fechaHoraBogota(f.actualizadaEn),
    producto_por: ultima.producto ? c.nombres.nombre(ultima.producto.a) : null,
    producto_en: fechaHoraBogota(ultima.producto?.t),
    detalle_por: ultima.detalle ? c.nombres.nombre(ultima.detalle.a) : null,
    detalle_en: fechaHoraBogota(ultima.detalle?.t),
    especificaciones_por: ultima.especificaciones ? c.nombres.nombre(ultima.especificaciones.a) : null,
    especificaciones_en: fechaHoraBogota(ultima.especificaciones?.t),
    // Solo para la hoja «Resumen de estado» (no son columnas de la hoja Base): que tan completa va cada parte.
    resumen_producto: completitud.secciones.producto.texto,
    resumen_detalle: completitud.secciones.detalle.texto,
    resumen_especificaciones: completitud.secciones.especificaciones.texto,
    resumen_aduana: completitud.aduana.faltan === 0 ? 'Completa' : completitud.aduana.faltan === 1 ? 'Falta 1' : `Faltan ${completitud.aduana.faltan}`,
    resumen_faltan_area: completitud.area.faltan,
    resumen_faltan_aduana: completitud.aduana.faltan,
  };
  // `fecha_clasificacion` usa el dia de Bogota, no el de UTC.
  if (f.clasificadaEn) {
    const b = fechaHoraBogota(f.clasificadaEn);
    v.fecha_clasificacion = b ? new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())) : null;
  }

  return { valores: v, estadoColor: archivada ? null : color };
}
