/**
 * Credenciales de acceso (usuario + contrasena, sin correo). Dominio PURO: reglas de formato que usan la interfaz,
 * las acciones y la base (la misma regex esta en el CHECK `usuario_username_formato`).
 */

/** 3 a 40 caracteres, en minusculas; empieza con letra o numero. Ej.: `consumibles`, `aduana-a`, `ana.perez`. */
export const USUARIO_REGEX = /^[a-z0-9][a-z0-9._-]{2,39}$/;

/** Minimo de la contrasena (decision del dueno: 7). Better Auth lo lee de aqui, asi interfaz, acciones y libreria coinciden. */
export const CLAVE_MIN = 7;
export const CLAVE_MAX = 128;

/** Lleva lo que se escribio al formato guardado: sin espacios en los bordes y en minusculas. */
export function normalizarUsuario(texto: string | null | undefined): string {
  return (texto ?? '').trim().toLowerCase();
}

export const USUARIO_AYUDA = 'Usa de 3 a 40 caracteres: letras sin tilde, números, punto, guion o guion bajo (ej. consumibles, aduana-a).';

/** `null` si es valido; si no, el texto para mostrar junto al campo. */
export function validarUsuario(usuario: string): string | null {
  return USUARIO_REGEX.test(usuario) ? null : USUARIO_AYUDA;
}

/** `null` si es valida; si no, el texto para mostrar junto al campo. */
export function validarClaveNueva(clave: string): string | null {
  if (clave.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > CLAVE_MAX) return `La contraseña no puede pasar de ${CLAVE_MAX} caracteres.`;
  if (clave.trim() !== clave) return 'La contraseña no puede empezar ni terminar con espacios.';
  return null;
}

/**
 * Usuario sugerido para la cuenta de una agencia de aduana: el nombre de la empresa en minusculas, sin tildes y con guiones,
 * mas `.aduana` (ej. «Agencia Magnum S.A.» -> `agencia-magnum-s-a.aduana`). Siempre cumple `USUARIO_REGEX`.
 */
export function usuarioSugeridoAgencia(nombreEmpresa: string): string {
  const base = nombreEmpresa
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 33)
    .replace(/^-+|-+$/g, '');
  return `${base || 'agencia'}.aduana`;
}

/** El correo de una cuenta que no tiene uno propio (cuentas de area): dominio reservado, nunca recibe nada. */
export function correoSinCorreo(usuario: string): string {
  return `${usuario}@sin-correo.invalid`;
}

export function esCorreoSinCorreo(email: string): boolean {
  return email.toLowerCase().endsWith('@sin-correo.invalid');
}
