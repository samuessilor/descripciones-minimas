'use client';

import { Bell, ChevronDown, CircleHelp, LogOut, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cerrarSesionAccion } from '@/app/acciones/sesion';
import { ENLACES_SUPERIORES, ETIQUETA_ROL } from './navegacion';
import type { Rol } from '@/dominio/permisos';
import { Avatar, nombreVisible } from './ui/avatar';
import { Insignia } from './ui/insignia';
import { Popover, useCerrarPopover } from './ui/popover';

export interface UsuarioMenu {
  nombre: string;
  email: string;
  rol: Rol;
  organizacion: string;
  esAgencia: boolean;
  area?: string | null;
}

function Enlace({ href, icono, children }: { href: string; icono: ReactNode; children: ReactNode }) {
  const cerrar = useCerrarPopover();
  return (
    <Link
      href={href}
      onClick={cerrar}
      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-base font-semibold text-tinta hover:bg-azul-50 [&_svg]:size-4.5 [&_svg]:text-tinta-suave"
    >
      {icono}
      {children}
    </Link>
  );
}

/**
 * Menu de usuario (esquina superior derecha): quien eres (nombre, organizacion, rol), tu cuenta y
 * «Cerrar sesion». Es una divulgacion (no un `role=menu`): Tab recorre los enlaces, Esc cierra.
 * Saber de que organizacion es cada cuenta es parte de la confianza entre areas y agencias.
 */
export function MenuUsuario({
  usuario,
  cuentasDemo,
}: {
  usuario: UsuarioMenu;
  /** Solo desarrollo sin login: cuentas entre las que se cambia con un clic. */
  cuentasDemo?: Array<{ email: string; etiqueta: string; detalle: string }> | undefined;
}) {
  const nombre = nombreVisible(usuario.nombre);
  const ruta = usePathname();
  return (
    <Popover
      etiqueta="Cuenta"
      alinear="fin"
      enfocar="primero"
      className="w-80 max-w-[calc(100vw-1rem)] p-0"
      disparador={(p) => (
        <button
          {...p}
          type="button"
          className="group inline-flex min-h-11 items-center gap-2 rounded-full pl-1 pr-1 hover:bg-white/10 lg:pr-3"
        >
          <Avatar nombre={usuario.nombre} tamano="md" tono="bg-white text-azul-900" />
          <span className="max-w-40 truncate text-sm font-semibold text-white max-lg:sr-solo">{nombre}</span>
          <ChevronDown aria-hidden className="hidden size-4 text-white/70 lg:block" />
        </button>
      )}
    >
      <div className="flex items-center gap-3 border-b border-borde-suave px-4 py-4">
        <Avatar nombre={usuario.nombre} tamano="lg" />
        <div className="min-w-0">
          <p className="truncate font-display text-base font-extrabold text-tinta">{nombre}</p>
          <p className="truncate text-sm text-tinta-suave">{usuario.email}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 border-b border-borde-suave px-4 py-3 text-sm">
        <dt className="text-tinta-suave">Organización</dt>
        <dd className="min-w-0 text-right font-semibold text-tinta">
          <span className="truncate">{usuario.organizacion}</span>
          {usuario.esAgencia ? (
            <Insignia variante="contorno" className="ml-2 align-middle">
              Agencia de aduana
            </Insignia>
          ) : null}
        </dd>
        {usuario.area ? (
          <>
            <dt className="text-tinta-suave">Área</dt>
            <dd className="text-right font-semibold text-tinta">{usuario.area}</dd>
          </>
        ) : null}
        <dt className="text-tinta-suave">Rol</dt>
        <dd className="text-right">
          <Insignia variante="azul">{ETIQUETA_ROL[usuario.rol]}</Insignia>
        </dd>
      </dl>
      {cuentasDemo ? (
        <div className="border-b border-borde-suave p-2">
          <p className="flex items-center gap-2 px-3 py-1 text-xs font-bold uppercase tracking-wide text-tinta-suave">
            <Users aria-hidden className="size-3.5" />
            Ver como (modo demostración)
          </p>
          <div className="max-h-[45vh] overflow-y-auto">
            {cuentasDemo.map((c) => {
              const actual = c.email === usuario.email;
              return (
                <a
                  key={c.email}
                  href={`/api/dev/entrar?correo=${encodeURIComponent(c.email)}&siguiente=${encodeURIComponent(ruta || '/')}`}
                  aria-current={actual ? 'true' : undefined}
                  className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 text-base font-semibold text-tinta hover:bg-azul-50 ${actual ? 'bg-azul-50' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{c.etiqueta}</span>
                    <span className="block truncate text-sm font-normal text-tinta-suave">{c.detalle}</span>
                  </span>
                  {actual ? <Insignia variante="azul">Actual</Insignia> : null}
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="p-2">
        <Enlace href={ENLACES_SUPERIORES.cuenta} icono={<UserRound aria-hidden />}>
          Mi cuenta
        </Enlace>
        <Enlace href={ENLACES_SUPERIORES.notificaciones} icono={<Bell aria-hidden />}>
          Notificaciones
        </Enlace>
        <Enlace href={ENLACES_SUPERIORES.ayuda} icono={<CircleHelp aria-hidden />}>
          Ayuda
        </Enlace>
        {cuentasDemo ? null : (
          <form action={cerrarSesionAccion}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-semibold text-tinta hover:bg-azul-50"
            >
              <LogOut aria-hidden className="size-4.5 text-tinta-suave" />
              Cerrar sesión
            </button>
          </form>
        )}
      </div>
    </Popover>
  );
}
