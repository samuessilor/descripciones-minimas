'use client';

import { Building2, LayoutDashboard, ListChecks, ScrollText, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECCIONES: ReadonlyArray<{ href: string; etiqueta: string; icono: LucideIcon; exacta?: boolean; soloAdministrador?: boolean }> = [
  { href: '/admin', etiqueta: 'Resumen', icono: LayoutDashboard, exacta: true },
  { href: '/admin/usuarios', etiqueta: 'Usuarios', icono: Users },
  { href: '/admin/organizaciones', etiqueta: 'Organizaciones', icono: Building2 },
  { href: '/admin/catalogos', etiqueta: 'Catálogos', icono: ListChecks },
  { href: '/admin/auditoria', etiqueta: 'Auditoría', icono: ScrollText },
  { href: '/admin/parametros', etiqueta: 'Parámetros', icono: SlidersHorizontal, soloAdministrador: true },
];

/**
 * Navegacion local de la administracion (pestañas de seccion) para pantallas de menos de 1024 px, donde el menu lateral
 * no existe: se llega a las secciones que le tocan a cada rol con una barra que se desplaza sin partir la pagina. Desde 1024 px el menu
 * lateral ya despliega estas secciones, asi que aqui se oculta para no duplicar la navegacion. La activa va en negrita, con subrayado y `aria-current` (no solo color).
 */
export function SubNavAdmin({ administrador }: { administrador: boolean }) {
  const ruta = usePathname();
  return (
    <nav aria-label="Secciones de administración" className="-mx-4 mb-6 border-b border-borde-suave sm:mx-0 lg:hidden">
      <ul className="flex gap-0.5 overflow-x-auto px-4 [scrollbar-width:none] sm:px-0">
        {SECCIONES.filter((s) => administrador || !s.soloAdministrador).map((s) => {
          const activa = s.exacta ? ruta === s.href : ruta === s.href || ruta.startsWith(`${s.href}/`);
          const Icono = s.icono;
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={activa ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex min-h-11 items-center gap-2 border-b-[3px] px-3 text-sm transition-colors duration-150',
                  activa ? 'border-azul-700 font-bold text-azul-900' : 'border-transparent font-semibold text-tinta-suave hover:border-borde-fuerte hover:text-tinta',
                )}
              >
                <Icono aria-hidden className="size-4 shrink-0" strokeWidth={activa ? 2.2 : 1.75} />
                {s.etiqueta}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
