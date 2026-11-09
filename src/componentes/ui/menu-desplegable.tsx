'use client';

import Link from 'next/link';
import { useRef, type ButtonHTMLAttributes, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Popover, useCerrarPopover, type PropsDisparador } from './popover';

/**
 * Menu de acciones (patron APG «menu button»): flechas, Inicio/Fin, Esc y Tab cierran. Para acciones
 * sobre un objeto («Descargar Excel ▾»: «Lo que veo» / «Toda la base»). Para navegacion de sitio o el
 * menu de cuenta usa `Popover` (patron de divulgacion), que no exige flechas.
 *
 *   <MenuDesplegable etiqueta="Descargar Excel" disparador={(p) => <Boton {...p}>Descargar Excel</Boton>}>
 *     <ItemMenu onClick={…}>Lo que veo (25 filas)</ItemMenu>
 *     <ItemMenu href="/api/exportar?todo=1">Toda la base</ItemMenu>
 *   </MenuDesplegable>
 */
export function MenuDesplegable({
  etiqueta,
  disparador,
  children,
  alinear = 'inicio',
  className,
  onCambio,
}: {
  etiqueta: string;
  disparador: (props: PropsDisparador) => ReactNode;
  children: ReactNode;
  alinear?: 'inicio' | 'fin';
  className?: string;
  /** Avisa cuando el menu se abre o se cierra. */
  onCambio?: (abierto: boolean) => void;
}) {
  const lista = useRef<HTMLDivElement | null>(null);

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(lista.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const ir = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i <= 0 ? items.length - 1 : i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(items.length - 1);
  }

  return (
    <Popover etiqueta={etiqueta} rol="menu" enfocar="primero" alinear={alinear} disparador={disparador} className={cn('min-w-56 p-1.5', className)} {...(onCambio ? { onCambio } : {})}>
      <div ref={lista} role="presentation" onKeyDown={alTeclear}>
        {children}
      </div>
    </Popover>
  );
}

const claseItem =
  'flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-base text-tinta outline-none hover:bg-azul-50 focus-visible:bg-azul-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foco aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-tinta-suave';

/** Elemento del menu: con `href` es un enlace; sin el, un boton. Cierra el menu al elegirlo. */
export function ItemMenu(
  props:
    | (Omit<ComponentProps<typeof Link>, 'role'> & { href: string })
    | (ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }),
) {
  const cerrar = useCerrarPopover();
  if (props.href !== undefined) {
    const { className, onClick, ...resto } = props as ComponentProps<typeof Link>;
    return (
      <Link
        role="menuitem"
        className={cn(claseItem, className)}
        onClick={(e) => {
          onClick?.(e);
          cerrar();
        }}
        {...resto}
      />
    );
  }
  const { className, onClick, type = 'button', ...resto } = props as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      role="menuitem"
      type={type}
      className={cn(claseItem, className)}
      onClick={(e) => {
        onClick?.(e);
        cerrar();
      }}
      {...resto}
    />
  );
}

export function SeparadorMenu() {
  return <div role="separator" className="my-1 h-px bg-borde-suave" />;
}
