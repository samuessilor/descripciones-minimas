'use client';

import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { mostrar, ocultar, posicionar, type Lado } from './flotante';

/**
 * Tooltip: ayuda breve que aparece al pasar el cursor o al enfocar con teclado (retardo 350 ms), se
 * descarta con Esc y queda enlazada con `aria-describedby`. NO sustituye al nombre accesible: un boton
 * de solo icono sigue necesitando `aria-label`. Nunca pongas en un tooltip algo imprescindible ni
 * interactivo; en tactil no existe, asi que lo esencial va en el texto visible.
 *
 *   <Tooltip contenido="Descargar Excel"><Boton tamano="icono" aria-label="Descargar Excel">…</Boton></Tooltip>
 */
export function Tooltip({
  contenido,
  children,
  lado = 'arriba',
  retardo = 350,
}: {
  contenido: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  lado?: Lado;
  retardo?: number;
}) {
  const id = `tip-${useId().replace(/:/g, '')}`;
  const ancla = useRef<HTMLSpanElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visible, setVisible] = useState(false);

  const abrir = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      const el = panel.current;
      if (!el || !ancla.current) return;
      mostrar(el);
      posicionar(ancla.current, el, { lado, alinear: 'centro', separacion: 8 });
      el.dataset.listo = '';
      setVisible(true);
    }, retardo);
  }, [lado, retardo]);

  const cerrar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    const el = panel.current;
    if (el) {
      ocultar(el);
      delete el.dataset.listo;
    }
    setVisible(false);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [visible, cerrar]);

  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const hijo = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' '),
      })
    : children;

  return (
    <>
      <span
        ref={ancla}
        className="inline-flex"
        onPointerEnter={abrir}
        onPointerLeave={cerrar}
        onFocus={abrir}
        onBlur={cerrar}
        onPointerDown={cerrar}
      >
        {hijo}
      </span>
      <div
        ref={panel}
        id={id}
        popover="manual"
        role="tooltip"
        className={cn(
          'flotante pointer-events-none max-w-64 rounded-md bg-azul-900 px-2.5 py-1.5 text-sm font-medium leading-snug text-white shadow-flotante',
        )}
      >
        {contenido}
      </div>
    </>
  );
}
