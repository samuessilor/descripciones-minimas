import type { Rol } from '@/dominio/permisos';

export type IconoNavegacion = 'inicio' | 'tablero' | 'referencias' | 'notificaciones' | 'administracion';

export interface DestinoNavegacion {
  href: string;
  etiqueta: string;
  /** Clave del icono (el componente lo resuelve en el cliente: no se pasan funciones del servidor al cliente). */
  icono: IconoNavegacion;
  /** Roles que lo ven. */
  roles: readonly Rol[];
  /** Hijos (administracion). */
  hijos?: readonly DestinoNavegacion[];
}

const TODOS: readonly Rol[] = ['admin', 'solicitante', 'aduana', 'lector'];

/**
 * Mapa de navegacion (10.1): enlaces a TODAS las secciones aunque algunas paginas sean todavia
 * «Proximamente». Escritorio (>= 1024 px): menu lateral con Inicio, Referencias, Notificaciones y, solo
 * para el admin, Administracion. Movil / tableta: barra inferior con Inicio, Referencias y «Mas»
 * (Notificaciones, Cuenta, Administracion, Cerrar sesion). La campana y el avatar viven en la barra superior.
 */
export const DESTINOS: readonly DestinoNavegacion[] = [
  { href: '/', etiqueta: 'Inicio', icono: 'inicio', roles: TODOS },
  { href: '/tablero', etiqueta: 'Resumen', icono: 'tablero', roles: ['admin', 'solicitante', 'lector'] },
  { href: '/referencias', etiqueta: 'Referencias', icono: 'referencias', roles: TODOS },
  { href: '/notificaciones', etiqueta: 'Notificaciones', icono: 'notificaciones', roles: TODOS },
  {
    href: '/admin',
    etiqueta: 'Administración',
    icono: 'administracion',
    roles: ['admin'],
    hijos: [
      { href: '/admin/usuarios', etiqueta: 'Usuarios', icono: 'administracion', roles: ['admin'] },
      { href: '/admin/organizaciones', etiqueta: 'Organizaciones', icono: 'administracion', roles: ['admin'] },
      { href: '/admin/catalogos', etiqueta: 'Catálogos', icono: 'administracion', roles: ['admin'] },
      { href: '/admin/auditoria', etiqueta: 'Auditoría', icono: 'administracion', roles: ['admin'] },
      { href: '/admin/correo', etiqueta: 'Cola de correo', icono: 'administracion', roles: ['admin'] },
      { href: '/admin/parametros', etiqueta: 'Parámetros', icono: 'administracion', roles: ['admin'] },
    ],
  },
];

export const ENLACES_SUPERIORES = {
  notificaciones: '/notificaciones',
  cuenta: '/cuenta',
  nuevaReferencia: '/referencias/nueva',
  ayuda: '/ayuda',
} as const;

export const ETIQUETA_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  solicitante: 'Solicitante',
  aduana: 'Aduana',
  lector: 'Lector',
};

export function destinosPara(rol: Rol): DestinoNavegacion[] {
  return DESTINOS.filter((d) => d.roles.includes(rol)).map((d) => ({
    ...d,
    ...(d.hijos ? { hijos: d.hijos.filter((h) => h.roles.includes(rol)) } : {}),
  }));
}
