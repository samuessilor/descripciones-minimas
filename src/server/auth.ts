/**
 * Better Auth (13.1, D-22): enlace magico por correo, SIN contrasenas y SIN registro abierto.
 *
 * Configuracion exacta (los valores por defecto del plugin NO cumplen estos requisitos, RV-17):
 *  - `storeToken: 'hashed'` (por defecto es 'plain') y `expiresIn` = ENLACE_VIGENCIA_MINUTOS (por
 *    defecto 300 s);
 *  - `disableSignUp: true`; ademas ningun usuario se crea por Better Auth (hook `user.create.before`);
 *  - `sendMagicLink` NO usa la `url` del plugin (un GET a `/magic-link/verify` consume el token al
 *    primer acceso y un escaner de enlaces lo quemaria): construye `APP_URL/entrar/confirmar?token=...`
 *    y la pagina muestra un boton cuyo POST (Server Action) llama a `auth.api.magicLinkVerify`;
 *  - sesion por rol: `databaseHooks.session.create.before` fija el tope absoluto y rechaza a
 *    usuarios inactivos; el limite de inactividad se comprueba en `actorDesdeCabeceras`;
 *  - `cookieCache` desactivado (revocacion inmediata); `nextCookies()` al final de los plugins;
 *  - `advanced.database.generateId: 'uuid'` y `user.modelName`/`fields` hacia `usuario`.
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { magicLink } from 'better-auth/plugins/magic-link';
import { and, eq, sql } from 'drizzle-orm';
import { account, organizacion, session, usuario, verification } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import type { TipoOrganizacion } from '@/dominio/permisos';
import { siguienteSeguro } from '@/dominio/redireccion';
import { auditar } from './auditoria';
import type { Config } from './config';
import type { Mailer } from './correo/tipos';
import { plantillaBienvenida, plantillaEnlaceAcceso } from './correo/plantillas';
import { politicaSesion } from './sesiones';

export interface DepsAuth {
  db: Db;
  config: Config;
  mailer: Mailer;
}

/** Metadatos que `solicitarEnlace` pasa a `sendMagicLink`. */
export interface MetadatosEnlace {
  siguiente?: string;
  plantilla?: 'acceso' | 'bienvenida';
  invitadoPor?: string;
  ip?: string | null;
}

/** Better Auth entrega `0000:...:0000` cuando no hay IP en la peticion: eso se guarda como nulo. */
function ipUtil(ip: string | null | undefined): string | null {
  if (!ip || /^[0:]+$/.test(ip)) return null;
  return ip;
}

export function crearAuth({ db, config, mailer }: DepsAuth) {
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
      // Estas tres son obligatorias en nuestro esquema (D-28) y las fija solo un admin al invitar:
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
    // El limite de tasa vive en nuestra tabla `limite_tasa` y se aplica en `solicitarEnlace`.
    rateLimit: { enabled: false },
    databaseHooks: {
      user: {
        // Sin registro abierto: Better Auth jamas crea usuarios; los crea un admin (`invitarUsuario`).
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
    plugins: [
      magicLink({
        expiresIn: config.ENLACE_VIGENCIA_MINUTOS * 60,
        storeToken: 'hashed',
        disableSignUp: true,
        sendMagicLink: async ({ email, token, metadata }) => {
          const meta = (metadata ?? {}) as MetadatosEnlace;
          // El plugin llama a esta funcion para CUALQUIER correo: solo se envia a usuarios activos.
          const [u] = await db
            .select({ id: usuario.id, nombre: usuario.nombre, correoInvalido: usuario.correoInvalido })
            .from(usuario)
            .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
            .where(
              and(
                sql`lower(${usuario.email}) = ${email.toLowerCase()}`,
                eq(usuario.activo, true),
                eq(organizacion.activa, true),
              ),
            )
            .limit(1);
          if (!u || u.correoInvalido) {
            await auditar(db, {
              usuarioId: u?.id ?? null,
              accion: 'login_fallido',
              entidad: 'usuario',
              entidadId: u?.id ?? 'desconocido',
              detalle: { motivo: u ? 'correo_invalido' : 'usuario_no_existe_o_inactivo' },
              ip: meta.ip ?? null,
            });
            return;
          }
          const url = new URL('/entrar/confirmar', config.APP_URL);
          url.searchParams.set('token', token);
          const siguiente = siguienteSeguro(meta.siguiente);
          if (siguiente !== '/') url.searchParams.set('siguiente', siguiente);
          const enlace = url.toString();

          const correo =
            meta.plantilla === 'bienvenida'
              ? plantillaBienvenida({
                  nombre: u.nombre,
                  quien: meta.invitadoPor ?? 'Un administrador',
                  enlace,
                  vigenciaMinutos: config.ENLACE_VIGENCIA_MINUTOS,
                  contacto: config.CONTACTO_ADMIN,
                })
              : plantillaEnlaceAcceso({
                  nombre: u.nombre,
                  enlace,
                  vigenciaMinutos: config.ENLACE_VIGENCIA_MINUTOS,
                  contacto: config.CONTACTO_ADMIN,
                });
          await mailer.enviar({ para: email.toLowerCase(), ...correo, enlace });
          // La invitacion ya queda auditada como `invitar` / `reenviar_invitacion` a nombre del admin:
          // registrar aqui `solicitar_enlace` se lo atribuiria al invitado, que no pidio nada.
          if (meta.plantilla === 'bienvenida') return;
          await auditar(db, {
            usuarioId: u.id,
            accion: 'solicitar_enlace',
            entidad: 'usuario',
            entidadId: u.id,
            ip: meta.ip ?? null,
          });
        },
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof crearAuth>;
