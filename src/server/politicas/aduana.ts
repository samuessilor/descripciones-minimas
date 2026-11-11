/**
 * Vista del bloque de aduana de la ficha (SPEC 10.2): todo lo que la interfaz necesita en una sola lectura ya
 * filtrada para el actor (autores enmascarados entre agencias, A5; ficha ajena => 404). Tambien la busqueda en el
 * catalogo de partidas. Las paginas y componentes no consultan la base: usan esto.
 */
import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { asignacion, partidaArancelaria, restriccionPlantilla, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import type { TipoProducto } from '@/dominio/campos';
import { solicitudSinRespuesta, textoSolicitudAduana } from '@/dominio/completitud';
import { diasEnGestion } from '@/dominio/dias-gestion';
import { colorFicha, type ColorFicha, type EstadoFicha, type ModoCierre } from '@/dominio/estado';
import { escaparLike, normalizarTexto } from '@/dominio/normalizacion';
import { puede, puedeEscribirCampo, type TipoOrganizacion } from '@/dominio/permisos';
import { estaVacio } from '@/dominio/valores';
import { evaluarCierreDeFicha } from '../acciones/cierre';
import { infoDePartida, type InfoPartida } from '../acciones/partida';
import { getConfig } from '../config';
import type { Actor } from './actor';
import { cargarReferenciaVisible, nombreDeAutor } from './referencias';
import { fueReabierta } from './reapertura';

export interface CampoAduanaVista {
  valor: unknown;
  version: number;
  autor: string;
  propio: boolean;
  instante: string;
}

export interface AvisoCierreVista {
  regla: string;
  mensaje: string;
  detalle: string[];
}

export interface VistaAduana {
  referenciaId: string;
  codigo: string;
  nombreProducto: string;
  tipoProducto: TipoProducto;
  estado: EstadoFicha;
  color: ColorFicha;
  archivada: boolean;
  archivo: { en: string; por: string; motivo: string | null } | null;
  reabierta: boolean;
  versionFicha: number;
  diasEnGestion: number;
  permisos: {
    /** Puede escribir los campos de la aduana ahora (rol correcto y ficha abierta). */
    editar: boolean;
    /** Puede escribir la respuesta del area a la solicitud de la aduana (area o admin, ficha abierta). */
    responder: boolean;
    cerrar: boolean;
    reabrir: boolean;
    solicitarReapertura: boolean;
    archivar: boolean;
    desarchivar: boolean;
  };
  /** Por que no se puede editar, si es el caso (para decirlo en pantalla). */
  bloqueo: 'clasificada' | 'archivada' | 'borrador' | 'sin_permiso' | null;
  partida: CampoAduanaVista | null;
  /** Arancel de la partida (`valor` = '0%' | '5%' | '10%' | '15%') e IVA ('0%' | '19%'): la aduana los elige despues de la partida. */
  arancel: CampoAduanaVista | null;
  iva: CampoAduanaVista | null;
  /** ¿Requiere registro de importacion (RIM)? La responde la aduana: `valor` = 'SI' | 'NO'. */
  requiereRim: CampoAduanaVista | null;
  infoPartida: InfoPartida | null;
  /** Descripciones minimas adicionales: lo que la aduana pide saber (texto) o «No es necesario por ahora / no aplica». */
  descripcionesMinimas: CampoAduanaVista | null;
  /** Respuesta del area a esa solicitud (`valor` = `{ texto, sobre }`). */
  respuestaArea: CampoAduanaVista | null;
  /** Hay una solicitud de la aduana que el area no ha respondido (o que cambio despues de la respuesta). */
  solicitudPendiente: boolean;
  restricciones: CampoAduanaVista | null;
  /** Norma del catalogo asociada a la partida (referencia; la ficha guarda su propia copia editable). */
  restriccionCatalogo: { codigo: string; texto: string } | null;
  normas: string[];
  observaciones: CampoAduanaVista | null;
  finalizada: CampoAduanaVista | null;
  cierre: { ok: boolean; bloqueos: AvisoCierreVista[]; advertencias: AvisoCierreVista[]; requiereMotivo: boolean; modo: ModoCierre };
  clasificada: { en: string; por: string | null; accesoHasta: string | null } | null;
  solicitudReapertura: { de: string; motivo: string | null; en: string } | null;
}

const NORMAS = ['RETIE', 'RETILAP', 'RETIQ', 'RAEE', 'ANLA', 'RPCAEE'] as const;

/** Siglas de normas que aparecen en el texto de una restriccion (para rotularlas). */
export function normasDeTexto(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return NORMAS.filter((n) => new RegExp(`\\b${n}\\b`).test(texto));
}

export async function vistaAduana(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<VistaAduana> {
  const ficha = await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const tipo = ficha.tipoProducto as TipoProducto;
  const estado = ficha.estado as EstadoFicha;
  const archivada = ficha.archivadaEn !== null;
  const datos = ficha.datos ?? {};

  // ---- personas (autores) -------------------------------------------------------------------------
  const ids = new Set<string>([
    ficha.creadaPor,
    ...(ficha.clasificadaPor ? [ficha.clasificadaPor] : []),
    ...(ficha.archivadaPor ? [ficha.archivadaPor] : []),
    ...Object.values(datos).map((e) => e.a),
  ]);
  const personas = ids.size
    ? await ej
        .select({ id: usuario.id, nombre: usuario.nombre, organizacionId: usuario.organizacionId, organizacionTipo: usuario.organizacionTipo })
        .from(usuario)
        .where(inArray(usuario.id, [...ids]))
    : [];
  const porId = new Map(personas.map((p) => [p.id, { ...p, organizacionTipo: p.organizacionTipo as TipoOrganizacion }]));
  const nombre = (id: string | null | undefined): string => (id ? nombreDeAutor(actor, porId.get(id)) : 'Alguien');

  const campo = (clave: string): CampoAduanaVista | null => {
    const e = datos[clave];
    if (!e) return null;
    return { valor: e.v, version: e.n, autor: nombre(e.a), propio: e.a === actor.usuarioId, instante: e.t };
  };

  // ---- partida y restriccion -----------------------------------------------------------------------
  const infoPartida = ficha.partida ? await infoDePartida(ej, ficha.partida) : null;
  const restriccionesCampo = campo('restricciones');

  // ---- permisos -------------------------------------------------------------------------------------
  const escribe = puedeEscribirCampo(actor, 'partida_arancelaria', { estado, archivada, creadaPor: ficha.creadaPor });
  const valores: Record<string, unknown> = {};
  for (const [clave, e] of Object.entries(datos)) valores[clave] = e.v;
  const responde =
    textoSolicitudAduana(valores) !== '' && puedeEscribirCampo(actor, 'respuesta_area', { estado, archivada, creadaPor: ficha.creadaPor }).ok;
  const puedeAduana = puede(actor, 'escribir_grupo_aduana');
  let bloqueo: VistaAduana['bloqueo'] = null;
  if (archivada) bloqueo = 'archivada';
  else if (estado === 'CLASIFICADA') bloqueo = 'clasificada';
  else if (!puedeAduana) bloqueo = 'sin_permiso';
  else if (estado === 'BORRADOR') bloqueo = 'borrador';

  const enviada = (await ej.select({ id: asignacion.id }).from(asignacion).where(eq(asignacion.referenciaId, ficha.id)).limit(1)).length > 0;

  // ---- cierre (vista previa con el mismo juez que usa finalizar) ------------------------------------
  const modo = getConfig().CIERRE_MODO;
  const panorama = evaluarCierreDeFicha(actor, ficha, modo);
  const r = panorama.resultado;
  const cierre: VistaAduana['cierre'] = r.ok
    ? { ok: true, bloqueos: [], advertencias: r.advertencias, requiereMotivo: r.requiereMotivo, modo }
    : { ok: false, bloqueos: r.bloqueos, advertencias: [], requiereMotivo: false, modo };

  // ---- otros datos -----------------------------------------------------------------------------------
  const [solicitud] = await ej
    .select({ de: asignacion.deUsuarioId, mensaje: asignacion.mensaje, en: asignacion.creadaEn })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.pedido, 'revisar'), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
    .orderBy(desc(asignacion.creadaEn))
    .limit(1);
  if (solicitud && !porId.has(solicitud.de)) {
    const [u] = await ej
      .select({ id: usuario.id, nombre: usuario.nombre, organizacionId: usuario.organizacionId, organizacionTipo: usuario.organizacionTipo })
      .from(usuario)
      .where(eq(usuario.id, solicitud.de))
      .limit(1);
    if (u) porId.set(u.id, { ...u, organizacionTipo: u.organizacionTipo as TipoOrganizacion });
  }

  let accesoHasta: string | null = null;
  if (estado === 'CLASIFICADA' && ficha.clasificadaEn && actor.rol === 'aduana') {
    const [a] = await ej
      .select({ hasta: asignacion.accesoHasta })
      .from(asignacion)
      .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
      .where(and(eq(asignacion.referenciaId, ficha.id), eq(usuario.organizacionId, actor.organizacionId)))
      .orderBy(desc(asignacion.accesoHasta))
      .limit(1);
    accesoHasta = a?.hasta ? a.hasta.toISOString() : null;
  }

  return {
    referenciaId: ficha.id,
    codigo: ficha.codigo,
    nombreProducto: ficha.nombreProducto,
    tipoProducto: tipo,
    estado,
    color: colorFicha(estado),
    archivada,
    archivo: archivada
      ? { en: (ficha.archivadaEn as Date).toISOString(), por: nombre(ficha.archivadaPor), motivo: ficha.motivoArchivo }
      : null,
    reabierta: estado === 'EN_GESTION' ? await fueReabierta(ej, ficha.id) : false,
    versionFicha: ficha.version,
    diasEnGestion: diasEnGestion({ fechaSolicitud: ficha.fechaSolicitud, clasificadaEn: ficha.clasificadaEn, ahora, diasPausa: ficha.diasPausa }),
    permisos: {
      editar: escribe.ok,
      responder: responde,
      cerrar: !archivada && estado === 'EN_GESTION' && puede(actor, 'marcar_clasificada'),
      reabrir: !archivada && estado === 'CLASIFICADA' && puede(actor, 'reabrir'),
      solicitarReapertura: !archivada && estado === 'CLASIFICADA' && puede(actor, 'solicitar_reapertura'),
      archivar:
        !archivada &&
        puede(actor, 'archivar', {
          esCreador: ficha.creadaPor === actor.usuarioId,
          esBorradorSinEnviar: estado === 'BORRADOR' && !enviada,
        }),
      desarchivar: archivada && puede(actor, 'desarchivar'),
    },
    bloqueo,
    partida: campo('partida_arancelaria'),
    arancel: campo('arancel'),
    iva: campo('iva'),
    requiereRim: campo('requiere_rim'),
    infoPartida,
    descripcionesMinimas: campo('descripciones_minimas'),
    respuestaArea: campo('respuesta_area'),
    solicitudPendiente: solicitudSinRespuesta(valores),
    restricciones: restriccionesCampo,
    restriccionCatalogo: infoPartida?.restriccion ? { codigo: infoPartida.restriccion.codigo, texto: infoPartida.restriccion.texto } : null,
    normas: normasDeTexto(
      typeof restriccionesCampo?.valor === 'string' ? restriccionesCampo.valor : estaVacio(restriccionesCampo?.valor) ? infoPartida?.restriccion?.texto : '',
    ),
    observaciones: campo('observaciones_aduana'),
    finalizada: campo('clasificacion_finalizada'),
    cierre,
    clasificada: ficha.clasificadaEn
      ? { en: ficha.clasificadaEn.toISOString(), por: ficha.clasificadaPor ? nombre(ficha.clasificadaPor) : null, accesoHasta }
      : null,
    solicitudReapertura: solicitud
      ? { de: nombre(solicitud.de), motivo: solicitud.mensaje, en: solicitud.en.toISOString() }
      : null,
  };
}

// ---- Catalogo de partidas -------------------------------------------------------------------------------

export interface SugerenciaPartida {
  codigo: string;
  descripcion: string | null;
  /** Codigo de la restriccion activa del catalogo que se copiara a la ficha. */
  restriccion: string | null;
  origen: 'semilla' | 'aduana';
}

/**
 * Busca partidas del catalogo por los digitos escritos (con o sin puntos) o por una palabra de la descripcion.
 * Maximo 8. Solo partidas activas.
 */
export async function buscarPartidas(ej: Ejecutor, q: string, limite = 8): Promise<SugerenciaPartida[]> {
  const texto = q.trim();
  if (texto === '') return [];
  const digitos = texto.replace(/\D/g, '');
  const soloNumerica = /^[\d.\-\s]+$/.test(texto);
  const cond = soloNumerica
    ? digitos.length === 0
      ? undefined
      : like(sql`replace(${partidaArancelaria.codigo}, '.', '')`, `${escaparLike(digitos)}%`)
    : like(sql`translate(lower(coalesce(${partidaArancelaria.descripcion}, '')), 'áéíóúüñ', 'aeiouun')`, `%${escaparLike(normalizarTexto(texto))}%`);
  if (!cond) return [];
  const filas = await ej
    .select({
      codigo: partidaArancelaria.codigo,
      descripcion: partidaArancelaria.descripcion,
      origen: partidaArancelaria.origen,
      restriccion: restriccionPlantilla.codigo,
      restriccionActiva: restriccionPlantilla.activa,
    })
    .from(partidaArancelaria)
    .leftJoin(restriccionPlantilla, eq(restriccionPlantilla.id, partidaArancelaria.restriccionId))
    .where(and(eq(partidaArancelaria.activa, true), cond))
    .orderBy(asc(partidaArancelaria.codigo))
    .limit(Math.min(limite, 20));
  return filas.map((f) => ({
    codigo: f.codigo,
    descripcion: f.descripcion,
    restriccion: f.restriccionActiva ? f.restriccion : null,
    origen: f.origen as 'semilla' | 'aduana',
  }));
}

