/**
 * Hoja `Historial` del Excel (reunion 2026-11: «un registro tangible»): cada cambio de campo de las referencias que
 * entran en la exportacion, con el valor anterior, el nuevo, quien, cuando (hora de Bogota) y el motivo.
 *
 * Costo (plan gratuito de Vercel): UNA sola consulta agrupada para todas las referencias, sin consultas por
 * referencia ni por campo. El valor anterior sale de unir cada fila con la version previa del mismo campo
 * (`version_campo - 1`, por la llave unica), asi que no hay que cargar el historial entero para reconstruirlo. Tope de
 * `TOPE_HISTORIAL` filas (las mas recientes): si hay mas, el libro lo avisa en la hoja y en la leyenda, con el total
 * real (una segunda consulta de conteo, solo cuando hay recorte).
 *
 * Permisos: se aplica la MISMA condicion de visibilidad y de filtros que a la hoja Base (la consulta recibe esa
 * condicion), los autores se enmascaran igual que en la ficha (una agencia ve «Otra agencia») y el motivo se oculta
 * donde la ficha lo oculta (PA-38). Un usuario de agencia recibe ademas el historial LIMITADO: solo los campos de su zona
 * de aduana y hechos por su organizacion (`condicionHistorialVisible`), tambien en el conteo y en el valor anterior.
 */
import { desc, eq, and, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { campoHistorial, referencia } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { CAMPOS, getCampo } from '@/dominio/campos';
import { textoDeValor } from '@/dominio/mostrar-valor';
import { eventoDeHistorialVisible, historialLimitado, motivoVisible } from '@/dominio/permisos';
import type { Actor } from '../politicas/actor';
import { condicionHistorialVisible } from '../politicas/historial-visible';
import { fechaHoraBogota, type NombresUsuarios, type ValorCelda } from './filas';

/**
 * Filas maximas de la hoja Historial. Medido con 5.000 fichas y 120.000 cambios (PGlite, mas lento que Neon): 20.000
 * filas = 20 s y +60 MB; 114.000 filas = 45 s y +190 MB. El costo es casi todo ExcelJS (~30.000 celdas por segundo), asi
 * que sube lineal con las filas. 50.000 cubre la base objetivo (1.500 fichas x ~25 cambios = ~37.000) en ~15 a 25 s y
 * ~120 a 160 MB, muy por debajo de la funcion de Vercel Hobby (300 s, ~2 GB), y acota el tiempo de CPU activa de cada descarga.
 */
export const TOPE_HISTORIAL = 50_000;

export interface FilaHistorial {
  valores: Record<string, ValorCelda>;
}

export interface HistorialExportado {
  filas: FilaHistorial[];
  /** Habia mas cambios que el tope: solo van los mas recientes. */
  recortado: boolean;
  tope: number;
  /** Cuantos cambios hay en total para esas referencias (solo se calcula cuando hay recorte). */
  total?: number;
  /** Historial parcial por rol (agencia): la Leyenda lo dice para que nadie lo tome por el registro completo. */
  limitado?: boolean;
}

const CLAVES_ACTIVAS: ReadonlySet<string> = new Set(CAMPOS.map((c) => c.clave));

/** Nombre legible del campo; los retirados y las claves `dm:` (preguntas antiguas de la aduana) se rotulan como tales. */
export function etiquetaDeCampoHistorial(clave: string): string {
  const def = getCampo(clave);
  if (def && CLAVES_ACTIVAS.has(clave)) return def.etiqueta;
  if (def) return `${def.etiqueta} (campo retirado)`;
  return clave.startsWith('dm:') ? 'Respuesta a una pregunta (retirada)' : clave;
}

const EVENTO: Record<string, string> = {
  fijar: 'Cambio',
  vaciar: 'Se vació',
  restaurar: 'Se restauró',
  sistema: 'Sistema',
};

/**
 * Cambios de campo de las referencias que cumplen `donde` (la condicion de la exportacion: visibilidad + filtros).
 * Una sola consulta; luego un unico lote de nombres de autor (los usuarios son pocos).
 */
export async function cargarHistorial(
  p: { ej: Ejecutor; actor: Actor; nombres: NombresUsuarios },
  donde: SQL | undefined,
  tope: number = TOPE_HISTORIAL,
): Promise<HistorialExportado> {
  const { ej, actor, nombres } = p;
  const previo = alias(campoHistorial, 'previo');

  const filas = await ej
    .select({
      codigo: referencia.codigo,
      nombre: referencia.nombreProducto,
      campo: campoHistorial.campo,
      version: campoHistorial.versionCampo,
      tipoEvento: campoHistorial.tipoEvento,
      valor: campoHistorial.valor,
      hayPrevio: sql<boolean>`${previo.id} is not null`,
      anterior: previo.valor,
      anteriorOrganizacionId: previo.organizacionId,
      motivo: campoHistorial.motivo,
      autorId: campoHistorial.autorId,
      organizacionId: campoHistorial.organizacionId,
      creadoEn: campoHistorial.creadoEn,
    })
    .from(campoHistorial)
    .innerJoin(referencia, eq(referencia.id, campoHistorial.referenciaId))
    .leftJoin(
      previo,
      and(
        eq(previo.referenciaId, campoHistorial.referenciaId),
        eq(previo.campo, campoHistorial.campo),
        eq(previo.versionCampo, sql`${campoHistorial.versionCampo} - 1`),
      ),
    )
    .where(and(donde, condicionHistorialVisible(actor)))
    .orderBy(desc(campoHistorial.creadoEn), desc(campoHistorial.id))
    .limit(tope + 1);

  const recortado = filas.length > tope;
  const lote = recortado ? filas.slice(0, tope) : filas;
  await nombres.cargar(ej, lote.map((f) => f.autorId));

  // Con recorte, el aviso dice de cuantos cambios se muestran los mas recientes: no se recorta en silencio.
  let total: number | undefined;
  if (recortado) {
    const [c] = await ej
      .select({ n: sql<number>`count(*)::int` })
      .from(campoHistorial)
      .innerJoin(referencia, eq(referencia.id, campoHistorial.referenciaId))
      .where(and(donde, condicionHistorialVisible(actor)));
    total = c?.n;
  }

  return {
    recortado,
    tope,
    ...(total !== undefined ? { total } : {}),
    ...(historialLimitado(actor) ? { limitado: true } : {}),
    filas: lote.map((f): FilaHistorial => {
      const def = getCampo(f.campo) ?? null;
      const verMotivo = motivoVisible(actor, { organizacionId: f.organizacionId, organizacionTipo: nombres.tipoOrganizacion(f.autorId) });
      // El valor anterior es de una version que el actor puede no ver (la escribio otra organizacion): no se revela.
      const anteriorVisible = f.hayPrevio && eventoDeHistorialVisible(actor, { campo: f.campo, organizacionId: f.anteriorOrganizacionId ?? f.organizacionId });
      const evento = f.tipoEvento === 'fijar' && f.hayPrevio ? 'Cambio' : f.tipoEvento === 'fijar' ? 'Primer valor' : (EVENTO[f.tipoEvento] ?? f.tipoEvento);
      return {
        valores: {
          codigo: f.codigo,
          nombre: f.nombre,
          campo: etiquetaDeCampoHistorial(f.campo),
          evento,
          anterior: f.hayPrevio ? (anteriorVisible ? textoDeValor(def, f.anterior) : 'No visible para tu rol') : null,
          nuevo: textoDeValor(def, f.valor),
          quien: nombres.nombre(f.autorId),
          cuando: fechaHoraBogota(f.creadoEn),
          motivo: f.motivo ? (verMotivo ? f.motivo : 'Motivo no visible para tu rol') : null,
        },
      };
    }),
  };
}
