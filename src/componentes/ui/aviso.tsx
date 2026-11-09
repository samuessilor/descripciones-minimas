import { CircleAlert, Info, ShieldAlert, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Aviso en linea. Cuatro tonos, NINGUNO verde ni amarillo (son del estado):
 *  - `info`  azul: algo que conviene saber.
 *  - `exito` azul con check suelto (no el circulo-check del verde): algo salio bien.
 *  - `aviso` neutro con borde fuerte: precaucion que no es un error.
 *  - `error` rojo apagado (D-20): algo fallo o hay un dato invalido. Es el unico `role="alert"`.
 * Siempre icono + texto.
 */
export type TipoAviso = 'info' | 'exito' | 'aviso' | 'error';

const ESTILO: Record<TipoAviso, { caja: string; icono: typeof Info }> = {
  info: { caja: 'border-azul-300 bg-azul-50 text-azul-900', icono: Info },
  exito: { caja: 'border-azul-300 bg-azul-50 text-azul-900', icono: Check },
  aviso: { caja: 'border-borde-fuerte bg-superficie-2 text-tinta', icono: ShieldAlert },
  error: { caja: 'border-error/60 bg-error-fondo text-error', icono: CircleAlert },
};

export function Aviso({
  tipo = 'info',
  titulo,
  children,
  accion,
  className,
}: {
  tipo?: TipoAviso;
  titulo?: string;
  children?: ReactNode;
  /** Boton o enlace de salida («Reintentar»). Los errores siempre ofrecen una. */
  accion?: ReactNode;
  className?: string;
}) {
  const { caja, icono: Icono } = ESTILO[tipo];
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border px-3.5 py-3 text-sm', caja, className)}>
      <Icono aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        {titulo ? <p className="font-semibold">{titulo}</p> : null}
        {children ? <div className={cn(tipo === 'error' ? 'text-error' : 'text-inherit')}>{children}</div> : null}
        {accion ? <div className="pt-1">{accion}</div> : null}
      </div>
    </div>
  );
}
