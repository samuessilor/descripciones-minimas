/**
 * Permisos (matriz 3.3), reglas de escritura por campo (9.2) y de visibilidad por organizacion
 * y agencia (8.3 regla 10, A5, RV-28, RV-29). Dominio PURO: recibe datos, no consulta la base.
 * La capa de politicas del servidor aplica las mismas reglas en SQL y las pruebas de integracion
 * las cruzan contra estas funciones.
 */
import { getCampo, type CampoDef } from './campos';
import type { EstadoFicha } from './estado';

export const ROLES = ['admin', 'solicitante', 'aduana', 'lector'] as const;
export type Rol = (typeof ROLES)[number];

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
  | 'administrar';

export interface ContextoAccion {
  esRemitente?: boolean;
  esCreador?: boolean;
  esBorradorSinEnviar?: boolean;
  estadoFicha?: EstadoFicha;
}

const SOLO: Record<Exclude<Accion, 'recordar' | 'reasignar' | 'archivar' | 'corregir_codigo' | 'adjuntar_foto'>, readonly Rol[]> = {
  ver_listado: ROLES,
  crear_referencia: ['admin', 'solicitante'],
  escribir_grupo_cliente: ['admin', 'solicitante'],
  escribir_grupo_aduana: ['admin', 'aduana'],
  marcar_clasificada: ['admin', 'aduana'],
  enviar_a: ['admin', 'solicitante', 'aduana'],
  comentar: ['admin', 'solicitante', 'aduana'],
  reabrir: ['admin', 'aduana'],
  solicitar_reapertura: ['admin', 'solicitante'],
  desarchivar: ['admin'],
  descargar_excel: ROLES,
  administrar: ['admin'],
};

/** Matriz 3.3: que puede cada rol. Las acciones contextuales reciben `ctx`. */
export function puede(actor: Pick<ActorLike, 'rol'>, accion: Accion, ctx: ContextoAccion = {}): boolean {
  const { rol } = actor;
  switch (accion) {
    case 'recordar':
      return rol === 'admin' || rol === 'lector' || ((rol === 'solicitante' || rol === 'aduana') && !!ctx.esRemitente);
    case 'reasignar':
      return rol === 'admin' || ((rol === 'solicitante' || rol === 'aduana') && !!ctx.esRemitente);
    case 'archivar':
      return rol === 'admin' || (rol === 'solicitante' && !!ctx.esCreador && !!ctx.esBorradorSinEnviar);
    case 'corregir_codigo':
      return rol === 'admin' || (rol === 'solicitante' && !!ctx.esCreador && ctx.estadoFicha !== 'CLASIFICADA');
    case 'adjuntar_foto':
      return (rol === 'admin' || rol === 'solicitante') && ctx.estadoFicha !== 'CLASIFICADA';
    default:
      return SOLO[accion].includes(rol);
  }
}

export function visibilidadesComentarioPermitidas(rol: Rol): Array<'interno' | 'todos'> {
  if (rol === 'aduana') return ['todos'];
  if (rol === 'lector') return [];
  return ['interno', 'todos'];
}

export function alcanceExcel(rol: Rol): 'todo' | 'visible' {
  return rol === 'admin' || rol === 'solicitante' ? 'todo' : 'visible';
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
        (actor.rol === 'admin' ||
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
