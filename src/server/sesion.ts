/**
 * `getActor()` ligado a la peticion de Next (13.2). `proxy.ts` solo comprueba que haya cookie;
 * la autorizacion real es esta funcion, que relee `usuario.activo` y aplica la politica de sesion.
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { actorDesdeCabeceras, ipDeCabeceras } from './acceso';
import { ErrorAccion } from './acciones/resultado';
import type { Actor, Contexto } from './politicas/actor';
import { getDepsAcceso } from './auth-app';

/**
 * Memoizada por peticion (`cache` de React): layout, layout anidado y pagina comparten una sola verificacion de
 * sesion en vez de repetirla. Solo dura un render, asi que la revocacion sigue siendo inmediata. En Server Actions y
 * Route Handlers no memoiza (y `contextoDeAccion` no pasa por aqui).
 */
export const getActor = cache(async (): Promise<Actor | null> => actorDesdeCabeceras(getDepsAcceso(), await headers()));

const MENSAJE_CLAVE_INICIAL = 'Cambia tu contraseña en «Mi cuenta» antes de seguir.';

/**
 * Para paginas y layouts: sin sesion valida => a `/entrar` conservando el destino (F8). Con la contrasena inicial (cuenta
 * recien entregada o restablecida) => a «Mi cuenta», salvo en las paginas que lo declaran (`claveInicial`: solo
 * «Mi cuenta» y «Ayuda»). El control es del servidor y no depende de la ruta ni de cabeceras.
 */
export async function exigirActor(opciones: { claveInicial?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) {
    const h = await headers();
    const ruta = h.get('x-ruta') ?? '/';
    redirect(ruta === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(ruta)}`);
  }
  if (actor.debeCambiarClave && !opciones.claveInicial) redirect('/cuenta');
  return actor;
}

/** Para paginas: contexto {db, actor} ya autenticado (las paginas no importan `@/db`). */
export async function exigirContexto(opciones: { claveInicial?: boolean } = {}): Promise<Contexto> {
  const actor = await exigirActor(opciones);
  const h = await headers();
  return { db: getDb(), actor, ip: ipDeCabeceras(h) };
}

/**
 * Para Server Actions y Route Handlers: sin sesion => error de permiso (el cliente vuelve a /entrar). Con contrasena
 * inicial solo se permite lo que lo declara (`claveInicial`: cambiar la contrasena); lo demas se rechaza aqui.
 */
export async function contextoDeAccion(opciones: { claveInicial?: boolean } = {}): Promise<Contexto> {
  const h = await headers();
  const actor = await actorDesdeCabeceras(getDepsAcceso(), h);
  if (!actor) throw new ErrorAccion('SIN_PERMISO', 'Tu sesión venció. Entra de nuevo.', { sesionVencida: true });
  if (actor.debeCambiarClave && !opciones.claveInicial) throw new ErrorAccion('SIN_PERMISO', MENSAJE_CLAVE_INICIAL);
  return { db: getDb(), actor, ip: ipDeCabeceras(h) };
}

/** Auditoria del cierre de sesion (las paginas y acciones de la interfaz no tocan la base directamente). */
export async function registrarCierreDeSesion(actor: Actor, opciones: { todas: boolean; ip: string | null }): Promise<void> {
  const { auditar } = await import('./auditoria');
  const { revocarSesionesDeUsuario } = await import('./sesiones');
  const db = getDb();
  if (opciones.todas) await revocarSesionesDeUsuario(db, actor.usuarioId);
  await auditar(db, {
    usuarioId: actor.usuarioId,
    accion: 'cerrar_sesion',
    entidad: 'usuario',
    entidadId: actor.usuarioId,
    detalle: opciones.todas ? { todas: true } : {},
    ip: opciones.ip,
  });
}
