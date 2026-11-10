/**
 * Carga del historico: referencias cerradas ANTES de la plataforma, desde el Excel de la plantilla
 * (`npm run importar:historico`). Dos pasos separados a proposito:
 *
 *  1. `planificarImportacion`: lee y valida TODO sin escribir (prueba en seco). Cada fila pasa por `interpretarFila`, la misma
 *     validacion que la ficha; ademas detecta codigos repetidos en el archivo y los que ya existen en la base.
 *  2. `aplicarImportacion`: escribe en lotes pequenos (una transaccion por lote). Es idempotente: lo que ya existe se omite, nunca
 *     se sobrescribe; si se corta a la mitad, volver a correrla continua donde quedo.
 *
 * No pasa por `aplicarEscritura` fila a fila (50.000 transacciones contra Neon serian lentas y caras), pero deja el MISMO
 * resultado que dejaria crear la ficha y cerrarla: un hecho `fijar` por campo (version 1) en `campo_historial`, la proyeccion
 * `datos`, las columnas promovidas, `texto_busqueda` y el cierre (`clasificacion_finalizada = SI`, estado CLASIFICADA). Sin
 * avisos, asignaciones ni notificaciones: son procesos que ya terminaron. El autor es la cuenta inactiva «Histórico importado».
 */
import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { campoHistorial, catalogoItem, organizacion, partidaArancelaria, referencia, usuario } from '@/db/esquema';
import type { Datos } from '@/db/esquema/nucleo';
import type { Db, Ejecutor } from '@/db/tipos';
import { construirTextoBusqueda } from '@/dominio/busqueda';
import { fechaBogota } from '@/dominio/dias-gestion';
import { CORREO_HISTORICO, instanteDeFecha, NOMBRE_HISTORICO } from '@/dominio/historico-importado';
import { interpretarFila, type FilaInterpretada, type ResultadoFila } from '@/dominio/plantilla-historico';
import { auditar } from '../auditoria';
import type { FilaLeida } from './leer-libro';

export interface PlanImportacion {
  hoy: string;
  /** Filas que se cargarian. */
  validas: FilaInterpretada[];
  rechazadas: Array<{ fila: number; codigo: string | null; errores: string[] }>;
  /** Avisos de filas validas (lo que falta, lo que se ignoro). */
  avisos: Array<{ fila: number; codigo: string; avisos: string[] }>;
  /** Su codigo ya esta en la plataforma: se omiten. */
  yaExisten: Array<{ fila: number; codigo: string }>;
  /** Su codigo se repite en el archivo: se carga la primera, se omiten las demas. */
  repetidas: Array<{ fila: number; codigo: string; primeraEn: number }>;
  /** Partidas que no estan en el catalogo y se daran de alta al cargar. */
  partidasNuevas: string[];
  /**
   * Valores de unidad o aspecto que el catalogo no tiene, con cuantas filas los usan: el administrador agrega los reales de una vez
   * (Administracion > Catalogos) y los errores de digitacion se ven a simple vista.
   */
  valoresDesconocidos: Array<{ catalogo: string; valor: string; filas: number }>;
}

const LOTE_CONSULTA = 500;

async function valoresDeCatalogo(db: Ejecutor, catalogo: 'unidad_medida' | 'aspecto_fisico'): Promise<string[]> {
  const filas = await db
    .select({ valor: catalogoItem.valor })
    .from(catalogoItem)
    .where(and(eq(catalogoItem.catalogo, catalogo), eq(catalogoItem.activo, true)))
    .orderBy(catalogoItem.orden, catalogoItem.valor);
  return filas.map((f) => f.valor);
}

export async function listasDeCatalogos(db: Ejecutor): Promise<{ unidad_medida: string[]; aspecto_fisico: string[] }> {
  return { unidad_medida: await valoresDeCatalogo(db, 'unidad_medida'), aspecto_fisico: await valoresDeCatalogo(db, 'aspecto_fisico') };
}

export async function planificarImportacion(db: Ejecutor, filas: readonly FilaLeida[], ahora: Date = new Date()): Promise<PlanImportacion> {
  const hoy = fechaBogota(ahora);
  const catalogos = await listasDeCatalogos(db);
  const plan: PlanImportacion = { hoy, validas: [], rechazadas: [], avisos: [], yaExisten: [], repetidas: [], partidasNuevas: [], valoresDesconocidos: [] };
  const desconocidos = new Map<string, { catalogo: string; valor: string; filas: number }>();

  const interpretadas: Array<{ leida: FilaLeida; r: ResultadoFila }> = filas.map((leida) => ({
    leida,
    r: interpretarFila(leida.fila, leida.celdas, { hoy, catalogos }),
  }));

  // Codigos ya presentes en la base (por codigo normalizado, el que el indice unico compara).
  const normas = [...new Set(interpretadas.flatMap(({ r }) => (r.ok ? [r.fila.codigoNorm] : [])))];
  const enBase = new Set<string>();
  for (let i = 0; i < normas.length; i += LOTE_CONSULTA) {
    const trozo = normas.slice(i, i + LOTE_CONSULTA);
    const encontradas = await db.select({ n: referencia.codigoNorm }).from(referencia).where(inArray(referencia.codigoNorm, trozo));
    for (const e of encontradas) enBase.add(e.n);
  }

  const primera = new Map<string, number>();
  for (const { r } of interpretadas) {
    if (!r.ok) {
      plan.rechazadas.push({ fila: r.fila, codigo: r.codigo, errores: r.errores });
      for (const d of r.desconocidos) {
        const clave = `${d.catalogo}|${d.valor}`;
        const x = desconocidos.get(clave) ?? { catalogo: d.catalogo, valor: d.valor, filas: 0 };
        x.filas += 1;
        desconocidos.set(clave, x);
      }
      continue;
    }
    const f = r.fila;
    const antes = primera.get(f.codigoNorm);
    if (antes !== undefined) {
      plan.repetidas.push({ fila: f.fila, codigo: f.codigo, primeraEn: antes });
      continue;
    }
    primera.set(f.codigoNorm, f.fila);
    if (enBase.has(f.codigoNorm)) {
      plan.yaExisten.push({ fila: f.fila, codigo: f.codigo });
      continue;
    }
    plan.validas.push(f);
    if (r.avisos.length > 0) plan.avisos.push({ fila: f.fila, codigo: f.codigo, avisos: r.avisos });
  }

  const partidas = [...new Set(plan.validas.flatMap((f) => (f.partida ? [f.partida] : [])))];
  if (partidas.length > 0) {
    const existentes = new Set<string>();
    for (let i = 0; i < partidas.length; i += LOTE_CONSULTA) {
      const trozo = partidas.slice(i, i + LOTE_CONSULTA);
      const filasP = await db.select({ c: partidaArancelaria.codigo }).from(partidaArancelaria).where(inArray(partidaArancelaria.codigo, trozo));
      for (const e of filasP) existentes.add(e.c);
    }
    plan.partidasNuevas = partidas.filter((p) => !existentes.has(p)).sort();
  }
  plan.valoresDesconocidos = [...desconocidos.values()].sort((a, b) => b.filas - a.filas || a.valor.localeCompare(b.valor, 'es'));
  return plan;
}

export interface CuentaHistorico {
  usuarioId: string;
  organizacionId: string;
}

/**
 * La cuenta «Histórico importado» y su organizacion interna inactiva. Se crean la primera vez. No tiene fila en `account`
 * (nunca tuvo contrasena) y esta inactiva: no puede entrar ni recibe nada. Que sea de una organizacion aparte evita que
 * aparezca en las listas para crear cuentas o enviar trabajo.
 */
export async function asegurarCuentaHistorico(db: Db): Promise<CuentaHistorico> {
  // Se busca primero la CUENTA (por su correo, que nadie edita): si alguien renombro su organizacion, no se crea otra.
  const [existente] = await db.select().from(usuario).where(eq(usuario.email, CORREO_HISTORICO)).limit(1);
  if (existente) return { usuarioId: existente.id, organizacionId: existente.organizacionId };
  return db.transaction(async (tx) => {
    let [org] = await tx.select().from(organizacion).where(eq(organizacion.nombre, NOMBRE_HISTORICO)).limit(1);
    if (!org) [org] = await tx.insert(organizacion).values({ nombre: NOMBRE_HISTORICO, tipo: 'interna', activa: false }).returning();
    if (!org) throw new Error('No se pudo crear la organización del histórico.');
    const [u] = await tx
      .insert(usuario)
      .values({ nombre: NOMBRE_HISTORICO, email: CORREO_HISTORICO, organizacionId: org.id, organizacionTipo: 'interna', rol: 'lector', activo: false })
      .returning();
    if (!u) throw new Error('No se pudo crear la cuenta del histórico.');
    return { usuarioId: u.id, organizacionId: org.id };
  });
}

export interface ResultadoImportacion {
  creadas: number;
  partidasCreadas: number;
  omitidas: number;
  /** Su codigo aparecio en la base entre la prueba y la carga (alguien la creo a mano): se saltan, no se sobrescriben. */
  saltadasPorConflicto: number;
}

/** Filas de `referencia` y `campo_historial` de una ficha del historico, tal como las dejaria crearla y cerrarla. */
export function construirFicha(f: FilaInterpretada, h: CuentaHistorico, ahora: Date = new Date()) {
  const id = randomUUID();
  // A mediodia de su dia, pero nunca en el futuro: una referencia cerrada «hoy» cargada por la manana no queda adelantada a los
  // eventos reales que sucedan despues.
  const creadaEn = new Date(Math.min(instanteDeFecha(f.fechaSolicitud).getTime(), ahora.getTime()));
  const cerradaEn = new Date(Math.min(instanteDeFecha(f.fechaClasificacion).getTime(), ahora.getTime()));
  const datos: Datos = {};
  const hechos: Array<typeof campoHistorial.$inferInsert> = [];
  const hecho = (campo: string, valor: unknown, tipoEvento: 'fijar' | 'sistema', cuando: Date) => {
    datos[campo] = { v: valor, n: 1, a: h.usuarioId, o: h.organizacionId, t: cuando.toISOString() };
    hechos.push({
      referenciaId: id,
      campo,
      versionCampo: 1,
      tipoEvento,
      valor,
      autorId: h.usuarioId,
      rol: 'lector',
      organizacionId: h.organizacionId,
      origen: 'sistema',
      creadoEn: cuando,
    });
  };
  for (const [campo, valor] of f.valores) hecho(campo, valor, 'fijar', creadaEn);
  // El cierre. `finalizar` lo escribe como evento `sistema`; aqui va como `fijar` + origen `sistema`, igual que el resto del
  // historico, para que TODO lo importado se reconozca por lo mismo (`esEventoImportado`) y se deje fuera de la hoja Historial.
  // Quien lee los eventos `sistema` de este campo (`fueReabierta`, la marca «Reabierta» del Excel) solo busca reaperturas (`NO`).
  hecho('clasificacion_finalizada', 'SI', 'fijar', cerradaEn);

  const plano = Object.fromEntries(f.valores);
  const nombreProducto = String(plano.nombre_producto);
  const fila: typeof referencia.$inferInsert = {
    id,
    codigo: f.codigo,
    codigoNorm: f.codigoNorm,
    nombreProducto,
    tipoProducto: f.tipo,
    fechaSolicitud: f.fechaSolicitud,
    partida: f.partida,
    estado: 'CLASIFICADA',
    clasificadaEn: cerradaEn,
    clasificadaPor: h.usuarioId,
    diasPausa: 0,
    datos,
    // Como si cada escritura hubiera subido la version de la ficha en uno.
    version: hechos.length + 1,
    textoBusqueda: construirTextoBusqueda({ codigo: f.codigo, nombreProducto, partida: f.partida, valores: plano }),
    creadaPor: h.usuarioId,
    creadaEn,
    actualizadaEn: cerradaEn,
  };
  return { fila, hechos };
}

export async function aplicarImportacion(
  db: Db,
  plan: PlanImportacion,
  opciones: { archivo: string; tamanoLote?: number; ahora?: Date; alAvanzar?: (hechas: number, total: number) => void },
): Promise<ResultadoImportacion> {
  const lote = Math.max(1, opciones.tamanoLote ?? 40);
  const ahora = opciones.ahora ?? new Date();
  const h = await asegurarCuentaHistorico(db);
  let creadas = 0;
  let partidasCreadas = 0;
  let saltadas = 0;

  for (let i = 0; i < plan.validas.length; i += lote) {
    const filasLote = plan.validas.slice(i, i + lote);
    const trozo = filasLote.map((f) => construirFicha(f, h, ahora));
    const partidas = [...new Set(filasLote.flatMap((f) => (f.partida ? [f.partida] : [])))];
    await db.transaction(async (tx) => {
      if (partidas.length > 0) {
        const nuevas = await tx
          .insert(partidaArancelaria)
          .values(partidas.map((codigo) => ({ codigo, origen: 'aduana' as const, creadaPor: h.usuarioId })))
          .onConflictDoNothing()
          .returning({ c: partidaArancelaria.codigo });
        partidasCreadas += nuevas.length;
      }
      // Si alguien creo el mismo codigo a mano entre la prueba y esta carga, esa fila se salta (no se pierde el lote entero).
      const insertadas = await tx
        .insert(referencia)
        .values(trozo.map((t) => t.fila))
        .onConflictDoNothing({ target: referencia.codigoNorm })
        .returning({ id: referencia.id });
      const ids = new Set(insertadas.map((r) => r.id));
      const hechos = trozo.filter((t) => ids.has(t.fila.id as string)).flatMap((t) => t.hechos);
      if (hechos.length > 0) await tx.insert(campoHistorial).values(hechos);
      creadas += insertadas.length;
      saltadas += trozo.length - insertadas.length;
      // Una fila de auditoria por lote, en la MISMA transaccion: si el lote se confirma queda constancia; si se corta, no hay huecos.
      await auditar(tx, {
        usuarioId: h.usuarioId,
        accion: 'importar_historico',
        entidad: 'importacion',
        entidadId: opciones.archivo.slice(0, 200),
        detalle: {
          archivo: opciones.archivo,
          lote: Math.floor(i / lote) + 1,
          desdeFila: filasLote[0]?.fila ?? null,
          hastaFila: filasLote[filasLote.length - 1]?.fila ?? null,
          creadas: insertadas.length,
          saltadasPorConflicto: trozo.length - insertadas.length,
        },
        creadoEn: ahora,
      });
    });
    opciones.alAvanzar?.(Math.min(i + lote, plan.validas.length), plan.validas.length);
  }

  return {
    creadas,
    partidasCreadas,
    omitidas: plan.yaExisten.length + plan.repetidas.length + plan.rechazadas.length,
    saltadasPorConflicto: saltadas,
  };
}
