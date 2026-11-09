/**
 * Puerto `Almacen` (12.2): fotos en disco local (`.data/uploads/`) o en Vercel Blob privado. El resto
 * de la aplicacion solo conoce esta interfaz. NO hay borrado: una foto se retira con motivo
 * (`adjunto.retirado_en`), el archivo se conserva (9.7).
 */
export interface ObjetoAlmacenado {
  bytes: Uint8Array;
  mime: string;
}

export interface Almacen {
  readonly nombre: 'local' | 'blob';
  /** Guarda bajo una clave opaca (nombre UUID, nunca el nombre original, 13.5). Nunca sobrescribe. */
  guardar(clave: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** `null` si no existe. */
  leer(clave: string): Promise<ObjetoAlmacenado | null>;
}

/**
 * Las claves son UUID con extension (la miniatura lleva `-m` antes de la extension): evita rutas relativas y
 * nombres controlados por el usuario.
 */
export const CLAVE_VALIDA = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(-m)?\.(jpg|png|webp)$/i;

/** Clave de la miniatura que acompana a una foto (siempre WebP). */
export function claveMiniatura(claveFoto: string): string {
  return claveFoto.replace(/\.(jpg|png|webp)$/i, '-m.webp');
}
