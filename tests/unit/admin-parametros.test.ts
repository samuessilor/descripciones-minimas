/** Parametros visibles de la administracion (sin secretos). */
import { describe, expect, it } from 'vitest';
import { cargarConfig } from '@/server/config';
import { leerParametros, proveedorDeCorreo } from '@/server/parametros';

describe('parametros visibles', () => {
  const secretos = {
    BETTER_AUTH_SECRET: 'x'.repeat(40) + 'SECRETO-AUTH',
    CRON_SECRET: 'CLAVE-DEL-CRON-12345',
    RESEND_API_KEY: 're_clave_super_secreta',
    SMTP_URL: 'smtp://usuario:CONTRASENA-SMTP@host:587',
    DATABASE_URL: 'postgres://app:CONTRASENA-BD@host/db',
    BLOB_READ_WRITE_TOKEN: 'vercel_blob_token_secreto',
  };

  it('no muestra ninguna llave, clave ni cadena de conexion', () => {
    const c = cargarConfig({ NODE_ENV: 'development', ...secretos, ALMACEN: 'blob' });
    const texto = JSON.stringify(leerParametros(c));
    for (const valor of Object.values(secretos)) expect(texto).not.toContain(valor);
    for (const trozo of ['SECRETO-AUTH', 'CLAVE-DEL-CRON', 're_clave', 'CONTRASENA-SMTP', 'CONTRASENA-BD', 'vercel_blob_token']) expect(texto).not.toContain(trozo);
    expect(texto).toContain('Configurada');
    expect(texto).toContain('Postgres externo');
  });

  it('refleja los valores en uso y dice como se cambian', () => {
    const c = cargarConfig({ NODE_ENV: 'test', CIERRE_MODO: 'bloquear', ENLACE_VIGENCIA_MINUTOS: '45', SESION_ABSOLUTA_HORAS_EXTERNO: '96' });
    const grupos = leerParametros(c);
    const todos = grupos.flatMap((g) => g.parametros);
    expect(todos.find((p) => p.variable === 'CIERRE_MODO')?.valor).toBe('Bloquear');
    expect(todos.find((p) => p.variable === 'ENLACE_VIGENCIA_MINUTOS')?.valor).toBe('45 min');
    expect(todos.find((p) => p.variable === 'SESION_ABSOLUTA_HORAS_EXTERNO')?.valor).toBe('4 días (96 h)');
    expect(grupos.map((g) => g.id)).toEqual(['acceso', 'limites', 'clasificacion', 'correo', 'sistema']);
    expect(todos.find((p) => p.nombre.startsWith('Esperas entre intentos'))?.valor).toBe('5 min · 30 min · 2 h · 12 h · 24 h');
    // Si los avisos por correo estan apagados, la pantalla lo dice.
    expect(todos.find((p) => p.variable === 'AVISOS_POR_CORREO')?.valor).toBe('Apagados');
    const conCorreo = leerParametros(cargarConfig({ NODE_ENV: 'test', AVISOS_POR_CORREO: 'true' })).flatMap((g) => g.parametros);
    expect(conCorreo.find((p) => p.variable === 'AVISOS_POR_CORREO')?.valor).toBe('Encendidos');
  });

  it('el proveedor de correo sale de la configuracion', () => {
    expect(proveedorDeCorreo(cargarConfig({ NODE_ENV: 'test', RESEND_API_KEY: 'k' }))).toBe('Resend');
    expect(proveedorDeCorreo(cargarConfig({ NODE_ENV: 'test', SMTP_URL: 'smtp://x' }))).toBe('SMTP');
    expect(proveedorDeCorreo(cargarConfig({ NODE_ENV: 'test' }))).toMatch(/Consola/);
  });
});
