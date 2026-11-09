/** Fotos (SPEC 13.5): firma real del archivo, reprocesado con sharp (EXIF, rotacion, tamano) y miniatura. */
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { claveMiniatura, CLAVE_VALIDA } from '@/server/almacen/tipos';
import { detectarTipoImagen, ImagenInvalida, LADO_MAXIMO, LADO_MINIATURA, procesarImagen } from '@/server/almacen/imagen';

const color = { r: 30, g: 90, b: 180 };
const base = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: color } });

describe('detectarTipoImagen: por contenido, nunca por extension', () => {
  it('reconoce JPEG, PNG y WebP reales', async () => {
    expect(detectarTipoImagen(await base(10, 10).jpeg().toBuffer())).toBe('jpeg');
    expect(detectarTipoImagen(await base(10, 10).png().toBuffer())).toBe('png');
    expect(detectarTipoImagen(await base(10, 10).webp().toBuffer())).toBe('webp');
  });

  it('rechaza texto, HTML, SVG, PDF, GIF y archivos vacios o truncados', () => {
    const casos: Array<[string, Uint8Array]> = [
      ['texto', new TextEncoder().encode('esto no es una imagen')],
      ['html', new TextEncoder().encode('<html><script>alert(1)</script></html>')],
      ['svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')],
      ['pdf', new TextEncoder().encode('%PDF-1.7')],
      ['gif', new TextEncoder().encode('GIF89a')],
      ['vacio', new Uint8Array()],
      ['firma jpeg truncada', new Uint8Array([0xff, 0xd8])],
      ['riff sin webp', new TextEncoder().encode('RIFF....WAVE')],
    ];
    for (const [nombre, bytes] of casos) expect(detectarTipoImagen(bytes), nombre).toBeNull();
  });
});

describe('procesarImagen', () => {
  it('reduce a 2000 px como maximo y crea una miniatura de 360 px', async () => {
    const grande = await base(4000, 3000).jpeg().toBuffer();
    const r = await procesarImagen(grande, 'jpeg');
    expect(Math.max(r.ancho, r.alto)).toBe(LADO_MAXIMO);
    expect(r.mime).toBe('image/jpeg');
    expect(r.extension).toBe('jpg');
    const m = await sharp(r.miniatura).metadata();
    expect(m.format).toBe('webp');
    expect(Math.max(m.width ?? 0, m.height ?? 0)).toBeLessThanOrEqual(LADO_MINIATURA);
  });

  it('no agranda una foto chica', async () => {
    const r = await procesarImagen(await base(300, 200).png().toBuffer(), 'png');
    expect([r.ancho, r.alto]).toEqual([300, 200]);
  });

  it('PNG y WebP salen como WebP; JPEG sigue siendo JPEG', async () => {
    expect((await procesarImagen(await base(50, 50).png().toBuffer(), 'png')).mime).toBe('image/webp');
    expect((await procesarImagen(await base(50, 50).webp().toBuffer(), 'webp')).mime).toBe('image/webp');
    expect((await procesarImagen(await base(50, 50).jpeg().toBuffer(), 'jpeg')).mime).toBe('image/jpeg');
  });

  it('quita el EXIF (incluido el GPS) y APLICA la orientacion antes de descartarla (RV-23)', async () => {
    // 200x100 con orientacion EXIF 6 (girar 90 grados): una foto de celular de pie.
    const conExif = await base(200, 100).withExif({ IFD0: { Copyright: 'privado' }, IFD3: { GPSLatitudeRef: 'N' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const antes = await sharp(conExif).metadata();
    expect(antes.orientation).toBe(6);
    expect(antes.exif).toBeDefined();

    const r = await procesarImagen(conExif, 'jpeg');
    const despues = await sharp(r.principal).metadata();
    expect(despues.exif).toBeUndefined();
    expect(despues.orientation === undefined || despues.orientation === 1).toBe(true);
    // Girada de verdad: ahora es de pie (alto mayor que ancho).
    expect([despues.width, despues.height]).toEqual([100, 200]);
  });

  it('un archivo con firma de imagen pero contenido roto es ImagenInvalida', async () => {
    const roto = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7]);
    await expect(procesarImagen(roto, 'jpeg')).rejects.toBeInstanceOf(ImagenInvalida);
  });
});

describe('claves del almacen', () => {
  const uuid = '3f1c2e9a-0000-4000-8000-000000000001';
  it('la miniatura es siempre WebP y es una clave valida', () => {
    expect(claveMiniatura(`${uuid}.jpg`)).toBe(`${uuid}-m.webp`);
    expect(claveMiniatura(`${uuid}.png`)).toBe(`${uuid}-m.webp`);
    expect(CLAVE_VALIDA.test(claveMiniatura(`${uuid}.jpg`))).toBe(true);
  });
  it('no acepta rutas ni nombres arbitrarios', () => {
    for (const mala of [`../${uuid}.jpg`, `${uuid}.jpg/../x`, `${uuid}-x.jpg`, `${uuid}.svg`, `${uuid}.JPG.exe`]) {
      expect(CLAVE_VALIDA.test(mala), mala).toBe(false);
    }
  });
});
