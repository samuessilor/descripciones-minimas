import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Esqueleto de carga: misma altura que el contenido final (sin saltos), brillo suave que se apaga con
 * `prefers-reduced-motion`. Un solo indicador de carga por zona. `aria-hidden`: anuncia la carga con
 * `EsqueletoZona` (un unico `role="status"`).
 */
export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={cn('esqueleto h-4 w-full', className)} />;
}

export function EsqueletoZona({ etiqueta = 'Cargando…', children, className }: { etiqueta?: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-solo">{etiqueta}</span>
      {children}
    </div>
  );
}

/** Filas de listado en carga (3 por defecto, 10.3). */
export function EsqueletoFilas({ filas = 3, className }: { filas?: number; className?: string }) {
  return (
    <EsqueletoZona className={cn('space-y-2', className)}>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border border-borde-suave bg-superficie p-4">
          <Esqueleto className="h-6 w-24 rounded-full" />
          <Esqueleto className="h-4 w-24" />
          <Esqueleto className="h-4 flex-1" />
          <Esqueleto className="hidden h-4 w-20 sm:block" />
        </div>
      ))}
    </EsqueletoZona>
  );
}
