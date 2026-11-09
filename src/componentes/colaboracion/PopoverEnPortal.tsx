'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { posicionar, useReposicionar } from '@/componentes/ui/flotante';
import type { PropsDisparador } from '@/componentes/ui/popover';
import { cn } from '@/lib/utils';

const sinSuscripcion = () => () => undefined;

/** `true` solo en el cliente ya hidratado (para usar portales sin romper la hidratacion). */
export function useEnCliente(): boolean {
  return useSyncExternalStore(
    sinSuscripcion,
    () => true,
    () => false,
  );
}

/**
 * Igual que `Popover` de la biblioteca (API nativo `popover`, Esc, clic fuera, foco de vuelta al disparador), pero
 * el PANEL se dibuja en un portal sobre `document.body`. Se usa donde el disparador vive dentro de un `<p>`
 * (la linea «Autor · fecha» de cada campo): un `<div>` dentro de un `<p>` es HTML invalido y rompe la hidratacion.
 * El disparador sigue en su sitio; solo el panel sale del parrafo.
 */
export function PopoverEnPortal({
  etiqueta,
  disparador,
  children,
  alinear = 'inicio',
  className,
}: {
  etiqueta: string;
  disparador: (props: PropsDisparador) => ReactNode;
  children: (api: { cerrar: () => void }) => ReactNode;
  alinear?: 'inicio' | 'fin' | 'centro';
  className?: string;
}) {
  const id = `pop-${useId().replace(/:/g, '')}`;
  const ancla = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [abierto, setAbierto] = useState(false);
  const enCliente = useEnCliente();

  const cerrar = useCallback(() => {
    const el = document.getElementById(id);
    if (el?.matches(':popover-open')) el.hidePopover();
  }, [id]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const alCambiar = (e: Event) => {
      const nuevo = (e as ToggleEvent).newState === 'open';
      if (nuevo && ancla.current) {
        posicionar(ancla.current, el, { lado: 'abajo', alinear });
        el.dataset.listo = '';
      } else {
        delete el.dataset.listo;
      }
      setAbierto(nuevo);
    };
    el.addEventListener('toggle', alCambiar);
    return () => el.removeEventListener('toggle', alCambiar);
  }, [alinear, enCliente]);

  useReposicionar(abierto, ancla, panel, { lado: 'abajo', alinear });

  useLayoutEffect(() => {
    const el = panel.current;
    if (!abierto || !el) return;
    if (ancla.current) posicionar(ancla.current, el, { lado: 'abajo', alinear });
    el.focus({ preventScroll: true });
  }, [abierto, alinear]);

  return (
    <>
      {disparador({
        ref: ancla,
        popoverTarget: id,
        'aria-expanded': abierto,
        'aria-controls': id,
        'aria-haspopup': 'dialog',
      })}
      {enCliente
        ? createPortal(
            <div
              ref={panel}
              id={id}
              popover="auto"
              role="dialog"
              aria-label={etiqueta}
              tabIndex={-1}
              className={cn('flotante rounded-xl border border-borde-suave bg-superficie text-tinta shadow-flotante outline-none', className)}
            >
              {abierto ? children({ cerrar }) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
