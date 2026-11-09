import { describe, expect, it } from 'vitest';
import { cargarConfig } from '@/server/config';

const SECRETO = 'a'.repeat(40);

describe('configuracion con zod (12.2)', () => {
  it('en pruebas funciona sin ninguna variable y trae los valores por defecto del SPEC', () => {
    const c = cargarConfig({ NODE_ENV: 'test' });
    expect(c).toMatchObject({
      APP_URL: 'http://localhost:3000',
      PGLITE_DIR: '.data/pglite',
      ALMACEN: 'local',
      RECORDATORIO_MANUAL_MAX_DIA: 1,
      SESION_INACTIVIDAD_HORAS_INTERNO: 8,
      SESION_INACTIVIDAD_HORAS_EXTERNO: 8,
      SESION_ABSOLUTA_HORAS_INTERNO: 168,
      SESION_ABSOLUTA_HORAS_EXTERNO: 72,
      ENLACE_VIGENCIA_MINUTOS: 30,
      CIERRE_MODO: 'advertir',
      ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR: 30,
      CORREO_INCLUIR_REFERENCIA: false,
    });
    expect(c.DATABASE_URL).toBeUndefined();
  });

  it('las variables vacias se tratan como ausentes (asi viene .env.example)', () => {
    const c = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: '', RESEND_API_KEY: '', ENLACE_VIGENCIA_MINUTOS: '', CIERRE_MODO: '' });
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.RESEND_API_KEY).toBeUndefined();
    expect(c.ENLACE_VIGENCIA_MINUTOS).toBe(30);
    expect(c.CIERRE_MODO).toBe('advertir');
  });

  it('convierte numeros y booleanos de texto', () => {
    const c = cargarConfig({
      NODE_ENV: 'test',
      ENLACE_VIGENCIA_MINUTOS: '15',
      SESION_ABSOLUTA_HORAS_EXTERNO: '24',
      CORREO_INCLUIR_REFERENCIA: 'true',
      CIERRE_MODO: 'bloquear',
    });
    expect(c.ENLACE_VIGENCIA_MINUTOS).toBe(15);
    expect(c.SESION_ABSOLUTA_HORAS_EXTERNO).toBe(24);
    expect(c.CORREO_INCLUIR_REFERENCIA).toBe(true);
    expect(c.CIERRE_MODO).toBe('bloquear');
  });

  it('falla con un mensaje claro ante valores invalidos', () => {
    expect(() => cargarConfig({ NODE_ENV: 'test', CIERRE_MODO: 'quizas' })).toThrow(/Configuración inválida[\s\S]*CIERRE_MODO/);
    expect(() => cargarConfig({ NODE_ENV: 'test', APP_URL: 'no-es-url' })).toThrow(/APP_URL/);
    expect(() => cargarConfig({ NODE_ENV: 'test', ENLACE_VIGENCIA_MINUTOS: '-3' })).toThrow(/ENLACE_VIGENCIA_MINUTOS/);
  });

  it('exige el secreto de Better Auth fuera de las pruebas y con al menos 32 caracteres', () => {
    expect(() => cargarConfig({ NODE_ENV: 'development' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => cargarConfig({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'corto' })).toThrow(/32 caracteres/);
    expect(cargarConfig({ NODE_ENV: 'development', BETTER_AUTH_SECRET: SECRETO }).BETTER_AUTH_SECRET).toBe(SECRETO);
  });

  it('en produccion exige DATABASE_URL (rol app); CRON_SECRET solo si los avisos salen por correo', () => {
    const base = { NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRETO } as const;
    expect(() => cargarConfig(base)).toThrow(/DATABASE_URL/);
    const conBd = { ...base, DATABASE_URL: 'postgres://app@host/db' } as const;
    expect(() => cargarConfig(conBd)).toThrow(/Vercel Blob/);
    const conFotos = { ...conBd, ALMACEN: 'blob', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_prueba' } as const;
    expect(cargarConfig(conFotos).AVISOS_POR_CORREO).toBe(false);
    expect(() => cargarConfig({ ...conFotos, AVISOS_POR_CORREO: 'true' })).toThrow(/CRON_SECRET/);
    expect(cargarConfig({ ...conFotos, AVISOS_POR_CORREO: 'true', CRON_SECRET: SECRETO }).NODE_ENV).toBe('production');
  });

  it('en Vercel, sin APP_URL usa la direccion del despliegue; con APP_URL manda la que se defina', () => {
    const base = { NODE_ENV: 'test' } as const;
    expect(cargarConfig({ ...base, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'dm.vercel.app', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://dm.vercel.app');
    expect(cargarConfig({ ...base, VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'dm.vercel.app', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://dm-abc.vercel.app');
    expect(cargarConfig({ ...base, APP_URL: 'https://descripciones.empresa.com', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://descripciones.empresa.com');
  });
});
