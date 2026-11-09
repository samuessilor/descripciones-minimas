import { CircleCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * UN solo componente de estado para seccion, ficha, listado y bandeja (11.4). Solo dos colores:
 * amarillo = pendiente (triangulo con `!`), verde = completa/clasificada (circulo con check).
 * Nunca depende solo del color: lleva icono de forma distinta y palabra (A3, A10).
 *
 * Tamanos: `sm` (listados densos) · `md` (por defecto) · `lg` (sello de la cabecera de la ficha).
 * `grande` se conserva por compatibilidad y equivale a `tamano="lg"`.
 * `pulso`: el sello hace un pulso de 400 ms (solo al pasar a verde; respeta `prefers-reduced-motion`).
 * `sinRol`: quita `role="status"` (usalo en filas repetidas de un listado, donde la fila ya lee el texto).
 */
export type ColorEstado = 'amarillo' | 'verde';

const TAMANOS = {
  sm: { caja: 'min-h-6 gap-1 px-2.5 text-xs', icono: 'size-3.5' },
  md: { caja: 'min-h-7 gap-1.5 px-3 text-sm', icono: 'size-4' },
  lg: { caja: 'min-h-10 gap-2 px-4 text-base', icono: 'size-5' },
} as const;

export function Estado({
  color,
  texto,
  etiquetaAria,
  grande = false,
  tamano,
  pulso = false,
  sinRol = false,
  className,
}: {
  color: ColorEstado;
  texto: string;
  etiquetaAria?: string;
  grande?: boolean;
  tamano?: keyof typeof TAMANOS;
  pulso?: boolean;
  sinRol?: boolean;
  className?: string;
}) {
  const Icono = color === 'verde' ? CircleCheck : TriangleAlert;
  const t = TAMANOS[tamano ?? (grande ? 'lg' : 'md')];
  return (
    <span
      role={sinRol ? undefined : 'status'}
      aria-label={sinRol ? undefined : (etiquetaAria ?? texto)}
      data-estado={color}
      className={cn(
        'inline-flex w-fit items-center whitespace-nowrap rounded-full border font-semibold leading-none',
        t.caja,
        color === 'verde'
          ? 'border-verde-solido bg-verde-fondo text-verde-texto'
          : 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
        pulso && color === 'verde' && 'sello-pulso',
        className,
      )}
    >
      <Icono aria-hidden className={cn(t.icono, 'shrink-0')} strokeWidth={2.25} />
      {texto}
    </span>
  );
}
