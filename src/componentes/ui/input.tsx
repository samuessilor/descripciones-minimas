import type { InputHTMLAttributes, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Controles de texto. Bordes de 3:1 sobre blanco (`--borde-campo`), 44 px de alto, 16 px de letra.
 * Para etiqueta + ayuda + error usa `CampoFormulario`; estos son los controles pelados.
 * El error se marca con `aria-invalid="true"` (borde rojo + mensaje asociado por `aria-describedby`).
 */
export const baseControl = cn(
  'w-full rounded-md border border-borde-campo bg-superficie px-3 text-base text-tinta shadow-suave',
  'transition-[border-color,box-shadow] duration-150 ease-salida',
  'placeholder:text-tinta-suave/80 hover:border-azul-700',
  'disabled:cursor-not-allowed disabled:border-borde-fuerte disabled:bg-muted disabled:text-tinta-suave disabled:shadow-none',
  '[&:is(input,textarea):read-only]:bg-superficie-2',
  'aria-[invalid=true]:border-error aria-[invalid=true]:bg-error-fondo/40',
);

export function Campo({ className, ref, ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} className={cn(baseControl, 'min-h-11 py-2 max-sm:min-h-12', className)} {...props} />;
}

export function AreaTexto({
  className,
  ref,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  return <textarea ref={ref} className={cn(baseControl, 'min-h-24 resize-y py-2', className)} {...props} />;
}

/** `<select>` nativo con estilo (lista corta). Para listas largas con busqueda usa `Combobox`. */
export function Seleccion({
  className,
  ref,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { ref?: Ref<HTMLSelectElement> }) {
  return <select ref={ref} className={cn(baseControl, 'seleccion min-h-11 py-2 max-sm:min-h-12', className)} {...props} />;
}
