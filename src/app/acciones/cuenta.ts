'use server';

/** Server Actions de «Mi cuenta»: contraseña, preferencias y sesiones propias. Cualquier rol, solo sobre lo suyo. */
import { revalidatePath } from 'next/cache';
import { actualizarPreferencias, cambiarMiClave, cerrarOtrasSesiones, cerrarSesionPropia } from '@/server/acciones/cuenta';
import { comoResultado } from '@/server/acciones/resultado';
import { contextoDeAccion } from '@/server/sesion';

export interface EstadoCuenta {
  estado: 'inicial' | 'ok' | 'error';
  mensaje?: string;
  /** Errores por campo (clave = nombre del campo del formulario). */
  errores?: Record<string, string>;
  /** Ruta a la que ir tras el exito (tras cambiar la contrasena inicial). */
  irA?: string;
  marca?: number;
}

const falla = (mensaje: string): EstadoCuenta => ({ estado: 'error', mensaje, marca: Date.now() });

export async function actualizarPreferenciasAccion(_previo: EstadoCuenta, datos: FormData): Promise<EstadoCuenta> {
  const r = await comoResultado(async () =>
    actualizarPreferencias(await contextoDeAccion(), {
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

export async function cambiarMiClaveAccion(_previo: EstadoCuenta, datos: FormData): Promise<EstadoCuenta> {
  const r = await comoResultado(async () =>
    cambiarMiClave(await contextoDeAccion({ claveInicial: true }), {
      actual: String(datos.get('actual') ?? ''),
      nueva: String(datos.get('nueva') ?? ''),
      repetir: String(datos.get('repetir') ?? ''),
    }),
  );
  if (!r.ok) {
    const problemas = (r.detalle as { problemas?: Array<{ ruta: string; mensaje: string }> } | undefined)?.problemas;
    if (r.codigo === 'VALIDACION' && problemas?.length) {
      const errores: Record<string, string> = {};
      for (const p of problemas) errores[p.ruta.split('.')[0] ?? 'general'] ??= p.mensaje;
      return { estado: 'error', mensaje: 'Revisa los datos marcados.', errores, marca: Date.now() };
    }
    return falla(r.mensaje);
  }
  revalidatePath('/', 'layout');
  return {
    estado: 'ok',
    mensaje:
      r.data.otrasSesionesCerradas > 0
        ? `Cambiamos tu contraseña y cerramos ${r.data.otrasSesionesCerradas} ${r.data.otrasSesionesCerradas === 1 ? 'otra sesión' : 'otras sesiones'}.`
        : 'Cambiamos tu contraseña.',
    ...(r.data.eraInicial ? { irA: '/' } : {}),
    marca: Date.now(),
  };
}
