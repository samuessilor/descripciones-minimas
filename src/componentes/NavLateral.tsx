'use client';

import { Bell, Building2, Ellipsis, FileStack, House, LayoutDashboard, LogOut, UserRound, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cerrarSesionAccion } from '@/app/acciones/sesion';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';
import { ENLACES_SUPERIORES, type DestinoNavegacion, type IconoNavegacion } from './navegacion';
import { Cajon } from './ui/dialogo';

const ICONOS: Record<IconoNavegacion, LucideIcon> = {
  inicio: House,
  tablero: LayoutDashboard,
  referencias: FileStack,
  notificaciones: Bell,
  administracion: Building2,
};

function activo(ruta: string, href: string): boolean {
  return href === '/' ? ruta === '/' : ruta === href || ruta.startsWith(`${href}/`);
}

/**
 * Navegacion principal. `lateral`: menu fijo a la izquierda desde 1024 px. `inferior`: barra de tres
 * destinos (Inicio, Referencias, Mas) bajo 1024 px; «Mas» abre una hoja con el resto. Marca la pagina
 * actual con `aria-current="page"`, negrita y fondo (no solo color).
 */
export function NavLateral({ destinos, variante }: { destinos: DestinoNavegacion[]; variante: 'lateral' | 'inferior' }) {
  return variante === 'inferior' ? <BarraInferior destinos={destinos} /> : <MenuLateral destinos={destinos} />;
}

function MenuLateral({ destinos }: { destinos: DestinoNavegacion[] }) {
  const ruta = usePathname();
  return (
    <aside className="hidden w-64 shrink-0 border-r border-borde-suave bg-superficie lg:block">
      <nav aria-label="Principal" className="sticky top-[var(--alto-barra-superior)] flex h-[calc(100dvh-var(--alto-barra-superior))] flex-col p-3">
        <ul className="space-y-1">
          {destinos.map((d) => {
            const Icono = ICONOS[d.icono];
            const esActivo = activo(ruta, d.href);
            return (
              <li key={d.href}>
                <Link
                  href={d.href}
                  aria-current={ruta === d.href ? 'page' : esActivo ? 'true' : undefined}
                  className={cn(
                    'group flex min-h-11 items-center gap-3 rounded-lg px-3 text-base transition-colors duration-150',
                    esActivo ? 'bg-azul-50 font-bold text-azul-900' : 'font-semibold text-tinta hover:bg-muted',
                  )}
                >
                  <Icono aria-hidden className={cn('size-5 shrink-0', esActivo ? 'text-azul-700' : 'text-tinta-suave group-hover:text-tinta')} strokeWidth={esActivo ? 2.1 : 1.75} />
                  {d.etiqueta}
                </Link>
                {d.hijos && d.hijos.length > 0 && esActivo ? (
                  <ul className="ml-[1.45rem] mt-1 space-y-0.5 border-l border-borde-suave pl-3">
                    {d.hijos.map((h) => (
                      <li key={h.href}>
                        <Link
                          href={h.href}
                          aria-current={ruta === h.href ? 'page' : undefined}
                          className={cn(
                            'flex min-h-9 items-center rounded-md px-2.5 text-sm',
                            ruta === h.href ? 'bg-azul-50 font-bold text-azul-900' : 'text-tinta-suave hover:bg-muted hover:text-tinta',
                          )}
                        >
                          {h.etiqueta}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex items-center gap-3 border-t border-borde-suave px-3 pb-1 pt-4">
          <Logo variante="simbolo" fondo="claro" alto={14} className="opacity-80" />
          <span className="text-xs leading-tight text-tinta-suave">
            Supply Chain
            <br />
            Descripciones mínimas
          </span>
        </div>
      </nav>
    </aside>
  );
}

function BarraInferior({ destinos }: { destinos: DestinoNavegacion[] }) {
  const ruta = usePathname();
  const [masAbierto, setMasAbierto] = useState(false);

  const principales = destinos.filter((d) => d.href === '/' || d.href === '/referencias');
  const secundarios = destinos.filter((d) => d.href !== '/' && d.href !== '/referencias');
  const enMas = secundarios.some((d) => activo(ruta, d.href)) || activo(ruta, ENLACES_SUPERIORES.cuenta);

  return (
    <>
      <nav aria-label="Principal" className="barra-inferior fixed inset-x-0 bottom-0 z-10 border-t border-borde-suave bg-superficie pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="mx-auto flex max-w-xl">
          {principales.map((d) => {
            const Icono = ICONOS[d.icono];
            const esActivo = activo(ruta, d.href);
            return (
              <li key={d.href} className="flex-1">
                <Link
                  href={d.href}
                  aria-current={esActivo ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 px-2 text-xs',
                    esActivo ? 'font-bold text-azul-900' : 'font-semibold text-tinta-suave',
                  )}
                >
                  <span className={cn('flex h-7 w-14 items-center justify-center rounded-full transition-colors', esActivo && 'bg-azul-100')}>
                    <Icono aria-hidden className="size-5" strokeWidth={esActivo ? 2.2 : 1.75} />
                  </span>
                  {d.etiqueta}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={masAbierto}
              onClick={() => setMasAbierto(true)}
              className={cn(
                'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-2 text-xs',
                enMas ? 'font-bold text-azul-900' : 'font-semibold text-tinta-suave',
              )}
            >
              <span className={cn('flex h-7 w-14 items-center justify-center rounded-full transition-colors', enMas && 'bg-azul-100')}>
                <Ellipsis aria-hidden className="size-5" strokeWidth={enMas ? 2.2 : 1.75} />
              </span>
              Más
            </button>
          </li>
        </ul>
      </nav>

      <Cajon abierto={masAbierto} onCerrar={() => setMasAbierto(false)} titulo="Más">
        <nav aria-label="Más secciones" onClick={(e) => (e.target as HTMLElement).closest('a') && setMasAbierto(false)}>
          <ul className="space-y-1">
            {secundarios.map((d) => {
              const Icono = ICONOS[d.icono];
              return (
                <li key={d.href}>
                  <Link
                    href={d.href}
                    aria-current={ruta === d.href ? 'page' : undefined}
                    className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-semibold text-tinta hover:bg-azul-50"
                  >
                    <Icono aria-hidden className="size-5 text-tinta-suave" />
                    {d.etiqueta}
                  </Link>
                  {d.hijos && d.hijos.length > 0 ? (
                    <ul className="ml-8 space-y-0.5 border-l border-borde-suave pl-3">
                      {d.hijos.map((h) => (
                        <li key={h.href}>
                          <Link href={h.href} className="flex min-h-11 items-center rounded-md px-2.5 text-base text-tinta-suave hover:bg-azul-50 hover:text-tinta">
                            {h.etiqueta}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
            <li>
              <Link href={ENLACES_SUPERIORES.cuenta} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base font-semibold text-tinta hover:bg-azul-50">
                <UserRound aria-hidden className="size-5 text-tinta-suave" />
                Mi cuenta
              </Link>
            </li>
          </ul>
          <form action={cerrarSesionAccion} className="mt-3 border-t border-borde-suave pt-3">
            <button
              type="submit"
              className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base font-semibold text-tinta hover:bg-azul-50"
            >
              <LogOut aria-hidden className="size-5 text-tinta-suave" />
              Cerrar sesión
            </button>
          </form>
        </nav>
      </Cajon>
    </>
  );
}
