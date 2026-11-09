'use client';

import { Send, UserRound } from 'lucide-react';
import { Boton } from '@/componentes/ui/button';
import { nombreVisible } from '@/componentes/ui/avatar';
import type { Seccion } from '@/dominio/campos';
import { textoDias, type ParteFicha } from '@/dominio/colaboracion';
import { cn } from '@/lib/utils';
import type { ResponsableParte } from '@/server/politicas/tablero';

/**
 * Cabecera de una parte pendiente: de quien esta («Pendiente de Edgar · hace 2 días») o «Sin responsable», y el
 * atajo «Dejar pendiente a…» que abre «Enviar a» con esta seccion marcada. Una seccion completa no muestra nada.
 * La parte de la aduana usa el mismo banner y nombra tambien la agencia.
 */
export function PendienteDeSeccion({
  referenciaId,
  seccion,
  responsables,
  area = null,
  puedeEnviar,
  className,
}: {
  referenciaId: string;
  seccion: ParteFicha;
  responsables: readonly ResponsableParte[];
  /** Area responsable de la ficha: sin persona asignada, la seccion es de esa area (C1). */
  area?: string | null;
  puedeEnviar: boolean;
  className?: string;
}) {
  const esAduana = seccion === 'aduana';
  const quienes = responsables
    .map((r) => {
      const nombre = nombreVisible(r.nombre).split(' ')[0];
      return esAduana && r.organizacion ? `${nombre} (${r.organizacion})` : nombre;
    })
    .join(', ');
  const desde = responsables.reduce((max, r) => Math.max(max, r.dias), 0);
  return (
    <div
      className={cn(
        'mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-amarillo-borde bg-amarillo-fondo px-3.5 py-2.5',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm text-amarillo-texto" data-testid={`pendiente-de-${seccion}`}>
        <UserRound aria-hidden className="size-4 shrink-0" />
        {responsables.length > 0 ? (
          <span>
            <span className="font-semibold">Pendiente de {quienes}</span>
            {desde > 0 ? ` · desde hace ${textoDias(desde)}` : ' · desde hoy'}
          </span>
        ) : !esAduana && area ? (
          <span>
            <span className="font-semibold">Pendiente del área {area}</span> · la ve cualquiera del área en «Para mí»
          </span>
        ) : (
          <span className="font-semibold">
            {esAduana ? 'Sin agencia asignada: envíala a la aduana para que la clasifique' : 'Sin responsable: déjasela a quien deba llenarla'}
          </span>
        )}
      </p>
      {puedeEnviar ? (
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('dm:abrir-enviar-a', { detail: { referenciaId, secciones: (esAduana ? [] : [seccion]) satisfies Seccion[] } }),
            )
          }
        >
          <Send aria-hidden className="size-4" />
          Dejar pendiente a…
        </Boton>
      ) : null}
    </div>
  );
}
