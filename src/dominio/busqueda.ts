import { normalizarCodigo, normalizarTexto } from './normalizacion';
import { textoDeValor } from './valores';

export interface EntradaBusqueda {
  codigo: string;
  nombreProducto: string;
  partida: string | null;
  /** Valores vigentes por clave de campo. */
  valores: Record<string, unknown>;
}

/**
 * Prefijo de partida para filtrar (L3): solo los digitos, sin puntos, espacios ni guiones, hasta 10.
 * `8421.39` y `842139` dan `842139`; lo que no es una partida (letras) da '' y el filtro se ignora.
 */
export function prefijoPartida(texto: string): string {
  const limpio = texto.replace(/[\s.-]/g, '');
  return /^\d{1,10}$/.test(limpio) ? limpio : '';
}

/**
 * `texto_busqueda` (6.4): codigo, descripcion segun factura (`nombre_producto`), nombre comercial, marca, proveedor, fabricante,
 * partida y maquina de destino, normalizado (minusculas, sin tildes, espacios colapsados). Se
 * agrega ademas el codigo normalizado para que `B3210KIT5` encuentre `B32 10-KIT5`.
 */
export function construirTextoBusqueda(e: EntradaBusqueda): string {
  const v = e.valores;
  return normalizarTexto(
    [
      e.codigo,
      normalizarCodigo(e.codigo),
      e.nombreProducto,
      textoDeValor(v.descripcion_factura),
      textoDeValor(v.marca),
      textoDeValor(v.proveedor),
      textoDeValor(v.fabricante),
      e.partida ?? '',
      textoDeValor(v.maquina_destino),
    ].join(' '),
  );
}
