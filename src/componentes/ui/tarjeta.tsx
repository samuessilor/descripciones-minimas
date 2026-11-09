'use client';

import { ChevronDown } from 'lucide-react';
import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Estado, type ColorEstado } from '../Estado';

/**
 * Tarjeta: superficie blanca con borde de 1 px (sin sombra; las secciones se separan con borde y espacio,
 * 11.5). No se anidan tarjetas.
 */
export function Tarjeta({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-borde-suave bg-superficie shadow-suave', className)} {...props}>
      {children}
    </div>
  );
}

export function TarjetaCabecera({ titulo, descripcion, acciones, className }: { titulo: ReactNode; descripcion?: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-borde-suave px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-tinta">{titulo}</h2>
        {descripcion ? <p className="mt-0.5 text-sm text-tinta-suave">{descripcion}</p> : null}
      </div>
      {acciones}
    </div>
  );
}

export function TarjetaCuerpo({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/**
 * Seccion de la ficha con semaforo propio (8.2, 10.2): numero grande, titulo, sello de estado y contador
 * («Faltan 3 de 8»). El encabezado es un boton que pliega/despliega. Por defecto arranca PLEGADA (reunion 2026-11:
 * «todos los desplegables contraidos para que se vea limpio»): el encabezado ya dice si esta completa (verde) o
 * cuanto falta (amarillo); quien llena abre la que tiene pendiente.
 *
 *   <SeccionFicha id="producto" numero={1} titulo="Producto" color="verde" estadoTexto="Completa">…</SeccionFicha>
 *   <SeccionFicha id="detalle"  numero={2} titulo="Detalle"  color="amarillo" estadoTexto="Faltan 3 de 8">…</SeccionFicha>
 *
 * Controlada (`abierta` + `onAlternar`) o no controlada (`defaultAbierta`). El contenido plegado queda
 * `hidden`, asi que no recibe foco ni se lee.
 */
export function SeccionFicha({
  id,
  numero,
  titulo,
  color,
  estadoTexto,
  etiquetaEstadoAria,
  resumen,
  abierta,
  defaultAbierta = false,
  onAlternar,
  plegable = true,
  pulso = false,
  children,
  className,
}: {
  id: string;
  numero: number;
  titulo: string;
  color: ColorEstado;
  estadoTexto: string;
  /** Lectura completa para lectores de pantalla: «Seccion Detalle: faltan 3 campos». */
  etiquetaEstadoAria?: string;
  /** Linea secundaria bajo el titulo («8 de 8 campos»). */
  resumen?: ReactNode;
  abierta?: boolean;
  defaultAbierta?: boolean;
  onAlternar?: (abierta: boolean) => void;
  plegable?: boolean;
  pulso?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const generado = useId().replace(/:/g, '');
  const [interna, setInterna] = useState(defaultAbierta);
  const esControlada = abierta !== undefined;
  // Una seccion que no se pliega siempre muestra su contenido.
  const visible = !plegable || (esControlada ? abierta : interna);
  const idTitulo = `${id}-titulo`;
  const idCuerpo = `${id}-cuerpo-${generado}`;

  function alternar() {
    const nueva = !visible;
    if (!esControlada) setInterna(nueva);
    onAlternar?.(nueva);
  }

  const cabecera = (
    <>
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-display text-lg font-extrabold',
          color === 'verde'
            ? 'border-verde-solido bg-verde-fondo text-verde-texto'
            : 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
        )}
      >
        {numero}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span id={idTitulo} className="block font-display text-xl font-extrabold leading-tight tracking-tight text-tinta">
          {titulo}
        </span>
        {resumen ? <span className="mt-0.5 block text-sm text-tinta-suave">{resumen}</span> : null}
      </span>
      {/* Bajo 640 px el sello baja a su propia linea: «La aduana pidio mas informacion» mide ~260 px y, en la misma
          fila, aplastaba el titulo a 0 px y ensanchaba la pagina (scroll lateral, pie fijo cortado) */}
      <span className="flex min-w-0 max-sm:order-last max-sm:basis-full sm:shrink-0">
        <Estado
          color={color}
          texto={estadoTexto}
          etiquetaAria={etiquetaEstadoAria}
          pulso={pulso}
          sinRol={plegable}
          className="max-sm:max-w-full max-sm:whitespace-normal max-sm:py-1 max-sm:leading-tight"
        />
      </span>
      {plegable ? (
        <ChevronDown
          aria-hidden
          className={cn('size-5 shrink-0 text-tinta-suave transition-transform duration-200 ease-salida', visible && 'rotate-180')}
        />
      ) : null}
    </>
  );

  return (
    <section id={id} aria-labelledby={idTitulo} className={cn('rounded-xl border border-borde-suave bg-superficie shadow-suave', className)}>
      {plegable ? (
        <h2 className="m-0">
          <button
            type="button"
            aria-expanded={visible}
            aria-controls={idCuerpo}
            onClick={alternar}
            className="flex w-full min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-xl px-4 py-3 text-left hover:bg-azul-50/60 sm:px-5"
          >
            {cabecera}
          </button>
        </h2>
      ) : (
        <h2 className="m-0 flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4 py-3 sm:px-5">{cabecera}</h2>
      )}
      <div id={idCuerpo} hidden={!visible} role="region" aria-labelledby={idTitulo} className="border-t border-borde-suave px-4 py-5 sm:px-5">
        {children}
      </div>
    </section>
  );
}
