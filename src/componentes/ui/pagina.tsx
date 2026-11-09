import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Contenedores de pagina (11.6): la FICHA y los formularios usan `ContenedorLectura` (una columna de
 * 720 px, centrada, nada hacia los lados); los LISTADOS usan `ContenedorAncho` (ancho completo con tope).
 */
export function ContenedorLectura({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('contenedor-lectura', className)}>{children}</div>;
}

export function ContenedorAncho({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('contenedor-ancho', className)}>{children}</div>;
}

export interface Miga {
  etiqueta: string;
  href?: string;
}

/**
 * Migas de pan: la ultima es la pagina actual (`aria-current="page"`). En movil se reducen a un solo
 * enlace «‹ Referencias» (volver un nivel), que ocupa menos y es mas facil de tocar.
 */
export function Migas({ items, className }: { items: readonly Miga[]; className?: string }) {
  const anterior = items.length > 1 ? items[items.length - 2] : undefined;
  return (
    <nav aria-label="Migas" className={className}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-tinta-suave max-sm:hidden">
        {items.map((m, i) => {
          const ultima = i === items.length - 1;
          return (
            <li key={`${m.etiqueta}-${i}`} className="flex min-w-0 items-center gap-1">
              {m.href && !ultima ? (
                <Link href={m.href} className="rounded px-1 py-0.5 hover:text-azul-700 hover:underline">
                  {m.etiqueta}
                </Link>
              ) : (
                <span aria-current={ultima ? 'page' : undefined} className={cn('truncate px-1', ultima && 'font-semibold text-tinta')}>
                  {m.etiqueta}
                </span>
              )}
              {!ultima ? <ChevronRight aria-hidden className="size-3.5 shrink-0" /> : null}
            </li>
          );
        })}
      </ol>
      {anterior?.href ? (
        <Link href={anterior.href} className="inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-azul-700 sm:hidden">
          <ChevronLeft aria-hidden className="size-4" />
          {anterior.etiqueta}
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * Encabezado estandar de pagina: migas opcionales, titulo (h1), descripcion y acciones a la derecha.
 * Una pagina tiene UN h1. En movil las acciones pasan debajo y ocupan el ancho.
 */
export function EncabezadoPagina({
  titulo,
  descripcion,
  acciones,
  migas,
  meta,
  className,
}: {
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  migas?: readonly Miga[];
  /** Linea de datos bajo el titulo (cantidad, ultima actualizacion). */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6 space-y-2', className)}>
      {migas && migas.length > 0 ? <Migas items={migas} /> : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta">{titulo}</h1>
          {descripcion ? <p className="mt-1 max-w-[65ch] text-base text-tinta-suave">{descripcion}</p> : null}
          {meta ? <div className="mt-1 text-sm text-tinta-suave">{meta}</div> : null}
        </div>
        {acciones ? <div className="flex flex-wrap items-center gap-3 max-sm:w-full [&>*]:max-sm:flex-1">{acciones}</div> : null}
      </div>
    </header>
  );
}
