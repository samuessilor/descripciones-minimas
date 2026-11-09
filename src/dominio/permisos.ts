/**
 * Permisos (matriz 3.3), reglas de escritura por campo (9.2) y de visibilidad por organizacion
 * y agencia (8.3 regla 10, A5, RV-28, RV-29). Dominio PURO: recibe datos, no consulta la base.
 * La capa de politicas del servidor aplica las mismas reglas en SQL y las pruebas de integracion
 * las cruzan contra estas funciones.
 */
import { CAMPOS, getCampo, type CampoDef } from './campos';
import type { EstadoFicha } from './estado';

export const ROLES = ['admin', 'supervisor', 'solicitante', 'aduana', 'lector'] as const;
export type Rol = (typeof ROLES)[number];

/**
 * Administrador y supervisora general: comparten todo lo operativo de la plataforma. Lo reservado al administrador
 * (seguridad, cuentas y parametros) pasa por `puede(actor, 'administrar')`, no por este helper.
 */
export function esGestor(rol: string): boolean {
  return rol === 'admin' || rol === 'supervisor';
}

export type TipoOrganizacion = 'interna' | 'agencia';

export interface ActorLike {
  usuarioId: string;
  rol: Rol;
  organizacionId: string;
  organizacionTipo: TipoOrganizacion;
}

/** D-28: una organizacion de tipo `agencia` solo admite el rol `aduana`. */
export function validarRolOrganizacion(
  rol: Rol,
  tipo: TipoOrganizacion,
): { ok: true } | { ok: false; mensaje: string } {
  if (tipo === 'agencia' && rol !== 'aduana') {
    return { ok: false, mensaje: 'Los usuarios de una agencia solo pueden tener el rol de aduana.' };
  }
  return { ok: true };
}

export type Accion =
  | 'ver_listado'
  | 'crear_referencia'
  | 'escribir_grupo_cliente'
  | 'escribir_grupo_aduana'
  | 'marcar_clasificada'
  | 'enviar_a'
  | 'recordar'
  | 'reasignar'
  | 'comentar'
  | 'adjuntar_foto'
  | 'reabrir'
  | 'solicitar_reapertura'
  | 'archivar'
  | 'desarchivar'
  | 'corregir_codigo'
  | 'descargar_excel'
  /** Zona /admin compartida: resumen, catalogos, auditoria, organizaciones y usuarios en lectura. */
  | 'supervisar'
  /** Solo el administrador: parametros, claves, roles, cuentas y sesiones. */
  | 'administrar';

export interface ContextoAccion {
  esRemitente?: boolean;
  esCreador?: boolean;
  esBorradorSinEnviar?: boolean;
  estadoFicha?: EstadoFicha;
}

const SOLO: Record<Exclude<Accion, 'recordar' | 'reasignar' | 'archivar' | 'corregir_codigo' | 'adjuntar_foto'>, readonly Rol[]> = {
  ver_listado: ROLES,
  crear_referencia: ['admin', 'supervisor', 'solicitante'],
  escribir_grupo_cliente: ['admin', 'supervisor', 'solicitante'],
  escribir_grupo_aduana: ['admin', 'supervisor', 'aduana'],
  marcar_clasificada: ['admin', 'supervisor', 'aduana'],
  enviar_a: ['admin', 'supervisor', 'solicitante', 'aduana'],
  comentar: ['admin', 'supervisor', 'solicitante', 'aduana'],
  reabrir: ['admin', 'supervisor', 'aduana'],
  solicitar_reapertura: ['admin', 'supervisor', 'solicitante'],
  desarchivar: ['admin', 'supervisor'],
  descargar_excel: ROLES,
  supervisar: ['admin', 'supervisor'],
  administrar: ['admin'],
};

/** Matriz 3.3: que puede cada rol. Las acciones contextuales reciben `ctx`. */
export function puede(actor: Pick<ActorLike, 'rol'>, accion: Accion, ctx: ContextoAccion = {}): boolean {
  const { rol } = actor;
  switch (accion) {
    case 'recordar':
      return esGestor(rol) || rol === 'lector' || ((rol === 'solicitante' || rol === 'aduana') && !!ctx.esRemitente);
    case 'reasignar':
      return esGestor(rol) || ((rol === 'solicitante' || rol === 'aduana') && !!ctx.esRemitente);
    case 'archivar':
      return esGestor(rol) || (rol === 'solicitante' && !!ctx.esCreador && !!ctx.esBorradorSinEnviar);
    case 'corregir_codigo':
      return esGestor(rol) || (rol === 'solicitante' && !!ctx.esCreador && ctx.estadoFicha !== 'CLASIFICADA');
    case 'adjuntar_foto':
      return (esGestor(rol) || rol === 'solicitante') && ctx.estadoFicha !== 'CLASIFICADA';
    default:
      return SOLO[accion].includes(rol);
  }
}

/** Guarda por objetivo: quien no es administrador no crea ni promueve administradores o supervisoras. */
export function puedeAsignarRol(actor: Pick<ActorLike, 'rol'>, rolNuevo: string): boolean {
  return actor.rol === 'admin' || (rolNuevo !== 'admin' && rolNuevo !== 'supervisor');
}

/** Guarda por objetivo: quien no es administrador no toca cuentas de administrador. */
export function puedeTocarCuenta(actor: Pick<ActorLike, 'rol'>, rolCuenta: string): boolean {
  return actor.rol === 'admin' || rolCuenta !== 'admin';
}

export function visibilidadesComentarioPermitidas(rol: Rol): Array<'interno' | 'todos'> {
  if (rol === 'aduana') return ['todos'];
  if (rol === 'lector') return [];
  return ['interno', 'todos'];
}

export function alcanceExcel(rol: Rol): 'todo' | 'visible' {
  return esGestor(rol) || rol === 'solicitante' ? 'todo' : 'visible';
}

// ---- Escritura por campo ---------------------------------------------------------------------

export interface FichaEscritura {
  estado: EstadoFicha;
  archivada: boolean;
  creadaPor: string;
}

export type ResultadoEscritura = { ok: true } | { ok: false; codigo: 'SIN_PERMISO' | 'FICHA_CERRADA' };

/**
 * Quien puede escribir un campo (grupo cliente: solicitante/admin; grupo aduana: aduana/admin),
 * y que una ficha CLASIFICADA o archivada es solo lectura (D-14). Los campos calculados y las
 * fotos tienen su propia via. Una clave que no esta en el catalogo de campos no se escribe.
 */
export function puedeEscribirCampo(
  actor: ActorLike,
  campoOClave: CampoDef | string,
  ficha: FichaEscritura,
): ResultadoEscritura {
  const campo = typeof campoOClave === 'string' ? getCampo(campoOClave) : campoOClave;
  if (!campo || !campo.escribible) return { ok: false, codigo: 'SIN_PERMISO' };

  let permitido: boolean;
  switch (campo.grupo) {
    case 'C':
      permitido = puede(actor, 'escribir_grupo_cliente');
      break;
    case 'A':
      permitido = puede(actor, 'escribir_grupo_aduana');
      break;
    case 'S':
      // Unico campo del sistema editable por personas: la fecha de solicitud (6.3, RV-32).
      permitido =
        campo.clave === 'fecha_solicitud' &&
        (esGestor(actor.rol) ||
          (actor.rol === 'solicitante' && ficha.creadaPor === actor.usuarioId && ficha.estado === 'BORRADOR'));
      break;
  }

  if (!permitido) return { ok: false, codigo: 'SIN_PERMISO' };
  if (ficha.estado === 'CLASIFICADA' || ficha.archivada) return { ok: false, codigo: 'FICHA_CERRADA' };
  return { ok: true };
}

// ---- Visibilidad -----------------------------------------------------------------------------

export type EstadoAsignacion = 'pendiente' | 'en_curso' | 'hecha' | 'reasignada' | 'cancelada';

/** Una asignacion vista desde la organizacion del destinatario. */
export interface AccesoAgencia {
  organizacionId: string;
  estado: EstadoAsignacion;
  accesoHasta: Date | null;
}

/**
 * Visibilidad de una ficha. Los roles internos ven todas (S-02). La `aduana` solo ve fichas con
 * una asignacion ACTIVA hacia alguien de su organizacion, o terminada (`hecha`/`reasignada`) con
 * `acceso_hasta` aun vigente; nunca las archivadas (8.3 regla 10, RV-28).
 */
export function fichaVisiblePara(
  actor: ActorLike,
  ficha: { archivada: boolean },
  accesos: readonly AccesoAgencia[],
  ahora: Date,
): boolean {
  if (actor.rol !== 'aduana') return true;
  if (ficha.archivada) return false;
  return accesos.some((a) => {
    if (a.organizacionId !== actor.organizacionId) return false;
    if (a.estado === 'pendiente' || a.estado === 'en_curso') return true;
    if (a.estado === 'hecha' || a.estado === 'reasignada') {
      return a.accesoHasta !== null && a.accesoHasta.getTime() > ahora.getTime();
    }
    return false;
  });
}

export interface OrigenAutor {
  organizacionId: string;
  organizacionTipo: TipoOrganizacion;
}

/** A5: un usuario de agencia no ve la identidad de usuarios de OTRA agencia. */
export function autorVisible(actor: ActorLike, autor: OrigenAutor): 'nombre' | 'otra_agencia' {
  if (
    actor.organizacionTipo === 'agencia' &&
    autor.organizacionTipo === 'agencia' &&
    autor.organizacionId !== actor.organizacionId
  ) {
    return 'otra_agencia';
  }
  return 'nombre';
}

/** PA-38: el rol aduana no ve el motivo de reemplazos hechos fuera de su organizacion. */
export function motivoVisible(actor: ActorLike, autor: OrigenAutor): boolean {
  return actor.rol !== 'aduana' || autor.organizacionId === actor.organizacionId;
}

/** RV-29: los comentarios `interno` solo los ven usuarios de organizacion interna. */
export function comentarioVisible(actor: ActorLike, visibilidad: 'interno' | 'todos'): boolean {
  return visibilidad === 'todos' || actor.organizacionTipo === 'interna';
}

// ---- Historial limitado de la aduana (cuentas de agencia) -------------------------------------------------

/**
 * Claves de los campos del grupo aduana (los que la agencia escribe). Es lo unico cuyo historial ve un usuario de
 * agencia: el de los campos que llena el area (producto, detalle, especificaciones) nunca le llega. Sale del catalogo,
 * asi que un campo nuevo del grupo A entra solo; uno retirado queda fuera (ante la duda, se oculta).
 */
export const CLAVES_HISTORIAL_ADUANA: readonly string[] = CAMPOS.filter((c) => c.grupo === 'A').map((c) => c.clave);

/** El actor ve el historial recortado (solo su zona de aduana). Admin, solicitante y lector lo ven completo. */
export function historialLimitado(actor: Pick<ActorLike, 'rol'>): boolean {
  return actor.rol === 'aduana';
}

/** Puede consultar el historial de ESTE campo (si no, el servidor responde como si no existiera). */
export function campoConHistorialVisible(actor: Pick<ActorLike, 'rol'>, clave: string): boolean {
  return !historialLimitado(actor) || CLAVES_HISTORIAL_ADUANA.includes(clave);
}

/**
 * Un evento del historial es visible para el actor si el campo es de su zona y el hecho lo hizo su propia organizacion.
 * Lo de otra agencia (D-29) y lo que hizo un interno en esos campos se oculta, incluidos los eventos del sistema: la
 * agencia ya ve el valor vigente y el estado de la ficha, y ante la duda (PA-38, A5) se oculta.
 */
export function eventoDeHistorialVisible(
  actor: Pick<ActorLike, 'rol' | 'organizacionId'>,
  evento: { campo: string; organizacionId: string },
): boolean {
  if (!historialLimitado(actor)) return true;
  return CLAVES_HISTORIAL_ADUANA.includes(evento.campo) && evento.organizacionId === actor.organizacionId;
}
