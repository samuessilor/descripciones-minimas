'use server';

/**
 * Server Actions de administracion (10.4). Capa delgada: cada una autentica de nuevo (`contextoDeAccion`),
 * llama al nucleo (que vuelve a exigir el permiso que corresponde), y devuelve un estado que la interfaz muestra en linea.
 * Los textos que ve el usuario salen de aqui y de los nucleos; nunca un codigo ni una traza.
 */
import { revalidatePath } from 'next/cache';
import { activarItemCatalogo, guardarItemCatalogo, guardarPartida, guardarRestriccion, moverItemCatalogo } from '@/server/acciones/catalogos-admin';
import { cambiarEstadoOrganizacion, crearOrganizacion, editarOrganizacion, retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { comoResultado } from '@/server/acciones/resultado';
import { cambiarOrganizacion, cambiarRol, crearCuenta, desactivarUsuario, reactivarUsuario, restablecerClave } from '@/server/acciones/usuarios';
import { cerrarSesionesDeUsuario, editarUsuario } from '@/server/acciones/usuarios-admin';
import type { Contexto } from '@/server/politicas/actor';
import { contextoDeAccion } from '@/server/sesion';

/** Usuario y contrasena temporal que se muestran UNA vez a quien crea o restablece una cuenta. */
export interface SecretoEntrega {
  id: string;
  nombre: string;
  usuario: string;
  clave: string;
  accion: 'creada' | 'restablecida';
}

export interface EstadoAdmin {
  estado: 'inicial' | 'ok' | 'error';
  mensaje?: string;
  secreto?: SecretoEntrega;
  /** Errores por campo (clave = nombre del campo del formulario). */
  errores?: Record<string, string>;
  /** Todos los mensajes de validacion (un campo puede tener varios). */
  detalles?: string[];
  /** Pendientes que faltan reasignar (ids de referencia), cuando la accion los exige. */
  pendientes?: string[];
  /** Ruta a la que ir tras el exito. */
  irA?: string;
  /** Cambia con cada respuesta, para que la interfaz reaccione aunque el texto sea igual. */
  marca?: number;
}

const texto = (d: FormData, k: string) => String(d.get(k) ?? '');
const textoOpcional = (d: FormData, k: string) => {
  const v = texto(d, k).trim();
  return v === '' ? null : v;
};

/** `reasig:<idReferencia>` = idUsuarioDestino, ignorando los que no se eligieron. */
function reasignaciones(d: FormData): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of d.entries()) {
    if (k.startsWith('reasig:') && typeof v === 'string' && v) r[k.slice('reasig:'.length)] = v;
  }
  return r;
}

type Problema = { ruta: string; mensaje: string };

async function correr<T>(
  fn: (ctx: Contexto) => Promise<T>,
  exito: (data: T) => { mensaje: string; irA?: string },
  rutas: string[],
): Promise<EstadoAdmin> {
  const r = await comoResultado(async () => fn(await contextoDeAccion()));
  if (!r.ok) {
    const problemas = (r.detalle as { problemas?: Problema[] } | undefined)?.problemas;
    const pendientes = (r.detalle as { pendientes?: string[] } | undefined)?.pendientes;
    if (r.codigo === 'VALIDACION' && problemas?.length) {
      const errores: Record<string, string> = {};
      for (const p of problemas) errores[p.ruta.split('.')[0] ?? 'general'] ??= p.mensaje;
      return { estado: 'error', mensaje: 'Revisa los datos marcados.', errores, detalles: [...new Set(problemas.map((p) => p.mensaje))], marca: Date.now() };
    }
    return {
      estado: 'error',
      mensaje: r.mensaje,
      ...(pendientes ? { pendientes } : {}),
      marca: Date.now(),
    };
  }
  for (const ruta of rutas) revalidatePath(ruta);
  const { mensaje, irA } = exito(r.data);
  return { estado: 'ok', mensaje, ...(irA ? { irA } : {}), marca: Date.now() };
}

// ---- Usuarios -----------------------------------------------------------------------------------

export async function crearCuentaAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const r = await comoResultado(async () =>
    crearCuenta(await contextoDeAccion(), {
      nombre: texto(datos, 'nombre'),
      usuario: texto(datos, 'usuario'),
      email: textoOpcional(datos, 'email'),
      organizacionId: texto(datos, 'organizacionId'),
      rol: texto(datos, 'rol'),
      area: textoOpcional(datos, 'area'),
      encargado: textoOpcional(datos, 'encargado'),
    }),
  );
  if (!r.ok) {
    const problemas = (r.detalle as { problemas?: Problema[] } | undefined)?.problemas;
    if (r.codigo === 'VALIDACION' && problemas?.length) {
      const errores: Record<string, string> = {};
      for (const p of problemas) errores[p.ruta.split('.')[0] ?? 'general'] ??= p.mensaje;
      return { estado: 'error', mensaje: 'Revisa los datos marcados.', errores, marca: Date.now() };
    }
    if (r.codigo === 'DUPLICADO') return { estado: 'error', mensaje: r.mensaje, errores: { [r.mensaje.includes('correo') ? 'email' : 'usuario']: r.mensaje }, marca: Date.now() };
    return { estado: 'error', mensaje: r.mensaje, marca: Date.now() };
  }
  revalidatePath('/admin/usuarios');
  revalidatePath('/admin');
  return {
    estado: 'ok',
    mensaje: `Creamos la cuenta de ${r.data.nombre}. Copia el usuario y la contraseña ahora: no se vuelven a mostrar.`,
    secreto: { id: r.data.id, nombre: r.data.nombre, usuario: r.data.usuario, clave: r.data.claveTemporal, accion: 'creada' },
    marca: Date.now(),
  };
}

export async function restablecerClaveAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const usuarioId = texto(datos, 'usuarioId');
  const r = await comoResultado(async () => restablecerClave(await contextoDeAccion(), { usuarioId }));
  if (!r.ok) return { estado: 'error', mensaje: r.mensaje, marca: Date.now() };
  revalidatePath('/admin/usuarios');
  return {
    estado: 'ok',
    mensaje: `Restablecimos la contraseña de ${r.data.nombre}. Cerramos ${r.data.sesionesCerradas} ${r.data.sesionesCerradas === 1 ? 'sesión' : 'sesiones'}.`,
    secreto: { id: usuarioId, nombre: r.data.nombre, usuario: r.data.usuario, clave: r.data.claveTemporal, accion: 'restablecida' },
    marca: Date.now(),
  };
}

export async function editarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => editarUsuario(ctx, { usuarioId: texto(datos, 'usuarioId'), nombre: texto(datos, 'nombre'), area: textoOpcional(datos, 'area'), encargado: textoOpcional(datos, 'encargado') }),
    () => ({ mensaje: 'Guardamos los datos.' }),
    ['/admin/usuarios'],
  );
}

export async function cambiarRolAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => cambiarRol(ctx, { usuarioId: texto(datos, 'usuarioId'), rol: texto(datos, 'rol') }),
    () => ({ mensaje: 'Cambiamos el rol. Rige desde su próxima petición.' }),
    ['/admin/usuarios'],
  );
}

export async function cambiarOrganizacionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) =>
      cambiarOrganizacion(ctx, {
        usuarioId: texto(datos, 'usuarioId'),
        organizacionId: texto(datos, 'organizacionId'),
        reasignaciones: reasignaciones(datos),
      }),
    () => ({ mensaje: 'Cambiamos la organización.' }),
    ['/admin/usuarios', '/admin/organizaciones', '/admin'],
  );
}

export async function desactivarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => desactivarUsuario(ctx, { usuarioId: texto(datos, 'usuarioId'), reasignaciones: reasignaciones(datos) }),
    (r) => ({
      mensaje:
        r.reasignadas > 0
          ? `Desactivamos al usuario, reasignamos ${r.reasignadas} ${r.reasignadas === 1 ? 'referencia' : 'referencias'} y cerramos ${r.sesionesCerradas} ${r.sesionesCerradas === 1 ? 'sesión' : 'sesiones'}.`
          : `Desactivamos al usuario y cerramos ${r.sesionesCerradas} ${r.sesionesCerradas === 1 ? 'sesión' : 'sesiones'}.`,
    }),
    ['/admin/usuarios', '/admin/organizaciones', '/admin'],
  );
}

export async function reactivarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => reactivarUsuario(ctx, { usuarioId: texto(datos, 'usuarioId') }),
    () => ({ mensaje: 'Reactivamos al usuario. Si no recuerda su contraseña, restablécela desde su ficha.' }),
    ['/admin/usuarios', '/admin'],
  );
}

export async function cerrarSesionesUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const sesionId = textoOpcional(datos, 'sesionId');
  return correr(
    (ctx) => cerrarSesionesDeUsuario(ctx, { usuarioId: texto(datos, 'usuarioId'), ...(sesionId ? { sesionId } : {}) }),
    (r) => ({ mensaje: r.cerradas === 0 ? 'No tenía sesiones abiertas.' : `Cerramos ${r.cerradas} ${r.cerradas === 1 ? 'sesión' : 'sesiones'}. Tendrá que volver a entrar.` }),
    ['/admin/usuarios'],
  );
}

// ---- Organizaciones -----------------------------------------------------------------------------

export async function crearOrganizacionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => crearOrganizacion(ctx, { nombre: texto(datos, 'nombre'), tipo: texto(datos, 'tipo') }),
    () => ({ mensaje: 'Creamos la organización.' }),
    ['/admin/organizaciones', '/admin/usuarios', '/admin'],
  );
}

export async function editarOrganizacionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => editarOrganizacion(ctx, { organizacionId: texto(datos, 'organizacionId'), nombre: texto(datos, 'nombre') }),
    () => ({ mensaje: 'Guardamos el nombre.' }),
    ['/admin/organizaciones', '/admin/usuarios'],
  );
}

export async function cambiarEstadoOrganizacionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const activa = texto(datos, 'activa') === 'si';
  return correr(
    (ctx) => cambiarEstadoOrganizacion(ctx, { organizacionId: texto(datos, 'organizacionId'), activa }),
    () => ({ mensaje: activa ? 'Reactivamos la organización.' : 'Desactivamos la organización.' }),
    ['/admin/organizaciones', '/admin/usuarios', '/admin'],
  );
}

export async function retirarAccesoAgenciaAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => retirarAccesoAgencia(ctx, { referenciaId: texto(datos, 'referenciaId'), organizacionId: texto(datos, 'organizacionId') }),
    () => ({ mensaje: 'Retiramos el acceso. La agencia ya no ve esta referencia; lo que escribió sigue en el historial.' }),
    ['/admin/organizaciones', '/admin'],
  );
}

// ---- Catalogos ----------------------------------------------------------------------------------

export async function guardarItemCatalogoAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => guardarItemCatalogo(ctx, { catalogo: texto(datos, 'catalogo'), valor: texto(datos, 'valor') }),
    (r) => ({ mensaje: r.creado ? 'Agregamos el valor al final de la lista.' : 'Ese valor ya estaba en la lista; lo dejamos activo.' }),
    ['/admin/catalogos'],
  );
}

export async function activarItemCatalogoAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const activo = texto(datos, 'activo') === 'si';
  return correr(
    (ctx) => activarItemCatalogo(ctx, { id: texto(datos, 'id'), activo }),
    () => ({ mensaje: activo ? 'Activamos el valor. Ya se ofrece en el formulario.' : 'Desactivamos el valor. Ya no se ofrece, pero se sigue viendo donde se usó.' }),
    ['/admin/catalogos'],
  );
}

export async function moverItemCatalogoAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => moverItemCatalogo(ctx, { id: texto(datos, 'id'), direccion: texto(datos, 'direccion') }),
    () => ({ mensaje: 'Cambiamos el orden.' }),
    ['/admin/catalogos'],
  );
}

export async function guardarRestriccionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const id = textoOpcional(datos, 'id');
  const activa = datos.has('activa') ? texto(datos, 'activa') === 'si' : undefined;
  return correr(
    (ctx) =>
      guardarRestriccion(ctx, {
        ...(id ? { id } : {}),
        codigo: texto(datos, 'codigo'),
        texto: texto(datos, 'texto'),
        ...(activa !== undefined ? { activa } : {}),
      }),
    (r) => ({ mensaje: r.creada ? 'Creamos la restricción.' : 'Guardamos la restricción. Las referencias nuevas usarán este texto.' }),
    ['/admin/catalogos'],
  );
}

export async function guardarPartidaAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const activa = datos.has('activa') ? texto(datos, 'activa') === 'si' : undefined;
  return correr(
    (ctx) =>
      guardarPartida(ctx, {
        modo: texto(datos, 'modo'),
        codigo: texto(datos, 'codigo'),
        descripcion: textoOpcional(datos, 'descripcion'),
        restriccionId: textoOpcional(datos, 'restriccionId'),
        ...(activa !== undefined ? { activa } : {}),
      }),
    (r) => ({ mensaje: `Guardamos la partida ${r.codigo}.` }),
    ['/admin/catalogos'],
  );
}
