/**
 * Better Auth (13.1, D-22): usuario y contrasena, SIN correo y SIN registro abierto. Las cuentas las crea un
 * administrador (`crearCuenta`) y entrega usuario y contrasena temporal a mano.
 *
 * Configuracion exacta (los valores por defecto del plugin NO cumplen estos requisitos, RV-17):
 *  - `emailAndPassword.disableSignUp: true`; ademas ningun usuario se crea por Better Auth (hook `user.create.before`);
 *  - el identificador con el que se entra es `usuario.username`; `iniciarSesion` (acceso.ts) lo traduce al correo
 *    interno que pide `signInEmail` y aplica el limite de intentos;
 *  - sesion por rol: `databaseHooks.session.create.before` fija el tope absoluto y rechaza a
 *    usuarios inactivos; el limite de inactividad se comprueba en `actorDesdeCabeceras`;
 *  - `cookieCache` desactivado (revocacion inmediata); `nextCookies()` al final de los plugins;
 *  - `advanced.database.generateId: 'uuid'` y `user.modelName`/`fields` hacia `usuario`.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { account, organizacion, session, usuario, verification } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { CLAVE_MAX, CLAVE_MIN } from '@/dominio/credenciales';
import type { TipoOrganizacion } from '@/dominio/permisos';
import { auditar } from './auditoria';
import type { Config } from './config';
import { politicaSesion } from './sesiones';

export interface DepsAuth {
  db: Db;
  config: Config;
}

/** Better Auth entrega `0000:...:0000` cuando no hay IP en la peticion: eso se guarda como nulo. */
function ipUtil(ip: string | null | undefined): string | null {
  if (!ip || /^[0:]+$/.test(ip)) return null;
  return ip;
}

export function crearAuth({ db, config }: DepsAuth) {
  const maxAbsolutaSeg =
    Math.max(config.SESION_ABSOLUTA_HORAS_INTERNO, config.SESION_ABSOLUTA_HORAS_EXTERNO) * 3600;

  return betterAuth({
    appName: 'Descripciones mínimas',
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    database: drizzleAdapter(db as never, {
      provider: 'pg',
      schema: { usuario, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: CLAVE_MIN,
      maxPasswordLength: CLAVE_MAX,
      autoSignIn: false,
      requireEmailVerification: false,
    },
    user: {
      modelName: 'usuario',
      fields: {
        name: 'nombre',
        emailVerified: 'emailVerificado',
        image: 'imagen',
        createdAt: 'creadoEn',
        updatedAt: 'actualizadoEn',
      },
      // Better Auth 1.7 comprueba que toda columna obligatoria de `usuario` sea una que ELLA escribe.
      // Estas tres son obligatorias en nuestro esquema (D-28) y las fija solo un admin al crear la cuenta:
      // se declaran como campos adicionales SIN entrada (`input: false`) para que ningun cliente las envie.
      additionalFields: {
        organizacionId: { type: 'string', required: false, input: false },
        organizacionTipo: { type: 'string', required: false, input: false },
        rol: { type: 'string', required: false, input: false },
      },
    },
    session: {
      modelName: 'session',
      expiresIn: maxAbsolutaSeg,
      // Nunca se desliza la expiracion de Better Auth: el tope absoluto lo fija el hook de creacion.
      updateAge: maxAbsolutaSeg * 2,
      cookieCache: { enabled: false },
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: config.APP_URL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },
    // El limite de intentos vive en nuestra tabla `limite_tasa` y se aplica en `iniciarSesion`.
    rateLimit: { enabled: false },
    databaseHooks: {
      user: {
        // Sin registro abierto: Better Auth jamas crea usuarios; los crea un admin (`crearCuenta`).
        create: { before: async () => false },
      },
      session: {
        create: {
          before: async (nueva) => {
            const [u] = await db
              .select({
                activo: usuario.activo,
                orgActiva: organizacion.activa,
                tipo: usuario.organizacionTipo,
              })
              .from(usuario)
              .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
              .where(eq(usuario.id, nueva.userId))
              .limit(1);
            if (!u || !u.activo || !u.orgActiva) return false; // revocacion: un inactivo no obtiene sesion
            const pol = politicaSesion(u.tipo as TipoOrganizacion, config);
            return { data: { ...nueva, expiresAt: new Date(Date.now() + pol.absolutaMs) } };
          },
          after: async (creada) => {
            await db
              .update(usuario)
              .set({ ultimoIngreso: new Date() })
              .where(eq(usuario.id, creada.userId));
            await auditar(db, {
              usuarioId: creada.userId,
              accion: 'login',
              entidad: 'usuario',
              entidadId: creada.userId,
              ip: ipUtil(creada.ipAddress),
            });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof crearAuth>;
