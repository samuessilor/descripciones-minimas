'use server';

/**
 * Server Actions de administracion (10.4). Capa delgada: cada una autentica de nuevo (`contextoDeAccion`),
 * llama al nucleo (que vuelve a exigir rol `admin`), y devuelve un estado que la interfaz muestra en linea.
 * Los textos que ve el usuario salen de aqui y de los nucleos; nunca un codigo ni una traza.
 */
import { revalidatePath } from 'next/cache';
import { solicitarEnlace } from '@/server/acceso';
import { activarItemCatalogo, guardarItemCatalogo, guardarPartida, guardarRestriccion, moverItemCatalogo } from '@/server/acciones/catalogos-admin';
import { reintentarCorreo } from '@/server/acciones/correo-admin';
import { cambiarEstadoOrganizacion, crearOrganizacion, editarOrganizacion, retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { comoResultado, ErrorAccion } from '@/server/acciones/resultado';
import { cambiarOrganizacion, cambiarRol, desactivarUsuario, invitarUsuario, reactivarUsuario } from '@/server/acciones/usuarios';
import { cerrarSesionesDeUsuario, editarUsuario, marcarCorreoInvalido, reenviarInvitacion } from '@/server/acciones/usuarios-admin';
import { getDepsAcceso } from '@/server/auth-app';
import { programarEnvioInmediato } from '@/server/correo/inmediato';
import type { Contexto } from '@/server/politicas/actor';
import { contextoDeAccion } from '@/server/sesion';

export interface EstadoAdmin {
  estado: 'inicial' | 'ok' | 'error';
  mensaje?: string;
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
    const sesionVencida = (r.detalle as { sesionVencida?: boolean } | undefined)?.sesionVencida;
    return {
      estado: 'error',
      mensaje: r.codigo === 'SIN_PERMISO' && !sesionVencida ? 'No tienes permiso para hacer esto. Pídele acceso a otro administrador.' : r.mensaje,
      ...(pendientes ? { pendientes } : {}),
      marca: Date.now(),
    };
  }
  for (const ruta of rutas) revalidatePath(ruta);
  const { mensaje, irA } = exito(r.data);
  return { estado: 'ok', mensaje, ...(irA ? { irA } : {}), marca: Date.now() };
}

// ---- Usuarios -----------------------------------------------------------------------------------

export async function invitarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const r = await comoResultado(async () => {
    const ctx = await contextoDeAccion();
    const u = await invitarUsuario(ctx, {
      nombre: texto(datos, 'nombre'),
      email: texto(datos, 'email'),
      organizacionId: texto(datos, 'organizacionId'),
      rol: texto(datos, 'rol'),
      area: textoOpcional(datos, 'area'),
    });
    // La invitacion ES el usuario creado + el correo de bienvenida con el enlace de acceso (10.6).
    // El usuario ya esta confirmado en la base: si el envio falla (limite de espera del correo, proveedor caido)
    // NO se responde error -un reintento daria DUPLICADO-, se avisa que falta el correo.
    let correoEnviado = true;
    try {
      await solicitarEnlace(getDepsAcceso(), { email: u.email, ip: ctx.ip ?? null, plantilla: 'bienvenida', invitadoPor: ctx.actor.nombre });
    } catch (e) {
      correoEnviado = false;
      if (!(e instanceof ErrorAccion && e.codigo === 'LIMITE_TASA')) console.error('[admin] no se pudo enviar la invitacion', e);
    }
    return { ...u, correoEnviado };
  });
  if (!r.ok) {
    const problemas = (r.detalle as { problemas?: Problema[] } | undefined)?.problemas;
    if (r.codigo === 'VALIDACION' && problemas?.length) {
      const errores: Record<string, string> = {};
      for (const p of problemas) errores[p.ruta.split('.')[0] ?? 'general'] ??= p.mensaje;
      return { estado: 'error', mensaje: 'Revisa los datos marcados.', errores, marca: Date.now() };
    }
    if (r.codigo === 'DUPLICADO') return { estado: 'error', mensaje: r.mensaje, errores: { email: r.mensaje }, marca: Date.now() };
    return { estado: 'error', mensaje: r.mensaje, marca: Date.now() };
  }
  revalidatePath('/admin/usuarios');
  revalidatePath('/admin');
  const irA = `/admin/usuarios/${r.data.id}`;
  if (!r.data.correoEnviado) {
    return {
      estado: 'ok',
      irA,
      mensaje: `Creamos el usuario de ${r.data.nombre}, pero el correo con su enlace no salió. Reenvíalo desde su ficha o dile que pida su enlace en /entrar con ${r.data.email}.`,
      marca: Date.now(),
    };
  }
  return { estado: 'ok', irA, mensaje: `Invitamos a ${r.data.nombre}. Le llegó un correo con su enlace de acceso.`, marca: Date.now() };
}

export async function reenviarInvitacionAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) =>
      reenviarInvitacion(ctx, { usuarioId: texto(datos, 'usuarioId') }, async (p) => {
        await solicitarEnlace(getDepsAcceso(), { email: p.email, ip: null, plantilla: 'bienvenida', invitadoPor: ctx.actor.nombre });
      }),
    (p) => ({ mensaje: p.sinIngreso ? `Reenviamos la invitación a ${p.nombre}.` : `Enviamos un enlace de acceso nuevo a ${p.nombre}.` }),
    ['/admin/usuarios', '/admin'],
  );
}

export async function editarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => editarUsuario(ctx, { usuarioId: texto(datos, 'usuarioId'), nombre: texto(datos, 'nombre'), area: textoOpcional(datos, 'area') }),
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
    async (ctx) => {
      const r = await cambiarOrganizacion(ctx, {
        usuarioId: texto(datos, 'usuarioId'),
        organizacionId: texto(datos, 'organizacionId'),
        reasignaciones: reasignaciones(datos),
      });
      programarEnvioInmediato(r.correoIds); // los avisos de las reasignaciones ya estan en el outbox
      return r;
    },
    () => ({ mensaje: 'Cambiamos la organización.' }),
    ['/admin/usuarios', '/admin/organizaciones', '/admin'],
  );
}

export async function desactivarUsuarioAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    async (ctx) => {
      const r = await desactivarUsuario(ctx, { usuarioId: texto(datos, 'usuarioId'), reasignaciones: reasignaciones(datos) });
      programarEnvioInmediato(r.correoIds); // los avisos de las reasignaciones ya estan en el outbox
      return r;
    },
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
    () => ({ mensaje: 'Reactivamos al usuario. Puede pedir su enlace en /entrar.' }),
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

export async function marcarCorreoInvalidoAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  const invalido = texto(datos, 'invalido') === 'si';
  return correr(
    (ctx) => marcarCorreoInvalido(ctx, { usuarioId: texto(datos, 'usuarioId'), invalido }),
    () => ({ mensaje: invalido ? 'Marcamos el correo como inválido. No recibirá avisos.' : 'Quitamos la marca. Volverá a recibir avisos.' }),
    ['/admin/usuarios', '/admin', '/admin/correo'],
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

// ---- Correo -------------------------------------------------------------------------------------

export async function reintentarCorreoAccion(_previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> {
  return correr(
    (ctx) => reintentarCorreo(ctx, { entregaId: texto(datos, 'entregaId') }),
    () => ({ mensaje: 'Lo devolvimos a la cola. El despachador lo toma en su próxima vuelta.' }),
    ['/admin/correo', '/admin'],
  );
}
