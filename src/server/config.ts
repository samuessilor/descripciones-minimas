/**
 * Configuracion validada con zod (12.2, 12.3). La aplicacion falla al arrancar con un mensaje
 * claro si falta algo. Las variables vacias (`FOO=`) se tratan como ausentes.
 *
 * Local sin credenciales: sin DATABASE_URL se usa PGlite; ALMACEN=local guarda las fotos en `.data/uploads/`.
 */
import { z } from 'zod';

const vacioComoAusente = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const texto = () => z.preprocess(vacioComoAusente, z.string().optional());
const entero = (porDefecto: number, minimo = 1) =>
  z.preprocess(vacioComoAusente, z.coerce.number().int().min(minimo).default(porDefecto));
const booleano = (porDefecto: boolean) =>
  z.preprocess(
    (v) => {
      const x = vacioComoAusente(v);
      if (typeof x === 'string') return ['1', 'true', 'si', 'sí', 'yes'].includes(x.trim().toLowerCase());
      return x;
    },
    z.boolean().default(porDefecto),
  );

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_URL: z.preprocess(vacioComoAusente, z.url().default('http://localhost:3000')),
  BETTER_AUTH_SECRET: texto(),

  DATABASE_URL: texto(),
  DATABASE_URL_UNPOOLED: texto(),
  PGLITE_DIR: z.preprocess(vacioComoAusente, z.string().default('.data/pglite')),

  ALMACEN: z.preprocess(vacioComoAusente, z.enum(['local', 'blob']).default('local')),
  BLOB_READ_WRITE_TOKEN: texto(),
  UPLOADS_DIR: z.preprocess(vacioComoAusente, z.string().default('.data/uploads')),

  CONTACTO_ADMIN: z.preprocess(vacioComoAusente, z.string().default('el administrador de la plataforma')),

  RECORDATORIO_MANUAL_MAX_DIA: entero(1),
  SESION_INACTIVIDAD_HORAS_INTERNO: entero(8),
  SESION_INACTIVIDAD_HORAS_EXTERNO: entero(8),
  SESION_ABSOLUTA_HORAS_INTERNO: entero(168),
  SESION_ABSOLUTA_HORAS_EXTERNO: entero(72),
  CIERRE_MODO: z.preprocess(vacioComoAusente, z.enum(['advertir', 'bloquear']).default('advertir')),
  ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR: entero(30),

  /** En desarrollo, el servidor migra y siembra solo al arrancar (PGlite es de un solo proceso, D-30). */
  AUTO_PREPARAR_BD_DEV: booleano(true),
});

export type Config = z.infer<typeof esquema> & { BETTER_AUTH_SECRET: string };

const SECRETO_SOLO_PRUEBAS = 'secreto-solo-para-pruebas-automaticas-0123456789abcdef';

/** En Vercel, si no se define APP_URL se usa la direccion que Vercel ya conoce (produccion o la del despliegue). */
function appUrlDeVercel(env: Record<string, string | undefined>): string | undefined {
  if (env.APP_URL?.trim()) return undefined;
  const host = (env.VERCEL_ENV === 'production' ? env.VERCEL_PROJECT_PRODUCTION_URL : env.VERCEL_URL) || env.VERCEL_URL;
  return host ? `https://${host}` : undefined;
}

export function cargarConfig(env: Record<string, string | undefined> = process.env): Config {
  const deVercel = appUrlDeVercel(env);
  const r = esquema.safeParse(deVercel ? { ...env, APP_URL: deVercel } : env);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida. Revisa .env.local (ver .env.example):\n${detalle}`);
  }
  const c = r.data;
  let secreto = c.BETTER_AUTH_SECRET;
  if (!secreto) {
    if (c.NODE_ENV === 'test') secreto = SECRETO_SOLO_PRUEBAS;
    else {
      throw new Error(
        'Falta BETTER_AUTH_SECRET. En local ejecuta `npm run setup`; en producción defínelo en las variables del entorno.',
      );
    }
  }
  if (secreto.length < 32) {
    throw new Error('BETTER_AUTH_SECRET debe tener al menos 32 caracteres.');
  }
  if (c.NODE_ENV === 'production' && !c.DATABASE_URL) {
    throw new Error('En producción DATABASE_URL es obligatoria (rol app, no dueño; D-31).');
  }
  if (c.NODE_ENV === 'production' && (c.ALMACEN !== 'blob' || !c.BLOB_READ_WRITE_TOKEN)) {
    throw new Error('En producción las fotos van a Vercel Blob: define ALMACEN=blob y BLOB_READ_WRITE_TOKEN (el disco de Vercel es de solo lectura).');
  }
  return { ...c, BETTER_AUTH_SECRET: secreto };
}

let memo: Config | undefined;

/** Configuracion del proceso (se calcula una vez; perezosa para no romper `next build` sin variables). */
export function getConfig(): Config {
  memo ??= cargarConfig();
  return memo;
}

/** Solo para pruebas. */
export function reiniciarConfig(): void {
  memo = undefined;
}

export const esDesarrollo = () => (process.env.NODE_ENV ?? 'development') === 'development';
