import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { crearAlmacenLocal } from '@/server/almacen/local';

const dir = mkdtempSync(join(tmpdir(), 'dm-almacen-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('almacen local (12.2, 13.5)', () => {
  const almacen = crearAlmacenLocal(join(dir, 'uploads')); // el directorio no existe aun: se crea
  const clave = '3f1c2e9a-0000-4000-8000-000000000001.jpg';

  it('guarda y lee con el tipo segun la extension', async () => {
    await almacen.guardar(clave, new Uint8Array([1, 2, 3]), 'image/jpeg');
    const leido = await almacen.leer(clave);
    expect(leido?.mime).toBe('image/jpeg');
    expect([...leido!.bytes]).toEqual([1, 2, 3]);
  });

  it('nunca sobrescribe un archivo existente', async () => {
    await expect(almacen.guardar(clave, new Uint8Array([9]), 'image/jpeg')).rejects.toThrow();
    expect([...(await almacen.leer(clave))!.bytes]).toEqual([1, 2, 3]);
  });

  it('devuelve null si no existe', async () => {
    expect(await almacen.leer('3f1c2e9a-0000-4000-8000-000000000002.png')).toBeNull();
  });

  it('rechaza claves que no son UUID con extension de imagen (recorrido de rutas)', async () => {
    for (const mala of ['../secreto.jpg', 'foto.jpg', '..\\x.png', '3f1c2e9a-0000-4000-8000-000000000001.exe', '/etc/passwd']) {
      await expect(almacen.leer(mala), mala).rejects.toThrow();
      await expect(almacen.guardar(mala, new Uint8Array([1]), 'image/png'), mala).rejects.toThrow();
    }
  });
});
