/**
 * Acceso por usuario y contrasena (10.6, 13.1) y resolucion del `Actor` desde las cabeceras de la peticion.
 * Es logica del servidor SIN dependencias de Next (recibe `Auth`, `Db` y cabeceras) para poder probarla de punta a
 * punta contra PGlite.
 */
import { and, eq, or } from 'drizzle-orm';
import { organizacion, session, usuario } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { CLAVE_MAX, normalizarUsuario } from '@/dominio/credenciales';
import { siguienteSeguro } from '@/dominio/redireccion';
import type { Auth } from './auth';
import type { Config } from './config';
import { hashearClave } from './claves';
import { consultarTasa, limitarTasa, REGLAS_TASA } from './limite-tasa';
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

// ---- Iniciar sesion ------------------------------------------------------------------------------------

export type ResultadoIniciar =
  | { ok: true; siguiente: string; setCookie: string[] }
  | { ok: false; motivo: 'credenciales' };

/**
 * Entra con usuario y contrasena. El mensaje de error es SIEMPRE el mismo exista o no el usuario (anti-enumeracion):
 * solo se distingue en la auditoria (`login_fallido`). Limites (S-13): por IP (todo intento) y por usuario (solo los
 * FALLOS: 10 por 15 min); quien PIDE paga primero, asi la IP desbordada no gasta el cupo del usuario. Un usuario
 * desconocido tambien paga un hash, para que la latencia no delate si existe.
 */
export async function iniciarSesion(
  d: DepsAcceso,
  p: { usuario: string; clave: string; siguiente?: string | undefined; ip?: string | null; headers: Headers },
): Promise<ResultadoIniciar> {
  // Tope de largo: el identificador forma parte de la clave del limite de intentos y de una consulta.
  const identificador = normalizarUsuario(p.usuario).slice(0, 100);
  const ahora = reloj(d);

  const rechazar = (reintentarEnMs: number): never => {
    const minutos = Math.max(1, Math.ceil(reintentarEnMs / 60_000));
    throw new ErrorAccion('LIMITE_TASA', `Demasiados intentos. Espera ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`, {
      reintentarEnMs,
    });
  };
  // 1) Por IP: cuenta TODO lo que intenta (es el recurso del atacante). Si la IP se pasa, ni se mira al usuario.
  if (p.ip) {
    const r = await limitarTasa(d.db, `acceso-ip:${p.ip}`, REGLAS_TASA.accesoPorIp, ahora);
    if (!r.permitido) rechazar(r.reintentarEnMs);
  }
  // 2) Por usuario: solo cuentan los FALLOS (abajo, en `fallar`); entrar bien no gasta el cupo de una cuenta compartida.
  const claveFallos = `acceso-fallos:${identificador}`;
  const previo = await consultarTasa(d.db, claveFallos, REGLAS_TASA.accesoFallidoPorUsuario, ahora);
  if (!previo.permitido) rechazar(previo.reintentarEnMs);

  const [u] = await d.db
    .select({ id: usuario.id, email: usuario.email, activo: usuario.activo, orgActiva: organizacion.activa })
    .from(usuario)
    .innerJoin(organizacion, eq(organizacion.id, usuario.organizacionId))
    .where(or(eq(usuario.username, identificador), eq(usuario.email, identificador)))
    .limit(1);

  const fallar = async (motivo: string): Promise<ResultadoIniciar> => {
    await limitarTasa(d.db, claveFallos, REGLAS_TASA.accesoFallidoPorUsuario, ahora);
    await auditar(d.db, {
      usuarioId: u?.id ?? null,
      accion: 'login_fallido',
      entidad: 'usuario',
      entidadId: u?.id ?? 'desconocido',
      detalle: { motivo },
      ip: p.ip ?? null,
    });
    return { ok: false, motivo: 'credenciales' };
  };

  if (!u) {
    await hashearClave(p.clave); // mismo costo que una verificacion real
    return fallar('usuario_desconocido');
  }
  if (!u.activo || !u.orgActiva) return fallar('inactivo');
  if (p.clave.length > CLAVE_MAX) return fallar('clave_demasiado_larga');

  try {
    const r = await d.auth.api.signInEmail({
      body: { email: u.email, password: p.clave },
      headers: p.headers,
      returnHeaders: true,
    });
    if (!r.response?.token) return fallar('sin_sesion');
    return { ok: true, siguiente: siguienteSeguro(p.siguiente), setCookie: r.headers.getSetCookie?.() ?? [] };
  } catch {
    return fallar('clave_incorrecta');
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
