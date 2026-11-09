/**
 * Cierre y ciclo de vida de la ficha del lado aduana (SPEC 8.1, 12.4): finalizar la clasificacion,
 * reabrirla, pedir su reapertura, archivar y desarchivar. Cada operacion es UNA transaccion que bloquea la
 * ficha (`FOR UPDATE`), comprueba permiso y estado, escribe el historial por `aplicarEscritura` y deja
 * avisos y auditoria.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { asignacion, partidaArancelaria, referencia, usuario } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { getCampo } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';
import { diasPausaAlReabrir } from '@/dominio/dias-gestion';
import {
  evaluarCierre,
  transicionar,
  TransicionInvalida,
  type Aviso,
  type EntradaCierre,
  type ModoCierre,
  type ReglaCierre,
} from '@/dominio/estado';
import { motivoVisible } from '@/dominio/normalizacion';
import { esGestor, puede } from '@/dominio/permisos';
import { estaVacio } from '@/dominio/valores';
import type { TipoProducto } from '@/dominio/campos';
import { getConfig } from '../config';
import { auditar } from '../auditoria';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import { cargarReferenciaBloqueada, valoresVigentes, type FilaReferencia } from '../politicas/referencias';
import {
  gestoresActivos,
  auditarAduana,
  avisarAduana,
  interesadosEnFicha,
  masDias,
  nombreParaDestinatario,
  personasActivas,
} from './aduana-comun';
import { aplicarEscritura } from './escritura';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

// ---- Evaluacion del cierre --------------------------------------------------------------------------

/** Etiqueta legible de una clave de campo del catalogo. */
function etiquetaCampo(clave: string): string {
  return getCampo(clave)?.etiqueta ?? clave;
}

/** G7 (reunion 2026-11): la aduana debe responder el RIM antes de cerrar; es una guarda dura, en cualquier modo. */
export type ReglaCierreAduana = ReglaCierre | 'G7';
export type AvisoCierreAduana = Omit<Aviso, 'regla'> & { regla: ReglaCierreAduana };
export type ResultadoCierreAduana =
  | { ok: true; advertencias: AvisoCierreAduana[]; requiereMotivo: boolean }
  | { ok: false; bloqueos: AvisoCierreAduana[] };

export interface PanoramaCierre {
  resultado: ResultadoCierreAduana;
  modo: ModoCierre;
}

/**
 * Calcula con el dominio puro lo que dejaria cerrar o advertiria hoy (G1/G6, A1-A3). Se usa para la
 * vista previa de la interfaz y, dentro de la transaccion, como juez definitivo del cierre. No consulta la base:
 * todo lo que decide esta en la ficha.
 */
export function evaluarCierreDeFicha(actor: Actor, ficha: FilaReferencia, modo: ModoCierre = getConfig().CIERRE_MODO): PanoramaCierre {
  const valores = valoresVigentes(ficha);
  const completitud = calcularCompletitud({ tipo: ficha.tipoProducto as TipoProducto, valores });
  // La respuesta del area a una solicitud de la aduana tambien es del area: si falta, se nombra con los demas.
  const faltaRespuesta = completitud.aduana.faltantes.includes('respuesta_area');
  const camposAreaFaltantes = [...Object.values(completitud.secciones).flatMap((s) => s.faltantes), ...(faltaRespuesta ? ['respuesta_area'] : [])].map(
    etiquetaCampo,
  );

  // «No aplica» cuenta como diligenciado: solo se advierte lo que de verdad quedo sin llenar.
  const entrada: EntradaCierre = {
    rol: actor.rol,
    fichaVisible: true, // la ficha ya se cargo con la politica de visibilidad del actor
    partida: ficha.partida,
    camposAreaFaltantes,
    descripcionesVacias: estaVacio(valores.descripciones_minimas),
    restriccionesVacias: estaVacio(valores.restricciones),
    observacionesVacias: estaVacio(valores.observaciones_aduana),
    modo,
  };
  const base = evaluarCierre(entrada);

  // G7: «¿Requiere registro de importacion (RIM)?» lo responde la aduana (grupo A); sin respuesta no se cierra.
  if (estaVacio(valores.requiere_rim)) {
    const g7: AvisoCierreAduana = {
      regla: 'G7',
      mensaje: `Falta responder «${etiquetaCampo('requiere_rim')}» (Sí o No) antes de cerrar la clasificación.`,
      detalle: [],
    };
    return { resultado: { ok: false, bloqueos: [...(base.ok ? [] : base.bloqueos), g7] }, modo };
  }
  return { resultado: base, modo };
}

function textoAdvertencias(r: Extract<ResultadoCierreAduana, { ok: true }>): string {
  return r.advertencias.map((a) => (a.detalle.length > 0 ? `${a.mensaje} (${a.detalle.join(', ')})` : a.mensaje)).join('; ');
}

// ---- Finalizar --------------------------------------------------------------------------------------

export const entradaFinalizar = z.object({
  referenciaId: z.uuid(),
  motivoCerrarDeTodosModos: textoLimpio().pipe(z.string().max(1000)).nullish(),
});
export type EntradaFinalizar = z.input<typeof entradaFinalizar>;

export interface ResultadoFinalizar {
  estado: 'CLASIFICADA';
  /** Mensajes de las advertencias con las que se cerro (vacio si cerro limpia). */
  advertencias: string[];
  versionFicha: number;
}

function exigirFichaEditable(ficha: FilaReferencia): void {
  if (ficha.archivadaEn) {
    throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia está archivada y no se edita.');
  }
}

/**
 * `clasificacion_finalizada = SI` (8.1, D-26): guardas duras G1 y G6, advertencias A1-A3 con "Cerrar de todos
 * modos" y motivo (o duras con `CIERRE_MODO=bloquear`), y todos los efectos en la MISMA transaccion: estado
 * CLASIFICADA, quien y cuando, historial, asignaciones a `hecha` (las de agencia con `acceso_hasta`) y aviso.
 */
export async function finalizar(ctx: Contexto, entrada: unknown): Promise<ResultadoFinalizar> {
  const e = parsear(entradaFinalizar, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const cfg = getConfig();

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);

    if (!puede(actor, 'marcar_clasificada')) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo la aduana, un administrador o la supervisora general pueden cerrar la clasificación.');
    }
    if (ficha.estado === 'CLASIFICADA') {
      throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia ya está clasificada. Para cambiarla, reábrela con un motivo.');
    }
    exigirFichaEditable(ficha);
    try {
      transicionar(ficha.estado as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA', 'cerrar');
    } catch (err) {
      if (err instanceof TransicionInvalida) {
        throw new ErrorAccion('VALIDACION', 'Esta referencia sigue en borrador. Quien la creó debe enviarla antes de clasificarla.');
      }
      throw err;
    }

    const panorama = evaluarCierreDeFicha(actor, ficha, cfg.CIERRE_MODO);
    const r = panorama.resultado;
    if (!r.ok) {
      const dura = r.bloqueos.some((b) => b.regla === 'G6') ? 'SIN_PERMISO' : 'VALIDACION';
      throw new ErrorAccion(dura, r.bloqueos.map((b) => b.mensaje).join(' '), { bloqueos: r.bloqueos });
    }

    const motivo = motivoVisible(e.motivoCerrarDeTodosModos);
    if (r.requiereMotivo && !motivo) {
      throw new ErrorAccion(
        'FALTA_MOTIVO',
        'Escribe por qué cierras con pendientes. Queda en el historial junto con la lista de lo que faltaba.',
        { advertencias: r.advertencias },
      );
    }
    const motivoHistorial = r.requiereMotivo ? `Cerrada de todos modos. ${textoAdvertencias(r)}. Motivo: ${motivo}` : null;

    // G1: una partida nueva se da de alta con origen `aduana` y su autor (D-11).
    await tx
      .insert(partidaArancelaria)
      .values({ codigo: ficha.partida as string, origen: 'aduana', creadaPor: actor.usuarioId })
      .onConflictDoNothing();

    // El hecho de cierre: evento del sistema con la lista de advertencias y el motivo (8.1). Quien cierra queda en
    // `clasificada_por` (los clasificadores se retiraron: no le importan a la empresa).
    const w = await aplicarEscritura(tx, actor, ficha, {
      campo: 'clasificacion_finalizada',
      valor: 'SI',
      tipoEvento: 'sistema',
      versionEsperada: null,
      motivo: motivoHistorial,
      omitirIgualdad: true,
      ahora,
    });

    const [cerrada] = await tx
      .update(referencia)
      .set({
        estado: 'CLASIFICADA',
        clasificadaEn: ahora,
        clasificadaPor: actor.usuarioId,
        version: w.ficha.version + 1,
        actualizadaEn: ahora,
      })
      .where(eq(referencia.id, ficha.id))
      .returning({ version: referencia.version });

    await cerrarAsignaciones(tx, ficha.id, ahora, cfg.ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR);

    // Aviso `clasificada` a quien creo la ficha y a quienes la enviaron (no a quien cierra).
    const interesados = (await interesadosEnFicha(tx, ficha.id, ficha.creadaPor)).filter((id) => id !== actor.usuarioId);
    for (const p of await personasActivas(tx, interesados)) {
      await avisarAduana(tx, { actor, persona: p, tipo: 'clasificada', ficha, titulo: `${nombreParaDestinatario(actor, p)} cerró la clasificación de ${ficha.codigo}`, ahora });
    }

    await auditarAduana(tx, {
      usuarioId: actor.usuarioId,
      accion: 'finalizar',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: {
        codigo: ficha.codigo,
        partida: ficha.partida,
        deTodosModos: r.requiereMotivo,
        advertencias: r.advertencias.map((a) => a.regla),
      },
      ip: ctx.ip,
      creadoEn: ahora,
    });

    return {
      estado: 'CLASIFICADA' as const,
      advertencias: r.advertencias.map((a) => a.mensaje),
      versionFicha: cerrada?.version ?? w.ficha.version + 1,
    };
  });
}

/**
 * Efecto de cerrar sobre las asignaciones (8.1, 8.3 regla 10): las activas pasan a `hecha`; las de personas de
 * una agencia reciben `acceso_hasta = ahora + ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR`. Las ya terminadas de una
 * agencia sin fecha de acceso tambien la reciben (si no, la agencia perderia la ficha en el mismo instante).
 */
async function cerrarAsignaciones(tx: Tx, referenciaId: string, ahora: Date, dias: number): Promise<void> {
  const hasta = masDias(ahora, dias);
  const filas = await tx
    .select({
      id: asignacion.id,
      estado: asignacion.estado,
      accesoHasta: asignacion.accesoHasta,
      tipoOrg: usuario.organizacionTipo,
    })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .where(and(eq(asignacion.referenciaId, referenciaId), inArray(asignacion.estado, ['pendiente', 'en_curso', 'hecha', 'reasignada'])));

  const activas = filas.filter((f) => f.estado === 'pendiente' || f.estado === 'en_curso');
  const activasAgencia = activas.filter((f) => f.tipoOrg === 'agencia').map((f) => f.id);
  const activasInternas = activas.filter((f) => f.tipoOrg !== 'agencia').map((f) => f.id);
  if (activasAgencia.length > 0) {
    await tx
      .update(asignacion)
      .set({ estado: 'hecha', completadaEn: ahora, accesoHasta: hasta })
      .where(inArray(asignacion.id, activasAgencia));
  }
  if (activasInternas.length > 0) {
    await tx.update(asignacion).set({ estado: 'hecha', completadaEn: ahora }).where(inArray(asignacion.id, activasInternas));
  }
  const terminadasSinFecha = filas
    .filter((f) => (f.estado === 'hecha' || f.estado === 'reasignada') && f.tipoOrg === 'agencia' && f.accesoHasta === null)
    .map((f) => f.id);
  if (terminadasSinFecha.length > 0) {
    await tx.update(asignacion).set({ accesoHasta: hasta }).where(inArray(asignacion.id, terminadasSinFecha));
  }
}

// ---- Reabrir ----------------------------------------------------------------------------------------

export const entradaMotivo = z.object({
  referenciaId: z.uuid(),
  motivo: textoLimpio().pipe(z.string().max(1000)),
});
export interface EntradaMotivo {
  referenciaId: string;
  motivo: string;
}

function exigirMotivo(motivo: string, mensaje: string): string {
  const m = motivoVisible(motivo);
  if (!m) throw new ErrorAccion('FALTA_MOTIVO', mensaje);
  return m;
}

/**
 * Reabrir (D-14, 8.1): solo `admin` o `aduana`, con motivo. Vuelve a EN_GESTION, `clasificada_en = null`,
 * `dias_pausa` absorbe los dias cerrada, y se escribe `clasificacion_finalizada = NO` como evento del sistema con
 * el motivo. La partida y todo lo demas siguen intactos en el historial.
 */
export async function reabrir(ctx: Contexto, entrada: unknown): Promise<{ ok: true; versionFicha: number }> {
  const e = parsear(entradaMotivo, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    if (!puede(actor, 'reabrir')) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo la aduana, un administrador o la supervisora general pueden reabrir una clasificación. Puedes solicitar su reapertura.');
    }
    exigirFichaEditable(ficha);
    if (ficha.estado !== 'CLASIFICADA' || !ficha.clasificadaEn) {
      throw new ErrorAccion('VALIDACION', 'Esta referencia no está clasificada, así que no hay nada que reabrir.');
    }
    const motivo = exigirMotivo(e.motivo, 'Escribe por qué reabres la clasificación. Queda en el historial.');

    const clasificadaEn = ficha.clasificadaEn;
    const clasificadaPor = ficha.clasificadaPor;
    const w = await aplicarEscritura(tx, actor, ficha, {
      campo: 'clasificacion_finalizada',
      valor: 'NO',
      tipoEvento: 'sistema',
      versionEsperada: null,
      motivo: `Reapertura. ${motivo}`,
      omitirIgualdad: true,
      ahora,
    });

    const nuevoEstado = transicionar('CLASIFICADA', 'reabrir');
    const [r] = await tx
      .update(referencia)
      .set({
        estado: nuevoEstado,
        clasificadaEn: null,
        clasificadaPor: null,
        diasPausa: diasPausaAlReabrir({ clasificadaEn, ahora, diasPausaPrevio: ficha.diasPausa }),
        version: w.ficha.version + 1,
        actualizadaEn: ahora,
      })
      .where(eq(referencia.id, ficha.id))
      .returning({ version: referencia.version });

    // Las solicitudes de reapertura pendientes ya fueron atendidas.
    await tx
      .update(asignacion)
      .set({ estado: 'hecha', completadaEn: ahora })
      .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.pedido, 'revisar'), inArray(asignacion.estado, ['pendiente', 'en_curso'])));

    // Quien reabre desde la agencia (o la ultima persona de la agencia con acceso vigente) vuelve a tener la
    // ficha en su bandeja como `clasificar`: si no, la agencia seguiria sin responsable (8.3 regla 10).
    const destino = await destinoDeAgenciaAlReabrir(tx, actor, ficha.id, ahora);
    if (destino) {
      const [existente] = await tx
        .select({ id: asignacion.id })
        .from(asignacion)
        .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, destino), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
        .limit(1);
      if (!existente) {
        await tx.insert(asignacion).values({
          referenciaId: ficha.id,
          deUsuarioId: actor.usuarioId,
          aUsuarioId: destino,
          pedido: 'clasificar',
          mensaje: 'Se reabrió la clasificación.',
          estado: destino === actor.usuarioId ? 'en_curso' : 'pendiente',
          creadaEn: ahora,
        });
      }
    }

    const interesados = [...new Set([...(await interesadosEnFicha(tx, ficha.id, ficha.creadaPor)), ...(clasificadaPor ? [clasificadaPor] : []), ...(destino ? [destino] : [])])].filter(
      (id) => id !== actor.usuarioId,
    );
    for (const p of await personasActivas(tx, interesados)) {
      await avisarAduana(tx, { actor, persona: p, tipo: 'reabierta', ficha, titulo: `${nombreParaDestinatario(actor, p)} reabrió la clasificación de ${ficha.codigo}`, ahora });
    }

    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'reabrir',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { codigo: ficha.codigo, partida: ficha.partida, motivo },
      ip: ctx.ip,
      creadoEn: ahora,
    });

    return { ok: true as const, versionFicha: r?.version ?? w.ficha.version + 1 };
  });
}

async function destinoDeAgenciaAlReabrir(tx: Tx, actor: Actor, referenciaId: string, ahora: Date): Promise<string | null> {
  if (actor.rol === 'aduana') return actor.usuarioId;
  const [ultima] = await tx
    .select({ a: asignacion.aUsuarioId })
    .from(asignacion)
    .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
    .where(
      and(
        eq(asignacion.referenciaId, referenciaId),
        eq(usuario.organizacionTipo, 'agencia'),
        eq(usuario.activo, true),
        inArray(asignacion.estado, ['hecha', 'reasignada']),
        sql`${asignacion.accesoHasta} is not null and ${asignacion.accesoHasta} > ${ahora.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(asignacion.completadaEn), desc(asignacion.creadaEn))
    .limit(1);
  return ultima?.a ?? null;
}

// ---- Solicitar reapertura ---------------------------------------------------------------------------

/**
 * Solicitar reapertura (8.1, 14): la pide el solicitante (o un admin o la supervisora); NO reabre por si sola. Crea una asignacion
 * `revisar` hacia quien clasifico (o hacia un admin o la supervisora si no hay) y avisa `reapertura_solicitada` a ambos.
 */
export async function solicitarReapertura(ctx: Contexto, entrada: unknown): Promise<{ ok: true; asignadoA: string | null }> {
  const e = parsear(entradaMotivo, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    if (!puede(actor, 'solicitar_reapertura')) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo quien solicitó la referencia, un administrador o la supervisora general pueden pedir su reapertura.');
    }
    exigirFichaEditable(ficha);
    if (ficha.estado !== 'CLASIFICADA') {
      throw new ErrorAccion('VALIDACION', 'Esta referencia no está clasificada, así que no hace falta pedir su reapertura.');
    }
    const motivo = exigirMotivo(e.motivo, 'Cuéntale al administrador por qué hay que reabrirla.');

    const admins = await gestoresActivos(tx, actor.usuarioId);
    const clasifico = ficha.clasificadaPor ? (await personasActivas(tx, [ficha.clasificadaPor]))[0] : undefined;
    // `revisar` solo se le ofrece a quien puede escribir algun campo: aduana o admin.
    const destino = clasifico && clasifico.id !== actor.usuarioId && (clasifico.rol === 'aduana' || esGestor(clasifico.rol)) ? clasifico : admins[0];

    if (destino) {
      const [existente] = await tx
        .select({ id: asignacion.id })
        .from(asignacion)
        .where(and(eq(asignacion.referenciaId, ficha.id), eq(asignacion.aUsuarioId, destino.id), inArray(asignacion.estado, ['pendiente', 'en_curso'])))
        .limit(1);
      if (existente) {
        await tx
          .update(asignacion)
          .set({ pedido: 'revisar', mensaje: motivo, deUsuarioId: actor.usuarioId })
          .where(eq(asignacion.id, existente.id));
      } else {
        await tx.insert(asignacion).values({
          referenciaId: ficha.id,
          deUsuarioId: actor.usuarioId,
          aUsuarioId: destino.id,
          pedido: 'revisar',
          mensaje: motivo,
          estado: 'pendiente',
          creadaEn: ahora,
        });
      }
    }

    const avisar = new Map<string, Awaited<ReturnType<typeof personasActivas>>[number]>();
    for (const p of admins) avisar.set(p.id, p);
    if (destino) avisar.set(destino.id, destino);
    for (const p of avisar.values()) {
      await avisarAduana(tx, { actor, persona: p, tipo: 'reapertura_solicitada', ficha, titulo: `${nombreParaDestinatario(actor, p)} pidió reabrir la clasificación de ${ficha.codigo}`, ahora });
    }

    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'solicitar_reapertura',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { codigo: ficha.codigo, motivo, asignadoA: destino?.id ?? null },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const, asignadoA: destino?.id ?? null };
  });
}

// ---- Archivar y desarchivar -------------------------------------------------------------------------

/**
 * Archivar (9, 8.1): no borra nada; marca `archivada_en` con motivo y guarda el estado previo. Lo hace un admin, o
 * el autor de la ficha mientras sea un borrador sin enviar. El codigo NO se libera (indice unico total).
 */
export async function archivar(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const e = parsear(entradaMotivo, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    const enviada = await tx
      .select({ id: asignacion.id })
      .from(asignacion)
      .where(eq(asignacion.referenciaId, ficha.id))
      .limit(1);
    const permitido = puede(actor, 'archivar', {
      esCreador: ficha.creadaPor === actor.usuarioId,
      esBorradorSinEnviar: ficha.estado === 'BORRADOR' && enviada.length === 0,
    });
    if (!permitido) {
      throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador o la supervisora general pueden archivar esta referencia.');
    }
    if (ficha.archivadaEn) throw new ErrorAccion('VALIDACION', 'Esta referencia ya está archivada.');
    const motivo = exigirMotivo(e.motivo, 'Escribe por qué archivas la referencia. Nada se borra: se puede restaurar.');

    await tx
      .update(referencia)
      .set({
        archivadaEn: ahora,
        archivadaPor: actor.usuarioId,
        motivoArchivo: motivo,
        estadoPrevioArchivo: ficha.estado,
        version: ficha.version + 1,
        actualizadaEn: ahora,
      })
      .where(eq(referencia.id, ficha.id));
    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'archivar',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { codigo: ficha.codigo, motivo, estadoPrevio: ficha.estado },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const };
  });
}

/** Desarchivar (solo admin, con motivo): restaura `estado_previo_archivo` y limpia las marcas. */
export async function desarchivar(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  const e = parsear(entradaMotivo, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    // El admin ve todo, incluidas las archivadas.
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    if (!puede(actor, 'desarchivar')) throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador o la supervisora general pueden restaurar una referencia archivada.');
    if (!ficha.archivadaEn) throw new ErrorAccion('VALIDACION', 'Esta referencia no está archivada.');
    const motivo = exigirMotivo(e.motivo, 'Escribe por qué restauras la referencia.');

    const estado = (ficha.estadoPrevioArchivo ?? ficha.estado) as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA';
    await tx
      .update(referencia)
      .set({
        estado,
        archivadaEn: null,
        archivadaPor: null,
        motivoArchivo: null,
        estadoPrevioArchivo: null,
        version: ficha.version + 1,
        actualizadaEn: ahora,
      })
      .where(eq(referencia.id, ficha.id));
    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'desarchivar',
      entidad: 'referencia',
      entidadId: ficha.id,
      detalle: { codigo: ficha.codigo, motivo, estadoRestaurado: estado },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { ok: true as const };
  });
}
