/**
 * Preparacion comun de una escritura sobre un campo: bloquea la ficha, comprueba visibilidad,
 * existencia del campo, grupo de escritura y ficha cerrada (12.4 `guardarCampo`, 13.2 puntos 2-4).
 * Compartida por `guardarCampo`, `restaurarCampo`, `resolverConflicto` y `fijarPartida`.
 */
import { and, eq } from 'drizzle-orm';
import { catalogoItem } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { esVisible, getCampo, type CampoDef, type TipoProducto } from '@/dominio/campos';
import { textoSolicitudAduana } from '@/dominio/completitud';
import { fechaBogota } from '@/dominio/dias-gestion';
import { puedeEscribirCampo } from '@/dominio/permisos';
import { estaVacio, normalizarValor } from '@/dominio/valores';
import type { Actor } from '../politicas/actor';
import { cargarReferenciaBloqueada, type FilaReferencia } from '../politicas/referencias';
import { ErrorAccion } from './resultado';

export interface EscrituraPreparada {
  ficha: FilaReferencia;
  campo: string;
  def: CampoDef;
}

const MENSAJES_CERRADA = {
  FICHA_CERRADA: 'Esta referencia está clasificada y no se edita. Puedes solicitar su reapertura.',
  SIN_PERMISO: 'No tienes permiso para editar este campo.',
} as const;

export async function prepararEscritura(
  tx: Tx,
  actor: Actor,
  referenciaId: string,
  campo: string,
  ahora: Date,
): Promise<EscrituraPreparada> {
  const ficha = await cargarReferenciaBloqueada(tx, actor, referenciaId, ahora);

  const def = getCampo(campo);
  if (!def) throw new ErrorAccion('VALIDACION', 'Campo desconocido.');
  if (def.clave === 'codigo') {
    throw new ErrorAccion('VALIDACION', 'El código se corrige con «Corregir código» (con motivo), no como un campo más.');
  }
  if (!def.escribible) throw new ErrorAccion('VALIDACION', `«${def.etiqueta}» no se escribe de esta forma.`);
  const tipo = ficha.tipoProducto as TipoProducto;
  if (def.clave !== 'tipo_producto' && !esVisible(def, tipo)) {
    throw new ErrorAccion('VALIDACION', `«${def.etiqueta}» no aplica a este tipo de producto.`);
  }

  const permiso = puedeEscribirCampo(actor, def, {
    estado: ficha.estado as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA',
    archivada: ficha.archivadaEn !== null,
    creadaPor: ficha.creadaPor,
  });
  if (!permiso.ok) throw new ErrorAccion(permiso.codigo, MENSAJES_CERRADA[permiso.codigo]);

  return { ficha, campo, def };
}

/** Valida y normaliza el valor digitado para un campo (incluidas las reglas que consultan la base). */
export async function normalizarEntradaCampo(
  tx: Tx,
  prep: EscrituraPreparada,
  entrada: unknown,
  ahora: Date,
): Promise<unknown> {
  const d = prep.def;
  const valores: Record<string, unknown> = {};
  for (const [clave, e] of Object.entries(prep.ficha.datos ?? {})) valores[clave] = e.v;
  const r = normalizarValor(d, entrada, { hoy: fechaBogota(ahora), valores });
  if (!r.ok) {
    throw new ErrorAccion('VALIDACION', r.mensaje, r.detalle ? { numero: r.detalle } : undefined);
  }
  const valor = r.valor;
  // Mientras la aduana espere, la respuesta del area no se vacia: se corrige (si no, la parte queda amarilla sin pendiente).
  if (d.clave === 'respuesta_area' && estaVacio(valor) && textoSolicitudAduana(valores) !== '') {
    throw new ErrorAccion('VALIDACION', 'Mientras la aduana espere la respuesta no se puede dejar vacía; si está mal, cámbiala.');
  }
  if (estaVacio(valor)) return null;

  // Listas administrables: solo valores activos del catalogo, o el que ya estaba guardado («No aplica» no es del catalogo).
  if (d.catalogo && typeof valor === 'string') {
    const vigente = prep.ficha.datos?.[d.clave]?.v;
    if (vigente !== valor) {
      const [item] = await tx
        .select({ id: catalogoItem.id })
        .from(catalogoItem)
        .where(and(eq(catalogoItem.catalogo, d.catalogo), eq(catalogoItem.valor, String(valor)), eq(catalogoItem.activo, true)))
        .limit(1);
      if (!item) throw new ErrorAccion('VALIDACION', `Elige «${d.etiqueta}» de la lista.`);
    }
  }

  // La respuesta del area contesta una solicitud de la aduana: sin solicitud no hay nada que responder.
  if (d.clave === 'respuesta_area' && textoSolicitudAduana(valores) === '') {
    throw new ErrorAccion('VALIDACION', 'La aduana no ha pedido información adicional en esta referencia.');
  }

  // Cerrar (finalizada = SI) tiene su propia accion, con las guardas y advertencias del cierre (`finalizar`).
  if (d.clave === 'clasificacion_finalizada' && valor === 'SI') {
    throw new ErrorAccion('VALIDACION', 'Para cerrar la clasificación usa «Clasificación finalizada» en la zona de la aduana.');
  }

  return valor;
}
