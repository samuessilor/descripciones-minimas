import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Insignia: dato corto que NO es el estado de la referencia (para eso esta `EstadoChip`).
 * Por eso no existe variante verde ni amarilla. Variantes: neutra · azul · contorno · oscura · error.
 */
const VARIANTES = {
  neutra: 'border-borde-suave bg-muted text-tinta',
  azul: 'border-azul-200 bg-azul-50 text-azul-800',
  contorno: 'border-borde-campo bg-superficie text-tinta',
  oscura: 'border-transparent bg-azul-700 text-white',
  error: 'border-error/50 bg-error-fondo text-error',
} as const;

export function Insignia({
  variante = 'neutra',
  icono,
  children,
  className,
}: {
  variante?: keyof typeof VARIANTES;
  icono?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex min-h-6 w-fit items-center gap-1 rounded-full border px-2.5 text-xs font-semibold leading-none',
        VARIANTES[variante],
        className,
      )}
    >
      {icono}
      {children}
    </span>
  );
}

/** Contador numerico (avisos sin leer, pendientes). `aria-label` obligatorio: el numero solo no dice que cuenta. */
export function Contador({ valor, etiquetaAria, className, max = 99 }: { valor: number; etiquetaAria: string; className?: string; max?: number }) {
  if (valor <= 0) return null;
  return (
    <span
      aria-label={etiquetaAria}
      role="img"
      className={cn(
        'inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-azul-700 px-1.5 text-xs font-bold leading-none text-white',
        className,
      )}
    >
      {valor > max ? `${max}+` : valor}
    </span>
  );
}

/** Tecla (atajos): `<Tecla>Ctrl</Tecla> + <Tecla>K</Tecla>`. */
export function Tecla({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-h-5 min-w-5 items-center justify-center rounded border border-borde-fuerte bg-superficie-2 px-1 font-sans text-xs font-semibold text-tinta-suave shadow-[0_1px_0_var(--borde-fuerte)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
