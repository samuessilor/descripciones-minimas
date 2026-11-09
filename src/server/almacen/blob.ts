/**
 * Almacen en Vercel Blob PRIVADO (13.5). Usa `put`/`get` con `access: 'private'`: nada se sirve por una URL
 * publica; la lectura pasa siempre por `/api/adjuntos/[id]` con sesion y permiso.
 *
 * SIN VERIFICAR contra una tienda real (no hay credenciales en desarrollo): el estado y el precio del modo
 * privado se confirman al instalar (SPEC 13.5, 22.5). Si no sirviera, la interfaz `Almacen` permite otro
 * backend sin tocar el resto.
 */
import { get, put } from '@vercel/blob';
import { CLAVE_VALIDA, type Almacen } from './tipos';

export function crearAlmacenBlob(token: string): Almacen {
  function validar(clave: string): void {
    if (!CLAVE_VALIDA.test(clave)) throw new Error('Clave de archivo no valida.');
  }
  return {
    nombre: 'blob',
    async guardar(clave, bytes, mime) {
      validar(clave);
      await put(`adjuntos/${clave}`, Buffer.from(bytes), {
        access: 'private',
        contentType: mime,
        addRandomSuffix: false,
        allowOverwrite: false,
        token,
      });
    },
    async leer(clave) {
      validar(clave);
      const r = await get(`adjuntos/${clave}`, { access: 'private', token });
      if (!r || r.statusCode !== 200) return null;
      const bytes = new Uint8Array(await new Response(r.stream).arrayBuffer());
      return { bytes, mime: r.blob.contentType };
    },
  };
}
