/** Parametros visibles de la administracion (sin secretos). */
import { describe, expect, it } from 'vitest';
import { cargarConfig } from '@/server/config';
import { leerParametros } from '@/server/parametros';

describe('parametros visibles', () => {
  const secretos = {
    BETTER_AUTH_SECRET: 'x'.repeat(40) + 'SECRETO-AUTH',
    DATABASE_URL: 'postgres://app:CONTRASENA-BD@host/db',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_token_secreto',
  };

  it('no muestra ninguna llave, clave ni cadena de conexion', () => {
    const c = cargarConfig({ NODE_ENV: 'development', ...secretos, ALMACEN: 'blob' });
    const texto = JSON.stringify(leerParametros(c));
    for (const valor of Object.values(secretos)) expect(texto).not.toContain(valor);
    for (const trozo of ['SECRETO-AUTH', 'CONTRASENA-BD', 'vercel_blob_token']) expect(texto).not.toContain(trozo);
    expect(texto).toContain('Postgres externo');
  });

  it('refleja los valores en uso y dice como se cambian', () => {
    const c = cargarConfig({ NODE_ENV: 'test', CIERRE_MODO: 'bloquear', SESION_ABSOLUTA_HORAS_EXTERNO: '96' });
    const grupos = leerParametros(c);
    const todos = grupos.flatMap((g) => g.parametros);
    expect(todos.find((p) => p.variable === 'CIERRE_MODO')?.valor).toBe('Bloquear');
    expect(todos.find((p) => p.variable === 'SESION_ABSOLUTA_HORAS_EXTERNO')?.valor).toBe('4 días (96 h)');
    expect(grupos.map((g) => g.id)).toEqual(['acceso', 'limites', 'clasificacion', 'sistema']);
    expect(todos.find((p) => p.nombre.startsWith('Intentos de entrada fallidos, por usuario'))?.valor).toBe('10 cada 15 min');
  });
});
