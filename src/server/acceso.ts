/**
 * Flujo de acceso por enlace magico (10.6, 13.1) y resolucion del `Actor` desde las cabeceras de
 * la peticion. Es logica del servidor SIN dependencias de Next (recibe `Auth`, `Db`, `Mailer` y
 * cabeceras) para poder probarla de punta a punta contra PGlite.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { session, usuario, verification } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { siguienteSeguro } from '@/dominio/redireccion';
import type { Auth, MetadatosEnlace } from './auth';
import type { Config } from './config';
import { limitarTasa, REGLAS_TASA, type ReglaTasa } from './limite-tasa';
import { auditar } from './auditoria';
import { ErrorAccion } from './acciones/resultado';
import { cargarActorPorId, type Actor } from './politicas/actor';
import { politicaSesion, registrarActividad, revocarSesion } from './sesiones';

export interface DepsAcceso {
  db: Db;
  auth: Auth;
  config: Config;
  ahora?: () => Date;
}

const reloj = (d: DepsAcceso) => (d.ahora ? d.ahora() : new Date());

export function ipDeCabeceras(h: Headers): string | null {
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || null;
  return h.get('x-real-ip');
}

// ---- Solicitar enlace ---------------------------------------------------------------------------------

/**
 * Pide un enlace de acceso. La respuesta es SIEMPRE la misma exista o no el correo (anti-enumeracion,
 * 10.6): solo si el usuario existe y esta activo se genera el token y se envia el correo; en los demas
 * casos se registra `login_fallido` y no pasa nada visible. Los limites de tasa aplican a cualquier
 * correo por igual (5/15 min por correo, 60/15 min por IP; 30 s entre solicitudes). Las solicitudes rechazadas por la
 * IP o por la espera no gastan el cupo del correo (ver el orden de las reglas abajo).
 */
export async function solicitarEnlace(
  d: DepsAcceso,
  p: { email: string; siguiente?: string | undefined; ip?: string | null; plantilla?: 'acceso' | 'bienvenida'; invitadoPor?: string },
): Promise<void> {
  const email = p.email.trim().toLowerCase();
  const ahora = reloj(d);

  // Orden de los limites: quien PIDE paga primero. Una solicitud rechazada por la IP o por la espera NO consume
  // el cupo del correo: si no, un tercero anonimo agotaria el cupo de la victima solo insistiendo (el correo es
  // publico y la entrada es solo por enlace). La IP cuenta siempre (aun rechazada): es el recurso del atacante.
  // Una invitacion (`bienvenida`) la hace un admin y se envia a OTRA persona: no se cobra a la IP del admin.
  const reglas: Array<{ clave: string; regla: ReglaTasa }> = [];
  if (p.ip && p.plantilla !== 'bienvenida') reglas.push({ clave: `enlace-ip:${p.ip}`, regla: REGLAS_TASA.enlacePorIp });
  reglas.push({ clave: `enlace-espera:${email}`, regla: REGLAS_TASA.enlaceEspera });
  reglas.push({ clave: `enlace-correo:${email}`, regla: REGLAS_TASA.enlacePorCorreo });
  for (const { clave, regla } of reglas) {
    const r = await limitarTasa(d.db, clave, regla, ahora);
    if (!r.permitido) {
      const minutos = Math.max(1, Math.ceil(r.reintentarEnMs / 60_000));
      throw new ErrorAccion('LIMITE_TASA', `Hiciste muchas solicitudes. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`, {
        reintentarEnMs: r.reintentarEnMs,
      });
    }
  }

  const [u] = await d.db
    .select({ id: usuario.id, activo: usuario.activo })
    .from(usuario)
    .where(eq(usuario.email, email))
    .limit(1);
  if (!u || !u.activo) {
    await auditar(d.db, {
      usuarioId: u?.id ?? null,
      accion: 'login_fallido',
      entidad: 'usuario',
      entidadId: u?.id ?? 'desconocido',
      detalle: { motivo: u ? 'inactivo' : 'desconocido' },
      ip: p.ip ?? null,
    });
    return; // misma respuesta que si hubiera existido
  }

  const metadata: MetadatosEnlace = {
    siguiente: siguienteSeguro(p.siguiente),
    plantilla: p.plantilla ?? 'acceso',
    ...(p.invitadoPor ? { invitadoPor: p.invitadoPor } : {}),
    ip: p.ip ?? null,
  };
  await d.auth.api.signInMagicLink({
    body: { email, metadata: metadata as Record<string, unknown> },
    headers: new Headers(),
  });
}

// ---- Confirmar enlace ---------------------------------------------------------------------------------

/** Mismo hash que `storeToken: 'hashed'` del plugin (SHA-256, base64url sin relleno). */
function identificadorDeToken(token: string): string {
  return `magic-link:${createHash('sha256').update(token).digest('base64url')}`;
}

export type ResultadoConfirmar =
  | { ok: true; siguiente: string; setCookie: string[] }
  | { ok: false; motivo: 'vencido' | 'usado' | 'invalido' };

/**
 * Confirma el enlace (el POST del boton "Entrar"). Distingue venció / ya se usó para mostrar los
 * textos de 10.6. El token se consume UNA vez, atomicamente, en Better Auth.
 */
export async function confirmarEnlace(
  d: DepsAcceso,
  p: { token: string; siguiente?: string | undefined; headers: Headers },
): Promise<ResultadoConfirmar> {
  const token = p.token.trim();
  if (token.length < 8 || token.length > 256) return { ok: false, motivo: 'invalido' };
  const ahora = reloj(d);

  const [pendiente] = await d.db
    .select({ expiresAt: verification.expiresAt })
    .from(verification)
    .where(eq(verification.identifier, identificadorDeToken(token)))
    .limit(1);
  if (!pendiente) return { ok: false, motivo: 'usado' }; // no existe: ya se uso (o nunca fue valido)
  if (pendiente.expiresAt.getTime() <= ahora.getTime()) return { ok: false, motivo: 'vencido' };

  try {
    const r = await d.auth.api.magicLinkVerify({
      query: { token },
      headers: p.headers,
      returnHeaders: true,
    });
    const setCookie = r.headers.getSetCookie?.() ?? [];
    if (!r.response?.token) return { ok: false, motivo: 'invalido' };
    return { ok: true, siguiente: siguienteSeguro(p.siguiente), setCookie };
  } catch {
    // Redireccion de error de Better Auth: usuario inexistente/inactivo, sesion rechazada, token ya consumido.
    return { ok: false, motivo: 'usado' };
  }
}

// ---- Actor desde la sesion ----------------------------------------------------------------------------

/**
 * Resuelve el `Actor` de la peticion. VUELVE A LEER `usuario.activo` en cada llamada (13.1,
 * revocacion inmediata) y aplica la politica de sesion por rol: limite de inactividad y tope
 * absoluto. `proxy.ts` solo mira que exista la cookie; la autorizacion real es esta.
 */
export async function actorDesdeCabeceras(d: DepsAcceso, headers: Headers): Promise<Actor | null> {
  const ahora = reloj(d);
  const actual = await d.auth.api.getSession({ headers });
  if (!actual) return null;

  const actor = await cargarActorPorId(d.db, actual.user.id);
  if (!actor) return null; // usuario o organizacion desactivados => como sin sesion

  const [s] = await d.db
    .select({ id: session.id, creada: session.createdAt, ultima: session.ultimaActividad, expira: session.expiresAt })
    .from(session)
    .where(and(eq(session.id, actual.session.id), eq(session.userId, actor.usuarioId)))
    .limit(1);
  if (!s) return null;

  const pol = politicaSesion(actor.organizacionTipo, d.config);
  if (ahora.getTime() - s.creada.getTime() > pol.absolutaMs || ahora.getTime() - s.ultima.getTime() > pol.inactividadMs) {
    await revocarSesion(d.db, s.id);
    return null;
  }
  await registrarActividad(d.db, s.id, ahora);
  return { ...actor, sesionId: s.id, sesionCreadaEn: s.creada };
}
