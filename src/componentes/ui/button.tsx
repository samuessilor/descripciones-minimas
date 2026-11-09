import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ComponentProps, Ref } from 'react';
import { cn } from '@/lib/utils';

/**
 * Boton (estilo shadcn/ui). NINGUNO es verde ni amarillo: esos colores son del estado.
 * Un solo primario por vista. Alto 44 px (48 en movil); `sm` baja a 36 px con puntero fino.
 *
 * Variantes: primario · secundario · terciario (texto) · peligro · claro / fantasma-claro (sobre azul).
 */
export const botonVariantes = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-salida',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    '[&_svg]:shrink-0',
  ],
  {
    variants: {
      variante: {
        primario:
          'bg-azul-700 text-white shadow-suave hover:bg-azul-600 active:bg-azul-800 [box-shadow:inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(7_31_74/0.18)]',
        secundario:
          'border border-borde-campo bg-superficie text-azul-700 shadow-suave hover:border-azul-700 hover:bg-azul-50 active:bg-azul-100',
        terciario: 'text-azul-700 hover:bg-azul-50 active:bg-azul-100',
        peligro: 'border border-error bg-superficie text-error hover:bg-error-fondo',
        claro: 'bg-white text-azul-900 shadow-suave hover:bg-azul-50 active:bg-azul-100',
        'fantasma-claro': 'text-white hover:bg-white/10 active:bg-white/15',
      },
      tamano: {
        md: 'min-h-11 px-4 text-base max-sm:min-h-12',
        sm: 'min-h-9 px-3 text-sm pointer-coarse:min-h-11',
        lg: 'min-h-12 px-6 text-base',
        icono: 'size-11 p-0 max-sm:size-12',
        'icono-sm': 'size-9 p-0 pointer-coarse:size-11',
      },
    },
    defaultVariants: { variante: 'primario', tamano: 'md' },
  },
);

export interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof botonVariantes> {
  /** Muestra un indicador y bloquea el boton. Pon tambien un texto de "en curso" ("Guardando…"). */
  cargando?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Boton({ className, variante, tamano, type = 'button', cargando = false, disabled, children, ...props }: PropsBoton) {
  return (
    <button
      type={type}
      className={cn(botonVariantes({ variante, tamano }), className)}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...props}
    >
      {cargando ? <LoaderCircle aria-hidden className="size-4 animate-girar" /> : null}
      {children}
    </button>
  );
}

/** Enlace con apariencia de boton (navegacion que parece accion: «Nueva referencia»). */
export function EnlaceBoton({
  className,
  variante,
  tamano,
  ...props
}: ComponentProps<typeof Link> & VariantProps<typeof botonVariantes> & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <Link className={cn(botonVariantes({ variante, tamano }), className)} {...props} />;
}
