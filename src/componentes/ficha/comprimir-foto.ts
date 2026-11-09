/**
 * Reduce la foto en el navegador antes de subirla (SPEC 10.2, D-19): lado mayor <= 2000 px y, si sigue pasando
 * de ~3,5 MB, baja la calidad. Solo ayuda a respetar el limite de 4 MB del cuerpo de las funciones; el servidor
 * vuelve a validar y reprocesar todo. Si algo falla (formato raro, sin soporte), se envia el original y el
 * servidor decide con un mensaje claro.
 */
const LADO = 2000;
const OBJETIVO_BYTES = 3.5 * 1024 * 1024;

export async function comprimirFoto(original: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(original.type)) return original;
  try {
    const bitmap = await createImageBitmap(original, { imageOrientation: 'from-image' });
    const escala = Math.min(1, LADO / Math.max(bitmap.width, bitmap.height));
    const pequena = escala === 1 && original.size <= OBJETIVO_BYTES;
    if (pequena) {
      bitmap.close();
      return original;
    }
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));
    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return original;
    }
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();
    for (const calidad of [0.86, 0.74, 0.62]) {
      const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', calidad));
      if (blob && (blob.size <= OBJETIVO_BYTES || calidad === 0.62)) {
        const nombre = original.name.replace(/\.[^.]+$/, '') || 'foto';
        return new File([blob], `${nombre}.jpg`, { type: 'image/jpeg' });
      }
    }
    return original;
  } catch {
    return original;
  }
}
