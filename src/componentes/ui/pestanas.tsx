'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pestanas (patron APG «tabs», activacion automatica): flechas izquierda/derecha, Inicio y Fin; solo la
 * pestana activa esta en el orden de tabulacion. Para vistas paralelas del MISMO contenido
 * («Para mi · Esperando a otros · Recientes»). El indicador no es solo color: la activa va en negrita
 * y con subrayado grueso.
 *
 *   <Pestanas etiqueta="Mis referencias" valorInicial="para-mi" items={[
 *     { id: 'para-mi', etiqueta: 'Para mi', contador: 4, contenido: <ListaA /> },
 *     { id: 'esperando', etiqueta: 'Esperando a otros', contador: 7, contenido: <ListaB /> },
 *   ]} />
 *
 * Controlada con `valor` + `onCambio` si necesitas leer la pestana desde fuera (por ejemplo, la URL).
 */
export interface ItemPestana {
  id: string;
  etiqueta: string;
  /** Numero a la derecha del texto (pendientes). */
  contador?: number;
  contenido?: ReactNode;
}

export function Pestanas({
  etiqueta,
  items,
  valor,
  valorInicial,
  onCambio,
  className,
}: {
  etiqueta: string;
  items: readonly ItemPestana[];
  valor?: string;
  valorInicial?: string;
  onCambio?: (id: string) => void;
  className?: string;
}) {
  const base = `tabs-${useId().replace(/:/g, '')}`;
  const [interno, setInterno] = useState(valorInicial ?? items[0]?.id ?? '');
  const activa = valor ?? interno;
  const botones = useRef(new Map<string, HTMLButtonElement>());

  function cambiar(id: string, enfocar = false) {
    if (valor === undefined) setInterno(id);
    onCambio?.(id);
    if (enfocar) botones.current.get(id)?.focus();
  }

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((x) => x.id === activa);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n >= 0) {
      e.preventDefault();
      cambiar(items[n]!.id, true);
    }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={etiqueta} onKeyDown={alTeclear} className="flex gap-1 overflow-x-auto border-b border-borde-suave [scrollbar-width:none]">
        {items.map((it) => {
          const sel = it.id === activa;
          return (
            <button
              key={it.id}
              ref={(el) => {
                if (el) botones.current.set(it.id, el);
                else botones.current.delete(it.id);
              }}
              type="button"
              role="tab"
              id={`${base}-t-${it.id}`}
              aria-selected={sel}
              aria-controls={`${base}-p-${it.id}`}
              tabIndex={sel ? 0 : -1}
              onClick={() => cambiar(it.id)}
              className={cn(
                '-mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-[3px] px-3.5 text-base transition-colors duration-150',
                sel
                  ? 'border-azul-700 font-bold text-azul-900'
                  : 'border-transparent font-semibold text-tinta-suave hover:border-borde-fuerte hover:text-tinta',
              )}
            >
              {it.etiqueta}
              {it.contador !== undefined ? (
                <span
                  aria-label={`${it.contador} ${it.contador === 1 ? 'referencia' : 'referencias'}`}
                  role="img"
                  className={cn(
                    'inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums',
                    sel ? 'bg-azul-700 text-white' : 'bg-muted text-tinta',
                  )}
                >
                  {it.contador}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {items.map((it) =>
        it.contenido !== undefined ? (
          <div
            key={it.id}
            role="tabpanel"
            id={`${base}-p-${it.id}`}
            aria-labelledby={`${base}-t-${it.id}`}
            hidden={it.id !== activa}
            tabIndex={0}
            className="pt-4 outline-offset-4"
          >
            {it.id === activa ? it.contenido : null}
          </div>
        ) : null,
      )}
    </div>
  );
}
