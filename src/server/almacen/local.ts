/** Almacen local (desarrollo y pruebas): archivos en `UPLOADS_DIR`. Sin credenciales. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CLAVE_VALIDA, type Almacen } from './tipos';

const MIME_POR_EXTENSION: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function crearAlmacenLocal(directorio: string): Almacen {
  const raiz = resolve(/*turbopackIgnore: true*/ directorio);

  function ruta(clave: string): string {
    if (!CLAVE_VALIDA.test(clave)) throw new Error('Clave de archivo no valida.');
    return join(raiz, clave);
  }

  return {
    nombre: 'local',
    async guardar(clave, bytes) {
      const destino = ruta(clave);
      await mkdir(raiz, { recursive: true });
      await writeFile(destino, bytes, { flag: 'wx' }); // 'wx': nunca se sobrescribe un archivo existente
    },
    async leer(clave) {
      try {
        const bytes = await readFile(ruta(clave));
        const ext = clave.split('.').pop()?.toLowerCase() ?? '';
        return { bytes: new Uint8Array(bytes), mime: MIME_POR_EXTENSION[ext] ?? 'application/octet-stream' };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    },
  };
}
