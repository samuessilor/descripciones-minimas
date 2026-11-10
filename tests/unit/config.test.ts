import { describe, expect, it } from 'vitest';
import { cargarConfig, fotosActivas } from '@/server/config';

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
      CIERRE_MODO: 'advertir',
      ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR: 30,
    });
    expect(c.DATABASE_URL).toBeUndefined();
  });

  it('las variables vacias se tratan como ausentes (asi viene .env.example)', () => {
    const c = cargarConfig({ NODE_ENV: 'test', DATABASE_URL: '', BLOB_READ_WRITE_TOKEN: '', SESION_ABSOLUTA_HORAS_INTERNO: '', CIERRE_MODO: '' });
    expect(c.DATABASE_URL).toBeUndefined();
    expect(c.BLOB_READ_WRITE_TOKEN).toBeUndefined();
    expect(c.SESION_ABSOLUTA_HORAS_INTERNO).toBe(168);
    expect(c.CIERRE_MODO).toBe('advertir');
  });

  it('convierte numeros y booleanos de texto', () => {
    const c = cargarConfig({
      NODE_ENV: 'test',
      SESION_ABSOLUTA_HORAS_EXTERNO: '24',
      AUTO_PREPARAR_BD_DEV: 'false',
      CIERRE_MODO: 'bloquear',
    });
    expect(c.SESION_ABSOLUTA_HORAS_EXTERNO).toBe(24);
    expect(c.AUTO_PREPARAR_BD_DEV).toBe(false);
    expect(c.CIERRE_MODO).toBe('bloquear');
  });

  it('falla con un mensaje claro ante valores invalidos', () => {
    expect(() => cargarConfig({ NODE_ENV: 'test', CIERRE_MODO: 'quizas' })).toThrow(/Configuración inválida[\s\S]*CIERRE_MODO/);
    expect(() => cargarConfig({ NODE_ENV: 'test', APP_URL: 'no-es-url' })).toThrow(/APP_URL/);
    expect(() => cargarConfig({ NODE_ENV: 'test', SESION_ABSOLUTA_HORAS_INTERNO: '-3' })).toThrow(/SESION_ABSOLUTA_HORAS_INTERNO/);
  });

  it('exige el secreto de Better Auth fuera de las pruebas y con al menos 32 caracteres', () => {
    expect(() => cargarConfig({ NODE_ENV: 'development' })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => cargarConfig({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'corto' })).toThrow(/32 caracteres/);
    expect(cargarConfig({ NODE_ENV: 'development', BETTER_AUTH_SECRET: SECRETO }).BETTER_AUTH_SECRET).toBe(SECRETO);
  });

  it('en produccion exige DATABASE_URL y el almacen de fotos en Vercel Blob', () => {
    const base = { NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRETO } as const;
    expect(() => cargarConfig(base)).toThrow(/DATABASE_URL/);
    const conBd = { ...base, DATABASE_URL: 'postgres://app@host/db' } as const;
    expect(() => cargarConfig(conBd)).toThrow(/Vercel Blob/);
    const conFotos = { ...conBd, ALMACEN: 'blob', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_prueba' } as const;
    expect(cargarConfig(conFotos).NODE_ENV).toBe('production');
  });

  it('las fotos estan activas en desarrollo y pruebas; en produccion solo con FOTOS_ACTIVAS=1', () => {
    expect(fotosActivas(cargarConfig({ NODE_ENV: 'test' }))).toBe(true);
    const prod = { NODE_ENV: 'production', BETTER_AUTH_SECRET: SECRETO, DATABASE_URL: 'postgres://app@host/db', ALMACEN: 'blob', BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_prueba' } as const;
    expect(fotosActivas(cargarConfig(prod))).toBe(false);
    expect(fotosActivas(cargarConfig({ ...prod, FOTOS_ACTIVAS: '0' }))).toBe(false);
    expect(fotosActivas(cargarConfig({ ...prod, FOTOS_ACTIVAS: '1' }))).toBe(true);
  });

  it('en Vercel, sin APP_URL usa la direccion del despliegue; con APP_URL manda la que se defina', () => {
    const base = { NODE_ENV: 'test' } as const;
    expect(cargarConfig({ ...base, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'dm.vercel.app', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://dm.vercel.app');
    expect(cargarConfig({ ...base, VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'dm.vercel.app', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://dm-abc.vercel.app');
    expect(cargarConfig({ ...base, APP_URL: 'https://descripciones.empresa.com', VERCEL_URL: 'dm-abc.vercel.app' }).APP_URL).toBe('https://descripciones.empresa.com');
  });
});
