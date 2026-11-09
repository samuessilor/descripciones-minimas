'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';
import { posicionar, useReposicionar, type Alineacion, type Lado } from './flotante';

/**
 * Popover accesible sobre el API nativo `popover="auto"`: cierra con Esc y al pulsar fuera, vive en la
 * capa superior (no lo recorta ningun contenedor) y devuelve el foco al disparador.
 *
 *   <Popover etiqueta="Notificaciones" alinear="fin"
 *     disparador={(p) => <button {...p}>Abrir</button>}>
 *     {({ cerrar }) => <p>Contenido <button onClick={cerrar}>Cerrar</button></p>}
 *   </Popover>
 *
 * `disparador` recibe las props que debe esparcir un unico `<button>`: `ref`, `popoverTarget`,
 * `aria-expanded`, `aria-controls`, `aria-haspopup`. El contenido solo se monta mientras esta abierto.
 */
export interface PropsDisparador {
  ref: Ref<HTMLButtonElement>;
  popoverTarget: string;
  'aria-expanded': boolean;
  'aria-controls': string;
  'aria-haspopup': 'dialog' | 'menu';
}

export interface ApiPopover {
  cerrar: () => void;
}

const ContextoPopover = createContext<ApiPopover | null>(null);
export const useCerrarPopover = (): (() => void) => useContext(ContextoPopover)?.cerrar ?? (() => {});

export function Popover({
  etiqueta,
  disparador,
  children,
  alinear = 'inicio',
  lado = 'abajo',
  rol = 'dialog',
  enfocar = 'panel',
  className,
  onCambio,
}: {
  /** Nombre accesible del panel. */
  etiqueta: string;
  disparador: (props: PropsDisparador) => ReactNode;
  children: ReactNode | ((api: ApiPopover) => ReactNode);
  alinear?: Alineacion;
  lado?: Lado;
  rol?: 'dialog' | 'menu';
  /** Donde cae el foco al abrir: el panel, el primer elemento interactivo, o ninguno. */
  enfocar?: 'panel' | 'primero' | 'ninguno';
  /** Clases del panel (ancho, relleno). */
  className?: string;
  onCambio?: (abierto: boolean) => void;
}) {
  const id = `pop-${useId().replace(/:/g, '')}`;
  const ancla = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [abierto, setAbierto] = useState(false);
  const cambioRef = useRef(onCambio);
  useEffect(() => {
    cambioRef.current = onCambio;
  });

  const cerrar = useCallback(() => {
    const el = document.getElementById(id);
    if (el?.matches(':popover-open')) el.hidePopover();
  }, [id]);

  // El navegador abre y cierra (boton, Esc, clic fuera); aqui solo se sincroniza el estado y la posicion.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const alCambiar = (e: Event) => {
      const nuevo = (e as ToggleEvent).newState === 'open';
      if (nuevo && ancla.current) {
        posicionar(ancla.current, el, { lado, alinear });
        el.dataset.listo = '';
      } else {
        delete el.dataset.listo;
      }
      setAbierto(nuevo);
      cambioRef.current?.(nuevo);
    };
    el.addEventListener('toggle', alCambiar);
    return () => el.removeEventListener('toggle', alCambiar);
  }, [lado, alinear]);

  useReposicionar(abierto, ancla, panel, { lado, alinear });

  useLayoutEffect(() => {
    const el = panel.current;
    if (!abierto || !el) return;
    if (ancla.current) posicionar(ancla.current, el, { lado, alinear });
    if (enfocar === 'panel') el.focus({ preventScroll: true });
    else if (enfocar === 'primero') {
      const primero = el.querySelector<HTMLElement>('[role="menuitem"], a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (primero ?? el).focus({ preventScroll: true });
    }
  }, [abierto, enfocar, lado, alinear]);

  return (
    <ContextoPopover.Provider value={{ cerrar }}>
      {disparador({
        ref: ancla,
        popoverTarget: id,
        'aria-expanded': abierto,
        'aria-controls': id,
        'aria-haspopup': rol,
      })}
      <div
        ref={panel}
        id={id}
        popover="auto"
        role={rol}
        aria-label={etiqueta}
        tabIndex={-1}
        className={cn('flotante rounded-xl border border-borde-suave bg-superficie text-tinta shadow-flotante outline-none', className)}
      >
        {abierto ? (typeof children === 'function' ? children({ cerrar }) : children) : null}
      </div>
    </ContextoPopover.Provider>
  );
}
