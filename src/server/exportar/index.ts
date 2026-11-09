/**
 * Exportacion de la base a Excel (SPEC 15.1, 12.4 `exportarBase`). Respeta la visibilidad del actor (una agencia
 * exporta solo lo que ve), los filtros de la lista, registra una fila en `auditoria` y entrega el libro en streaming.
 *
 * Dos pasos para que la memoria sea constante: (1) una consulta de ids ordenados (la visibilidad y los filtros se
 * resuelven en SQL), (2) el libro se escribe por lotes de LOTE ids. Despues de `Base` y `Resumen de estado` va la hoja
 * `Historial`: una sola consulta con la MISMA condicion (visibilidad + filtros), con tope de filas (ver `historial.ts`). El formato F-ADI-30 es V1 (15.2): el punto de
 * extension es `escribirLibro`; otro formato seria otro escritor sobre los mismos `filasDeLote`.
 */
import { Writable } from 'node:stream';
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { asignacion, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { TIPOS_PRODUCTO, type TipoProducto } from '@/dominio/campos';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { limitarTasa, REGLAS_TASA } from '../limite-tasa';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import { condicionVisible } from '../politicas/referencias';
import { condicionSinResponsable } from '../politicas/responsable-area';
import { prefijoPartida } from '@/dominio/busqueda';
import { condicionPartida, condicionTexto } from '../acciones/buscar';
import { ErrorAccion } from '../acciones/resultado';
import { filasDeLote, NombresUsuarios } from './filas';
import { cargarHistorial } from './historial';
import { escribirLibro, type ResumenLeyenda } from './libro';

export const LOTE = 200;
/** Una sesion de agencia debe ser reciente para bajar "toda la base" (S-12). */
export const FRESCURA_SESION_EXTERNO_MS = 15 * 60_000;
export const TIPO_CONTENIDO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface FiltrosExportacion {
  estado?: 'todas' | 'amarillas' | 'verdes' | 'archivadas';
  tipo?: TipoProducto;
  q?: string;
  /** «Mis pendientes»: fichas con una asignacion abierta hacia quien descarga. */
  mias?: boolean;
  /** Organizacion de agencia que tiene la ficha en su mano (solo roles internos, igual que el listado). */
  agencia?: string;
  sinResponsable?: boolean;
  /** Prefijo de partida arancelaria, con o sin puntos (L3, igual que el listado). */
  partida?: string;
}

export interface EntradaExportar {
  alcance: 'filtrado' | 'toda';
  incluirArchivadas?: boolean;
  filtros?: FiltrosExportacion;
}

export interface ResultadoExportar {
  nombreArchivo: string;
  filas: number;
  contentType: string;
  flujo: ReadableStream<Uint8Array>;
}

const FORMATO_BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function partesBogota(d: Date): { fecha: string; hora: string } {
  const p = Object.fromEntries(FORMATO_BOGOTA.formatToParts(d).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}${p.month}${p.day}`, hora: `${p.hour}${p.minute}` };
}

/** `descripciones-minimas_AAAAMMDD_HHMM.xlsx` (hora de Bogota; sin tildes ni espacios, SPEC 15.1). */
export function nombreDeArchivo(ahora: Date): string {
  const { fecha, hora } = partesBogota(ahora);
  return `descripciones-minimas_${fecha}_${hora}.xlsx`;
}

function describirFiltros(f: FiltrosExportacion | undefined, incluirArchivadas: boolean): string[] {
  const l: string[] = [];
  if (f?.estado && f.estado !== 'todas') l.push(`Estado: ${f.estado === 'amarillas' ? 'Pendientes' : f.estado === 'verdes' ? 'Clasificadas' : 'Archivadas'}`);
  if (f?.tipo) l.push(`Tipo: ${f.tipo}`);
  if (f?.q) l.push(`Texto: «${f.q}»`);
  if (f?.mias) l.push('Mis pendientes');
  if (f?.agencia) l.push('Con una agencia');
  if (f?.sinResponsable) l.push('Sin responsable');
  if (f?.partida) l.push(`Partida: ${f.partida}`);
  if (incluirArchivadas) l.push('Con archivadas');
  return l;
}

/** Condicion SQL de lo que el actor puede exportar con esos filtros. */
function condiciones(actor: Actor, ahora: Date, e: EntradaExportar): SQL | undefined {
  const partes: Array<SQL | undefined> = [condicionVisible(actor, ahora)];
  const f = e.alcance === 'filtrado' ? (e.filtros ?? {}) : {};
  const soloArchivadas = f.estado === 'archivadas';

  if (soloArchivadas) partes.push(isNotNull(referencia.archivadaEn));
  else if (!e.incluirArchivadas) partes.push(isNull(referencia.archivadaEn));

  if (f.estado === 'amarillas') partes.push(sql`${referencia.estado} <> 'CLASIFICADA'`);
  if (f.estado === 'verdes') partes.push(eq(referencia.estado, 'CLASIFICADA'));
  if (f.tipo && (TIPOS_PRODUCTO as readonly string[]).includes(f.tipo)) partes.push(eq(referencia.tipoProducto, f.tipo));
  const texto = f.q ? condicionTexto(f.q) : undefined;
  if (texto) partes.push(texto);
  const partida = f.partida ? condicionPartida(prefijoPartida(f.partida)) : null;
  if (partida) partes.push(partida);
  const activa = (extra?: SQL) =>
    sql`exists (select 1 from ${asignacion} a ${extra ? sql`join ${usuario} u on u.id = a.a_usuario_id` : sql``}
      where a.referencia_id = ${referencia.id} and a.estado in ('pendiente','en_curso') ${extra ? sql`and ${extra}` : sql``})`;
  if (f.mias) partes.push(activa(sql`a.a_usuario_id = ${actor.usuarioId}`));
  if (f.agencia && actor.organizacionTipo === 'interna') partes.push(activa(sql`u.organizacion_id = ${f.agencia}`));
  // La misma regla que el listado y el Resumen (C1: el area responsable con cuenta cuenta como dueno).
  if (f.sinResponsable) partes.push(condicionSinResponsable());
  return and(...partes);
}

/**
 * Prepara la descarga: valida permiso, limite de uso y reautenticacion, cuenta las filas, deja la auditoria y
 * devuelve el flujo. El libro se escribe mientras el cliente lo descarga.
 */
export async function exportarBase(ctx: Contexto, entrada: EntradaExportar): Promise<ResultadoExportar> {
  const actor = ctx.actor;
  const ahora = ahoraDe(ctx);
  if (!puede(actor, 'descargar_excel')) {
    throw new ErrorAccion('SIN_PERMISO', 'Tu rol no puede descargar la base.');
  }

  // "Toda la base" desde una agencia pide una sesion reciente (S-12, 10.6).
  if (entrada.alcance === 'toda' && actor.organizacionTipo === 'agencia' && actor.sesionCreadaEn) {
    if (ahora.getTime() - actor.sesionCreadaEn.getTime() > FRESCURA_SESION_EXTERNO_MS) {
      throw new ErrorAccion('SIN_PERMISO', 'Por seguridad, confirma que eres tú: entra de nuevo y vuelve a descargar.', {
        reautenticar: true,
      });
    }
  }

  const tasa = await limitarTasa(ctx.db, `exportar:${actor.usuarioId}`, REGLAS_TASA.exportar, ahora);
  if (!tasa.permitido) {
    const min = Math.max(1, Math.ceil(tasa.reintentarEnMs / 60_000));
    throw new ErrorAccion('LIMITE_TASA', `Descargaste varias veces en poco tiempo. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`, {
      reintentarEnMs: tasa.reintentarEnMs,
    });
  }

  const donde = condiciones(actor, ahora, entrada);
  const ids = (
    await ctx.db
      .select({ id: referencia.id })
      .from(referencia)
      .where(donde)
      .orderBy(desc(referencia.creadaEn), desc(referencia.id))
  ).map((r) => r.id);

  const nombreArchivo = nombreDeArchivo(ahora);
  const incluirArchivadas = !!entrada.incluirArchivadas || entrada.filtros?.estado === 'archivadas';
  const filtros = entrada.alcance === 'filtrado' ? describirFiltros(entrada.filtros, !!entrada.incluirArchivadas) : [];

  await auditar(ctx.db, {
    usuarioId: actor.usuarioId,
    accion: 'exportar',
    entidad: 'exportacion',
    entidadId: nombreArchivo,
    detalle: { alcance: entrada.alcance, filas: ids.length, filtros, incluirArchivadas, hojas: ['Base', 'Resumen de estado', 'Historial', 'Leyenda'] },
    ip: ctx.ip,
    creadoEn: ahora,
  });

  const { fecha, hora } = partesBogota(ahora);
  const leyenda: ResumenLeyenda = {
    exportadoPor: nombreSinMarca(actor.nombre),
    rol: actor.rol,
    fecha: `${fecha.slice(0, 4)}-${fecha.slice(4, 6)}-${fecha.slice(6, 8)} ${hora.slice(0, 2)}:${hora.slice(2, 4)}`,
    alcance: entrada.alcance === 'toda' ? 'Toda la base que puedes ver' : 'Lo que se veía en la lista',
    filtros,
    filas: ids.length,
    incluyeArchivadas: incluirArchivadas,
  };

  const nombres = new NombresUsuarios(actor);
  const lotes = async function* () {
    for (let i = 0; i < ids.length; i += LOTE) {
      yield await filasDeLote({ ej: ctx.db as Ejecutor, actor, ahora, nombres }, ids.slice(i, i + LOTE));
    }
  };

  const { salida, flujo, cancelada } = flujoDeDescarga();
  escribirLibro(salida, { lotes, leyenda, historial: () => cargarHistorial({ ej: ctx.db as Ejecutor, actor, nombres }, donde) }).catch((err: unknown) => {
    // Si la persona cerro la descarga, escribir falla a proposito: no es un error del servidor.
    if (cancelada()) return;
    console.error('[exportar] fallo al escribir el libro', err);
    salida.destroy(err instanceof Error ? err : new Error('Fallo al escribir el libro'));
  });

  return { nombreArchivo, filas: ids.length, contentType: TIPO_CONTENIDO_XLSX, flujo };
}

/**
 * Puente entre el escritor del libro (un `Writable` de Node) y la respuesta web, con CONTRAPRESION: el escritor se
 * detiene mientras el cliente no consume, asi la memoria no crece aunque la descarga sea lenta. Si el cliente cancela
 * (cierra la pestana), el escritor se destruye y deja de pedir lotes a la base.
 */
export function flujoDeDescarga(): { salida: Writable; flujo: ReadableStream<Uint8Array>; cancelada: () => boolean } {
  let controlador!: ReadableStreamDefaultController<Uint8Array>;
  let cancelado = false;
  let reanudar: (() => void) | null = null;

  const flujo = new ReadableStream<Uint8Array>(
    {
      start(c) {
        controlador = c;
      },
      pull() {
        const r = reanudar;
        reanudar = null;
        r?.();
      },
      cancel() {
        cancelado = true;
        salida.destroy();
        const r = reanudar;
        reanudar = null;
        r?.();
      },
    },
    new CountQueuingStrategy({ highWaterMark: 4 }),
  );

  const salida = new Writable({
    write(trozo: Buffer, _codificacion, cb) {
      if (cancelado) return cb(new Error('Descarga cancelada'));
      controlador.enqueue(new Uint8Array(trozo));
      if ((controlador.desiredSize ?? 1) <= 0) reanudar = () => cb();
      else cb();
    },
    final(cb) {
      if (!cancelado) controlador.close();
      cb();
    },
    destroy(err, cb) {
      if (err && !cancelado) {
        try {
          controlador.error(err);
        } catch {
          /* ya cerrado */
        }
      }
      cb(err);
    },
  });
  return { salida, flujo, cancelada: () => cancelado };
}

/** Cuantas filas saldrian con y sin los filtros de la lista (para rotular el menu "Descargar Excel"). */
export async function contarExportable(
  ctx: Contexto,
  filtros: FiltrosExportacion | undefined,
  incluirArchivadas = false,
): Promise<{ filtrado: number; toda: number }> {
  const ahora = ahoraDe(ctx);
  const contar = async (e: EntradaExportar) => {
    const [r] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(referencia).where(condiciones(ctx.actor, ahora, e));
    return r?.n ?? 0;
  };
  const [filtrado, toda] = await Promise.all([
    contar({ alcance: 'filtrado', incluirArchivadas, ...(filtros ? { filtros } : {}) }),
    contar({ alcance: 'toda', incluirArchivadas }),
  ]);
  return { filtrado, toda };
}
