'use server';

/**
 * Server Actions del acceso (10.6, 13.1). Capa delgada: la logica vive en `server/acceso.ts` y se
 * prueba sin Next. La respuesta de "pedir enlace" es siempre la misma exista o no el correo.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { siguienteSeguro } from '@/dominio/redireccion';
import { ipDeCabeceras, solicitarEnlace, confirmarEnlace } from '@/server/acceso';
import { ErrorAccion } from '@/server/acciones/resultado';
import { getAuth, getDepsAcceso } from '@/server/auth-app';
import { getConfig } from '@/server/config';
import { getActor, registrarCierreDeSesion } from '@/server/sesion';

export interface EstadoFormulario {
  estado: 'inicial' | 'enviado' | 'error' | 'limite';
  mensaje?: string;
  /** Cambia con cada respuesta: la interfaz lo usa como `key` para reiniciar el contador de reenvio. */
  marca?: number;
  motivo?: 'vencido' | 'usado' | 'invalido';
}

const MENSAJE_ENVIADO =
  'Si ese correo tiene acceso, te enviamos un enlace. Puede tardar un minuto; revisa también el spam.';

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function solicitarEnlaceAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const t0 = Date.now();
  const correo = z.email().safeParse(String(datos.get('email') ?? '').trim());
  if (!correo.success) return { estado: 'error', mensaje: 'Escribe un correo válido.' };
  const siguiente = siguienteSeguro(datos.get('siguiente'));
  const ip = ipDeCabeceras(await headers());

  try {
    await solicitarEnlace(getDepsAcceso(), { email: correo.data, siguiente, ip });
  } catch (e) {
    if (e instanceof ErrorAccion && e.codigo === 'LIMITE_TASA') return { estado: 'limite', mensaje: e.message };
    console.error('[acceso] no se pudo enviar el enlace', e);
    return {
      estado: 'error',
      mensaje: 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.',
    };
  }
  // Tiempo minimo parejo: no revela por latencia si el correo existe (anti-enumeracion).
  const resto = 450 - (Date.now() - t0);
  if (resto > 0) await esperar(resto);
  return { estado: 'enviado', mensaje: MENSAJE_ENVIADO, marca: Date.now() };
}

const MENSAJES_CONFIRMAR: Record<NonNullable<EstadoFormulario['motivo']>, string> = {
  vencido: `Este enlace venció (dura ${'{min}'} minutos).`,
  usado: 'Este enlace ya se usó. Si ya entraste, ve a la referencia; si no, pide uno nuevo.',
  invalido: 'Este enlace no es válido. Pide uno nuevo.',
};

export async function confirmarEnlaceAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const token = String(datos.get('token') ?? '');
  const siguiente = siguienteSeguro(datos.get('siguiente'));
  const r = await confirmarEnlace(getDepsAcceso(), { token, siguiente, headers: await headers() });
  if (!r.ok) {
    const min = String(getConfig().ENLACE_VIGENCIA_MINUTOS);
    return { estado: 'error', motivo: r.motivo, mensaje: MENSAJES_CONFIRMAR[r.motivo].replace('{min}', min) };
  }
  redirect(r.siguiente); // las cookies de sesion ya las dejo el plugin nextCookies()
}

export async function cerrarSesionAccion(): Promise<void> {
  const actor = await getActor();
  const h = await headers();
  try {
    await getAuth().api.signOut({ headers: h });
  } catch {
    /* si la sesion ya no existia, igual se sale */
  }
  if (actor) await registrarCierreDeSesion(actor, { todas: false, ip: ipDeCabeceras(h) });
  redirect('/entrar');
}

/** "Cerrar todas mis sesiones" (13.1). */
export async function cerrarTodasLasSesionesAccion(): Promise<void> {
  const actor = await getActor();
  if (actor) await registrarCierreDeSesion(actor, { todas: true, ip: ipDeCabeceras(await headers()) });
  redirect('/entrar');
}
