import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Etiqueta persistente, arriba del campo (nunca solo placeholder). Sentence case, sin mayusculas sostenidas. */
export function Etiqueta({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-semibold text-tinta', className)} {...props} />;
}
