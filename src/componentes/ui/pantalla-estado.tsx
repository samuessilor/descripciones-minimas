import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AnillosLente } from './decoracion';

/**
 * Pantalla de estado a pagina completa o dentro del armazon: error, 404, sin permiso, sesion vencida.
 * Estructura fija (10.6): QUE paso en una frase, POR QUE si ayuda, y una SALIDA (boton). Nunca culpa al
 * usuario ni muestra codigos. `compacto` la deja dentro del contenido (con el armazon visible);
 * sin el, ocupa la ventana (errores fuera del armazon).
 */
export function PantallaEstado({
  icono: Icono = CircleAlert,
  titulo,
  children,
  acciones,
  detalle,
  compacto = false,
  className,
}: {
  icono?: LucideIcon;
  titulo: string;
  children?: ReactNode;
  acciones?: ReactNode;
  /** Texto tecnico plegado (digest del error). */
  detalle?: string;
  compacto?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'relative isolate mx-auto flex w-full max-w-xl flex-col items-center overflow-hidden text-center',
        compacto ? 'px-4 py-12 sm:py-16' : 'min-h-dvh justify-center px-6 py-16',
        className,
      )}
    >
      <AnillosLente tono="oscuro" className="absolute left-1/2 top-1/2 -z-10 w-[44rem] max-w-none -translate-x-1/2 -translate-y-1/2" />
      <span className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-azul-200 bg-azul-50 text-azul-700 shadow-suave">
        <Icono aria-hidden className="size-8" strokeWidth={1.6} />
      </span>
      <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta">{titulo}</h1>
      {children ? <div className="mt-2 max-w-[46ch] space-y-2 text-base text-tinta-suave">{children}</div> : null}
      {acciones ? <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{acciones}</div> : null}
      {detalle ? (
        <details className="mt-6 text-sm text-tinta-suave">
          <summary className="cursor-pointer rounded px-2 py-1 font-semibold hover:text-tinta">Detalle técnico</summary>
          <p className="mt-1 font-mono text-xs">{detalle}</p>
        </details>
      ) : null}
    </section>
  );
}
