import { getConfig } from '../config';
import { crearAlmacenBlob } from './blob';
import { crearAlmacenLocal } from './local';
import type { Almacen } from './tipos';

export type { Almacen, ObjetoAlmacenado } from './tipos';
export { CLAVE_VALIDA, claveMiniatura } from './tipos';

/** `ALMACEN=local` (por defecto) o `blob` (requiere `BLOB_READ_WRITE_TOKEN`). */
export function getAlmacen(): Almacen {
  const c = getConfig();
  if (c.ALMACEN === 'blob') {
    if (!c.BLOB_READ_WRITE_TOKEN) throw new Error('ALMACEN=blob requiere BLOB_READ_WRITE_TOKEN.');
    return crearAlmacenBlob(c.BLOB_READ_WRITE_TOKEN);
  }
  return crearAlmacenLocal(c.UPLOADS_DIR);
}
