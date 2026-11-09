/**
 * Texto legible del VALOR guardado de un campo, para el historial y los avisos (PURO). Es la version
 * "solo lectura" de lo que el formulario edita: nunca devuelve JSON crudo salvo como ultimo recurso.
 */
import { ETIQUETA_TIPO, type CampoDef, type TipoProducto } from './campos';
import { PAIS_NO_SE_CONOCE, nombrePais } from './paises';

const FORMATO_FECHA_LARGA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** `2026-10-21` -> «21 de octubre de 2026» (las fechas del dato son calendario, sin hora ni zona). */
export function fechaLarga(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? FORMATO_FECHA_LARGA.format(new Date(`${iso}T00:00:00Z`)) : iso;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Cantidad con la expresion escrita entre parentesis solo si dice otra cosa («156 (13x12)», pero «25», no «25 (25)»). */
export function textoCantidad(valor: unknown, expresion: string): string {
  const v = String(valor);
  const e = expresion.trim();
  return e === '' || Number(e.replace(',', '.')) === Number(v) ? v : `${v} (${e})`;
}

export function textoDeValor(def: Pick<CampoDef, 'tipoDato'> | null, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return 'Vacío';
  if (typeof valor === 'string') {
    if (valor === PAIS_NO_SE_CONOCE) return 'No se conoce';
    if (def?.tipoDato === 'pais') return nombrePais(valor);
    if (def?.tipoDato === 'valor_unitario') return `${valor.replace('.', ',')} USD`;
    if (def?.tipoDato === 'tipo_producto') return ETIQUETA_TIPO[valor as TipoProducto] ?? valor;
    if (def?.tipoDato === 'fecha') return fechaLarga(valor);
    return valor;
  }
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (esObjeto(valor)) {
    if (valor.sin_marca === true) return 'No tiene marca';
    if (valor.mismo_fabricante === true) return 'El proveedor es el mismo fabricante';
    if (valor.por_confirmar === true) {
      return typeof valor.nota === 'string' && valor.nota ? `Por confirmar (${valor.nota})` : 'Por confirmar';
    }
    // «No aplica» de los campos que lo admiten (y, en el historial anterior a 2026-10-27, de las preguntas retiradas).
    if (valor.no_aplica === true) return 'No aplica';
    if (typeof valor.desde_campo === 'string') return 'Tomado de otro campo de la ficha';
    if (typeof valor.texto === 'string') return valor.texto;
    if (typeof valor.expresion === 'string') return textoCantidad(valor.valor, valor.expresion);
    if (typeof valor.fecha === 'string') return fechaLarga(valor.fecha);
    if (typeof valor.nombre === 'string') {
      return typeof valor.organizacion === 'string' ? `${valor.nombre} (${valor.organizacion})` : valor.nombre;
    }
    if (typeof valor.usuario_id === 'string') return 'Usuario de la plataforma';
  }
  return JSON.stringify(valor);
}
