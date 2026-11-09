/** Utilidades para Route Handlers: respuestas JSON con el contrato de errores de 12.3. */
import { timingSafeEqual } from 'node:crypto';
import { ErrorAccion, type CodigoError } from './acciones/resultado';

const ESTADO: Record<CodigoError, number> = {
  SIN_PERMISO: 403,
  NO_ENCONTRADO: 404,
  CONFLICTO: 409,
  VALIDACION: 422,
  FICHA_CERRADA: 409,
  FALTA_MOTIVO: 422,
  DUPLICADO: 409,
  LIMITE_TASA: 429,
  NO_IMPLEMENTADO: 501,
  ERROR_INTERNO: 500,
};

export function json(cuerpo: unknown, estado = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });
}

export function respuestaDeError(e: unknown): Response {
  if (e instanceof ErrorAccion) {
    // Sin sesion => 401 para que el cliente vuelva a /entrar.
    const sesion = (e.detalle as { sesionVencida?: boolean } | undefined)?.sesionVencida;
    return json({ ok: false, codigo: e.codigo, mensaje: e.message, detalle: e.detalle }, sesion ? 401 : ESTADO[e.codigo]);
  }
  console.error('[api] error inesperado', e);
  return json({ ok: false, codigo: 'ERROR_INTERNO', mensaje: 'Algo salió mal de nuestro lado.' }, 500);
}

/** Comparacion de secretos en tiempo constante. */
export function secretoValido(recibido: string | null, esperado: string | undefined): boolean {
  if (!recibido || !esperado) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function soloDesarrollo(): Response | null {
  return process.env.NODE_ENV === 'development' ? null : json({ ok: false, codigo: 'NO_ENCONTRADO' }, 404);
}
