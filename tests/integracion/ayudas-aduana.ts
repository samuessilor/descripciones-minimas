/** Ayudas de las pruebas del lado aduana (H4): fichas llenas y enviadas, lectura de libros de Excel. */
import { and, desc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { asignacion, campoHistorial, notificacion, referencia } from '@/db/esquema';
import type { TipoProducto } from '@/dominio/campos';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import type { Actor } from '@/server/politicas/actor';
import { asignarAAduana, nuevaFicha, versionDe, type Escenario } from './ayudas';

/**
 * Los `O` del grupo cliente de un INSUMO (datos inventados). El RIM ya no esta aqui: lo responde la aduana al clasificar
 * (reunion 2026-11); `fichaEnAduana({ llena: true })` lo pone en nombre de Brian.
 */
export const DATOS_INSUMO: Array<[string, unknown]> = [
  // Un area sin cuentas en el escenario: la solicitud de la aduana le llega a quien creo la ficha.
  ['area_responsable', 'Instrumentos'],
  ['descripcion_factura', 'LIMPIADOR DE SUPERFICIES (ejemplo)'],
  ['uso', 'Preparar la superficie antes del recubrimiento (ejemplo).'],
  ['funciones', 'Retira residuos de la superficie (ejemplo).'],
  ['unidad_medida', 'Kilogramos'],
  ['materia_constitutiva', 'Mezcla de alcoholes (ejemplo)'],
  ['aspecto_fisico', 'Líquido'],
  ['marca', { texto: 'MARCA-DEMO' }],
  ['pais_origen', 'FR'],
  ['fabricante', 'Fabricante Demo SA'],
  ['proveedor', 'Proveedor Demo SA'],
  ['reembolsable', 'No'],
  ['tipo_empaque', 'Unidad'],
];

export async function escribir(e: Escenario, actor: Actor, id: string, campo: string, valor: unknown, motivo?: string): Promise<void> {
  await guardarCampo(e.ctx(actor), {
    referenciaId: id,
    campo,
    valor,
    versionEsperada: await versionDe(e.db, id, campo),
    ...(motivo ? { motivo } : {}),
  });
}

export async function llenarComoArea(e: Escenario, id: string, actor: Actor = e.edward): Promise<void> {
  for (const [campo, valor] of DATOS_INSUMO) await escribir(e, actor, id, campo, valor);
}

/** Ficha creada por Edward, enviada a Brian (agencia A). `llena` completa lo del area y Brian responde el RIM (No). */
export async function fichaEnAduana(
  e: Escenario,
  opciones: { llena?: boolean; rim?: 'SI' | 'NO' | false; tipo?: TipoProducto; codigo?: string; nombre?: string } = {},
): Promise<string> {
  const id = await nuevaFicha(e, {
    ...(opciones.tipo ? { tipo: opciones.tipo } : {}),
    ...(opciones.codigo ? { codigo: opciones.codigo } : {}),
    ...(opciones.nombre ? { nombre: opciones.nombre } : {}),
  });
  if (opciones.llena) await llenarComoArea(e, id);
  await asignarAAduana(e, id, e.brian);
  // La aduana responde el RIM: con `llena` queda respondido (No) para poder cerrar; `rim: false` lo deja sin responder.
  const rim = opciones.rim ?? (opciones.llena ? 'NO' : false);
  if (rim) await escribir(e, e.brian, id, 'requiere_rim', rim);
  return id;
}

export async function estadoDe(e: Escenario, id: string) {
  const [f] = await e.db.select().from(referencia).where(eq(referencia.id, id)).limit(1);
  return f!;
}

export async function historialDe(e: Escenario, id: string, campo: string) {
  return e.db
    .select()
    .from(campoHistorial)
    .where(and(eq(campoHistorial.referenciaId, id), eq(campoHistorial.campo, campo)))
    .orderBy(desc(campoHistorial.versionCampo));
}

export async function avisosDe(e: Escenario, usuarioId: string, tipo: string, referenciaId: string) {
  return e.db
    .select()
    .from(notificacion)
    .where(and(eq(notificacion.usuarioId, usuarioId), eq(notificacion.tipo, tipo), eq(notificacion.referenciaId, referenciaId)));
}

export async function asignacionesDe(e: Escenario, referenciaId: string) {
  return e.db.select().from(asignacion).where(eq(asignacion.referenciaId, referenciaId));
}

/** Lee todo un flujo web en un Buffer. */
export async function leerFlujo(flujo: ReadableStream<Uint8Array>): Promise<Buffer> {
  const trozos: Uint8Array[] = [];
  const lector = flujo.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    trozos.push(value);
  }
  return Buffer.concat(trozos);
}

export async function abrirLibro(flujo: ReadableStream<Uint8Array>): Promise<ExcelJS.Workbook> {
  const buf = await leerFlujo(flujo);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buf as unknown as ArrayBuffer);
  return libro;
}
