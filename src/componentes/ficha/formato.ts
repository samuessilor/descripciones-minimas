/**
 * Conversion entre el VALOR guardado de un campo y lo que se edita / se muestra (cliente y servidor).
 * Funciones puras. El formulario real de H2 reutiliza esto.
 */
import { ETIQUETA_TIPO, type CampoDef, type TipoProducto } from '@/dominio/campos';
import { fechaLarga, textoCantidad } from '@/dominio/mostrar-valor';
import { PAIS_NO_SE_CONOCE, nombrePais } from '@/dominio/paises';
import { formatearPartida } from '@/dominio/partida';

export interface Borrador {
  texto: string;
  sinMarca: boolean;
  porConfirmar: boolean;
  nota: string;
  /** Casilla «No aplica» de los campos que la admiten. */
  noAplica: boolean;
  /** Casilla «El proveedor es el mismo fabricante». */
  mismoFabricante: boolean;
}

export const BORRADOR_VACIO: Borrador = { texto: '', sinMarca: false, porConfirmar: false, nota: '', noAplica: false, mismoFabricante: false };

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function valorABorrador(def: Pick<CampoDef, 'tipoDato'>, valor: unknown): Borrador {
  if (valor === null || valor === undefined) return { ...BORRADOR_VACIO };
  if (esObjeto(valor) && valor.no_aplica === true) return { ...BORRADOR_VACIO, noAplica: true };
  switch (def.tipoDato) {
    case 'proveedor':
      if (esObjeto(valor) && valor.mismo_fabricante === true) return { ...BORRADOR_VACIO, mismoFabricante: true };
      return { ...BORRADOR_VACIO, texto: typeof valor === 'string' ? valor : '' };
    case 'marca':
      if (esObjeto(valor) && valor.sin_marca === true) return { ...BORRADOR_VACIO, sinMarca: true };
      return { ...BORRADOR_VACIO, texto: esObjeto(valor) && typeof valor.texto === 'string' ? valor.texto : '' };
    case 'cantidad':
      return { ...BORRADOR_VACIO, texto: esObjeto(valor) && typeof valor.expresion === 'string' ? valor.expresion : '' };
    case 'fecha_fabricacion':
      if (esObjeto(valor) && valor.por_confirmar === true) {
        return { ...BORRADOR_VACIO, porConfirmar: true, nota: typeof valor.nota === 'string' ? valor.nota : '' };
      }
      return { ...BORRADOR_VACIO, texto: esObjeto(valor) && typeof valor.fecha === 'string' ? valor.fecha : '' };
    case 'valor_unitario':
      return { ...BORRADOR_VACIO, texto: typeof valor === 'string' ? valor.replace('.', ',') : '' };
    default:
      return { ...BORRADOR_VACIO, texto: typeof valor === 'string' ? valor : '' };
  }
}

/** Lo que se envia a `guardarCampo`; `null` = vaciar. */
export function borradorAEntrada(def: Pick<CampoDef, 'tipoDato'>, b: Borrador): unknown {
  if (b.noAplica) return { no_aplica: true };
  switch (def.tipoDato) {
    case 'proveedor':
      if (b.mismoFabricante) return { mismo_fabricante: true };
      return b.texto.trim() === '' ? null : b.texto;
    case 'marca':
      if (b.sinMarca) return { sin_marca: true };
      return b.texto.trim() === '' ? null : { texto: b.texto };
    case 'fecha_fabricacion':
      if (b.porConfirmar) return { por_confirmar: true, nota: b.nota };
      return b.texto === '' ? null : { fecha: b.texto };
    case 'partida':
      return b.texto.trim() === '' ? null : formatearPartida(b.texto) || b.texto;
    default:
      return b.texto.trim() === '' ? null : b.texto;
  }
}

/**
 * «Combinar» en un choque: junta lo que ya guardo la otra persona con lo mio. En un campo de varias lineas va en
 * lineas separadas; en uno de una sola linea el salto se perderia y los textos quedarian pegados, asi que se usa « / ».
 */
export function combinarTextos(def: Pick<CampoDef, 'tipoDato'>, delOtro: string, mio: string): string {
  const separador = def.tipoDato === 'texto_largo' ? '\n' : ' / ';
  return [delOtro, mio].map((t) => t.trim()).filter((t) => t !== '').join(separador);
}

export function borradoresIguales(a: Borrador, b: Borrador): boolean {
  return (
    a.texto === b.texto &&
    a.sinMarca === b.sinMarca &&
    a.porConfirmar === b.porConfirmar &&
    a.nota === b.nota &&
    a.noAplica === b.noAplica &&
    a.mismoFabricante === b.mismoFabricante
  );
}

// La fecha larga vive en dominio para que el historial (servidor) y la ficha formateen igual.
export { fechaLarga };

/** Texto legible de un valor (para mostrarlo en el historial y en campos de solo lectura). */
export function mostrarValor(def: Pick<CampoDef, 'tipoDato'> | null, valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '(vacío)';
  if (typeof valor === 'string') {
    if (valor === PAIS_NO_SE_CONOCE) return 'No se conoce';
    if (def?.tipoDato === 'pais') return nombrePais(valor);
    if (def?.tipoDato === 'valor_unitario') return `${valor.replace('.', ',')} USD`;
    if (def?.tipoDato === 'fecha') return fechaLarga(valor);
    if (def?.tipoDato === 'tipo_producto') return ETIQUETA_TIPO[valor as TipoProducto] ?? valor;
    return valor;
  }
  if (esObjeto(valor)) {
    if (valor.sin_marca === true) return 'No tiene marca';
    if (valor.no_aplica === true) return 'No aplica';
    if (valor.mismo_fabricante === true) return 'El proveedor es el mismo fabricante';
    if (valor.por_confirmar === true) {
      return typeof valor.nota === 'string' && valor.nota ? `Por confirmar (${valor.nota})` : 'Por confirmar';
    }
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

export function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(d);
}
