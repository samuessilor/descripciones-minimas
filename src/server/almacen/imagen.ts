/**
 * Validacion y reprocesado de fotos (13.5). El tipo se decide por la FIRMA real del archivo (magic bytes),
 * nunca por la extension ni por el `Content-Type` que declara el cliente. Todo se reprocesa con sharp:
 * `.rotate()` primero (aplica la orientacion EXIF antes de descartarla, RV-23), se reescala a 2000 px como
 * maximo y la salida no conserva EXIF ni GPS. Se genera ademas una miniatura de 360 px.
 */
import sharp from 'sharp';

export const MAX_BYTES_FOTO = 4 * 1024 * 1024;
export const LADO_MAXIMO = 2000;
export const LADO_MINIATURA = 360;

export type TipoImagen = 'jpeg' | 'png' | 'webp';

/** Tipo segun los primeros bytes; `null` si no es JPEG, PNG ni WebP. */
export function detectarTipoImagen(bytes: Uint8Array): TipoImagen | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

export interface ImagenProcesada {
  principal: Buffer;
  miniatura: Buffer;
  /** Tipo de la salida (JPEG se queda JPEG; PNG y WebP salen como WebP). */
  mime: 'image/jpeg' | 'image/webp';
  extension: 'jpg' | 'webp';
  ancho: number;
  alto: number;
}

export class ImagenInvalida extends Error {}

export async function procesarImagen(bytes: Uint8Array, tipo: TipoImagen): Promise<ImagenProcesada> {
  try {
    const base = () =>
      sharp(bytes, { limitInputPixels: 60_000_000, failOn: 'error' })
        .rotate()
        .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: 'inside', withoutEnlargement: true });

    const salidaJpeg = tipo === 'jpeg';
    const { data: principal, info } = salidaJpeg
      ? await base().jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true })
      : await base().webp({ quality: 82 }).toBuffer({ resolveWithObject: true });

    const miniatura = await sharp(principal)
      .resize({ width: LADO_MINIATURA, height: LADO_MINIATURA, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 74 })
      .toBuffer();

    return {
      principal,
      miniatura,
      mime: salidaJpeg ? 'image/jpeg' : 'image/webp',
      extension: salidaJpeg ? 'jpg' : 'webp',
      ancho: info.width,
      alto: info.height,
    };
  } catch (e) {
    throw new ImagenInvalida(e instanceof Error ? e.message : 'imagen no valida');
  }
}
