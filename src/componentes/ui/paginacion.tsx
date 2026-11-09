import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { botonVariantes } from './button';

/**
 * Paginacion por cursor (10.3, 25 por pagina): «Anterior · Siguiente» y un resumen («Mostrando 1–25 de
 * 1.024»). Como el cursor no permite saltar a la pagina N, no hay numeros. Cada destino es un enlace
 * (`href`, lo normal en un listado con filtros en la URL) o un boton (`onClick`). `null` lo deshabilita.
 */
export type DestinoPagina = { href: string } | { onClick: () => void } | null;

function Flecha({ destino, sentido }: { destino: DestinoPagina; sentido: 'anterior' | 'siguiente' }) {
  const ant = sentido === 'anterior';
  const contenido = (
    <>
      {ant ? <ChevronLeft aria-hidden className="size-4" /> : null}
      {ant ? 'Anterior' : 'Siguiente'}
      {!ant ? <ChevronRight aria-hidden className="size-4" /> : null}
    </>
  );
  const clase = botonVariantes({ variante: 'secundario', tamano: 'sm' });
  if (!destino) {
    return (
      <span aria-disabled="true" className={cn(clase, 'opacity-50')}>
        {contenido}
      </span>
    );
  }
  if ('href' in destino) {
    return (
      <Link href={destino.href} rel={ant ? 'prev' : 'next'} className={clase}>
        {contenido}
      </Link>
    );
  }
  return (
    <button type="button" onClick={destino.onClick} className={clase}>
      {contenido}
    </button>
  );
}

export function Paginacion({
  resumen,
  anterior,
  siguiente,
  etiqueta = 'Paginación',
  className,
}: {
  resumen: ReactNode;
  anterior: DestinoPagina;
  siguiente: DestinoPagina;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <nav aria-label={etiqueta} className={cn('flex flex-wrap items-center justify-between gap-3', className)}>
      <p className="text-sm text-tinta-suave" aria-live="polite">
        {resumen}
      </p>
      <div className="flex gap-2">
        <Flecha destino={anterior} sentido="anterior" />
        <Flecha destino={siguiente} sentido="siguiente" />
      </div>
    </nav>
  );
}
