/**
 * Que rutas de Better Auth se exponen por HTTP (`/api/auth/*`). Funcion pura, aparte de la ruta de Next,
 * para poder probar la lista sin levantar el servidor.
 *
 * Solo `POST /sign-out`. `GET /get-session` NO se expone: devuelve el token de sesion crudo en el cuerpo
 * JSON (anula `HttpOnly`) y ningun cliente lo usa; el servidor resuelve la sesion con `getActor()`.
 * Todo lo demas responde 404:
 *  - `/sign-in/email` y `/sign-up/email` quedan cerrados: se entra por la Server Action de la pantalla de entrada
 *    (con limite de intentos y anti-enumeracion) y las cuentas solo las crea un administrador;
 *  - nada de cambiar o restablecer contrasena por aqui (`/change-password`, `/reset-password`): cada cambio pasa por
 *    una accion propia con su limite y su auditoria;
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
