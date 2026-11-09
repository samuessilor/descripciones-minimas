/**
 * Que rutas de Better Auth se exponen por HTTP (`/api/auth/*`). Funcion pura, aparte de la ruta de Next,
 * para poder probar la lista sin levantar el servidor.
 *
 * Solo `POST /sign-out`. `GET /get-session` NO se expone: devuelve el token de sesion crudo en el cuerpo
 * JSON (anula `HttpOnly`) y ningun cliente lo usa; el servidor resuelve la sesion con `getActor()`.
 * Todo lo demas responde 404:
 *  - `/sign-in/magic-link` se pide por la Server Action (con limite de tasa y anti-enumeracion);
 *  - `GET /magic-link/verify` consume el token al primer acceso (lo quemaria un escaner de enlaces):
 *    la confirmacion es el POST de `/entrar/confirmar`;
 *  - nada de actualizar usuario, cambiar correo ni cuentas sociales.
 */
const PERMITIDAS: Record<string, ReadonlySet<string>> = {
  POST: new Set(['/sign-out']),
};

/** `pathname` completo de la peticion (`/api/auth/sign-out`) y metodo HTTP. */
export function rutaAuthPermitida(metodo: string, pathname: string): boolean {
  const ruta = pathname.replace(/^\/api\/auth/, '') || '/';
  return PERMITIDAS[metodo]?.has(ruta) ?? false;
}
