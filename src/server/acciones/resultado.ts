/**
 * Contrato de salida de las acciones del servidor (12.3):
 * `{ ok: true, data } | { ok: false, codigo, mensaje }`.
 *
 * Los nucleos (`src/server/acciones/*`) LANZAN `ErrorAccion` para abortar la transaccion; la capa
 * de Server Actions (`src/app/**\/acciones.ts`, con 'use server') los convierte en `Resultado`
 * con `comoResultado`. Asi el nucleo es probable sin Next y una excepcion nunca deja una
 * transaccion a medias.
 */

export type CodigoError =
  | 'SIN_PERMISO'
  | 'NO_ENCONTRADO'
  | 'CONFLICTO'
  | 'VALIDACION'
  | 'FICHA_CERRADA'
  | 'FALTA_MOTIVO'
  | 'DUPLICADO'
  | 'LIMITE_TASA'
  /** Accion declarada pero que se construye en un hito posterior (stub tipado). */
  | 'NO_IMPLEMENTADO'
  | 'ERROR_INTERNO';

export class ErrorAccion extends Error {
  constructor(
    readonly codigo: CodigoError,
    mensaje: string,
    readonly detalle?: unknown,
  ) {
    super(mensaje);
    this.name = 'ErrorAccion';
  }
}

export type Resultado<T> =
  | { ok: true; data: T }
  | { ok: false; codigo: CodigoError; mensaje: string; detalle?: unknown };

/** Ejecuta un nucleo y devuelve el contrato `Resultado`. Los errores inesperados no se filtran al cliente. */
export async function comoResultado<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ErrorAccion) {
      return { ok: false, codigo: e.codigo, mensaje: e.message, ...(e.detalle !== undefined ? { detalle: e.detalle } : {}) };
    }
    console.error('[accion] error inesperado', e);
    return {
      ok: false,
      codigo: 'ERROR_INTERNO',
      mensaje: 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.',
    };
  }
}

/** Para stubs de hitos posteriores. */
export function noImplementado(hito: string, accion: string): never {
  throw new ErrorAccion('NO_IMPLEMENTADO', `«${accion}» se construye en el hito ${hito}.`, { hito, accion });
}

/** Detecta la violacion de una restriccion unica de Postgres (23505), con o sin envoltura de Drizzle. */
export function esViolacionUnica(e: unknown, restriccion?: string): boolean {
  let actual: unknown = e;
  for (let i = 0; i < 4 && actual; i++) {
    const x = actual as { code?: string; constraint?: string; constraint_name?: string; cause?: unknown; message?: string };
    if (x.code === '23505') {
      if (!restriccion) return true;
      const nombre = x.constraint ?? x.constraint_name ?? '';
      return nombre === restriccion || (x.message ?? '').includes(restriccion);
    }
    actual = x.cause;
  }
  return false;
}
