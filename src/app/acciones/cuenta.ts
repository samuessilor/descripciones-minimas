'use server';

/** Server Actions de «Mi cuenta»: preferencias y sesiones propias. Cualquier rol, solo sobre lo suyo. */
import { revalidatePath } from 'next/cache';
import { actualizarPreferencias, cerrarOtrasSesiones, cerrarSesionPropia } from '@/server/acciones/cuenta';
import { comoResultado } from '@/server/acciones/resultado';
import { contextoDeAccion } from '@/server/sesion';

export interface EstadoCuenta {
  estado: 'inicial' | 'ok' | 'error';
  mensaje?: string;
  marca?: number;
}

const falla = (mensaje: string): EstadoCuenta => ({ estado: 'error', mensaje, marca: Date.now() });

export async function actualizarPreferenciasAccion(_previo: EstadoCuenta, datos: FormData): Promise<EstadoCuenta> {
  const r = await comoResultado(async () =>
    actualizarPreferencias(await contextoDeAccion(), {
      preferenciaAviso: String(datos.get('preferenciaAviso') ?? 'inmediato'),
      atajosTeclado: datos.get('atajosTeclado') === 'si',
    }),
  );
  if (!r.ok) return falla(r.mensaje);
  revalidatePath('/cuenta');
  return { estado: 'ok', mensaje: 'Guardamos tus preferencias.', marca: Date.now() };
}

export async function cerrarOtrasSesionesAccion(_previo: EstadoCuenta, _datos: FormData): Promise<EstadoCuenta> {
  const r = await comoResultado(async () => cerrarOtrasSesiones(await contextoDeAccion()));
  if (!r.ok) return falla(r.mensaje);
  revalidatePath('/cuenta');
  return {
    estado: 'ok',
    mensaje: r.data.cerradas === 0 ? 'No tienes otras sesiones abiertas.' : `Cerramos ${r.data.cerradas} ${r.data.cerradas === 1 ? 'sesión' : 'sesiones'}. Esta sigue abierta.`,
    marca: Date.now(),
  };
}

export async function cerrarSesionPropiaAccion(_previo: EstadoCuenta, datos: FormData): Promise<EstadoCuenta> {
  const r = await comoResultado(async () => cerrarSesionPropia(await contextoDeAccion(), { sesionId: String(datos.get('sesionId') ?? '') }));
  if (!r.ok) return falla(r.mensaje);
  revalidatePath('/cuenta');
  return { estado: 'ok', mensaje: 'Cerramos esa sesión.', marca: Date.now() };
}
