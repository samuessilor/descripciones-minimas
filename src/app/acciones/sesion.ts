'use server';

/**
 * Server Actions del acceso (10.6, 13.1). Capa delgada: la logica vive en `server/acceso.ts` y se prueba sin Next.
 * El mensaje de error es el mismo exista o no el usuario.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { siguienteSeguro } from '@/dominio/redireccion';
import { ipDeCabeceras, iniciarSesion } from '@/server/acceso';
import { ErrorAccion } from '@/server/acciones/resultado';
import { getAuth, getDepsAcceso } from '@/server/auth-app';
import { getActor, registrarCierreDeSesion } from '@/server/sesion';

export interface EstadoFormulario {
  estado: 'inicial' | 'error' | 'limite';
  mensaje?: string;
  /** Cambia con cada respuesta: la interfaz lo usa para reaccionar aunque el texto sea igual. */
  marca?: number;
  /** Lo que se escribio en «Usuario»: React vacia el formulario al terminar la accion y no debe perderse. */
  usuario?: string;
}

export async function iniciarSesionAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const usuario = String(datos.get('usuario') ?? '');
  const clave = String(datos.get('clave') ?? '');
  if (!usuario.trim() || !clave) return { estado: 'error', mensaje: 'Escribe tu usuario y tu contraseña.', marca: Date.now(), usuario };
  const siguiente = siguienteSeguro(datos.get('siguiente'));
  const h = await headers();

  let destino: string;
  try {
    const r = await iniciarSesion(getDepsAcceso(), { usuario, clave, siguiente, ip: ipDeCabeceras(h), headers: h });
    if (!r.ok) return { estado: 'error', mensaje: 'Usuario o contraseña incorrectos.', marca: Date.now(), usuario };
    destino = r.siguiente; // las cookies de sesion ya las dejo el plugin nextCookies()
  } catch (e) {
    if (e instanceof ErrorAccion && e.codigo === 'LIMITE_TASA') return { estado: 'limite', mensaje: e.message, marca: Date.now(), usuario };
    console.error('[acceso] no se pudo iniciar sesion', e);
    return { estado: 'error', mensaje: 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.', marca: Date.now(), usuario };
  }
  redirect(destino);
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
