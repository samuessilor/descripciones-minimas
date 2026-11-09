import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AnillosLente } from './decoracion';

/**
 * Estado vacio que ENSENA la pantalla (no un «nada por aqui»): icono sobre anillos de lente, titulo,
 * una frase que dice que va a aparecer y una accion clara. Textos tipicos en 10.3:
 *   «Estas al dia. No tienes referencias pendientes.» · «Aun no hay referencias. Crea la primera y empezamos la base.»
 */
export function EstadoVacio({
  icono: Icono,
  titulo,
  descripcion,
  accion,
  compacto = false,
  className,
}: {
  icono?: LucideIcon;
  titulo: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
  compacto?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center overflow-hidden rounded-xl border border-dashed border-borde-fuerte bg-superficie px-6 text-center',
        compacto ? 'gap-2 py-8' : 'gap-3 py-14',
        className,
      )}
    >
      <AnillosLente tono="oscuro" className="absolute left-1/2 top-1/2 w-[34rem] max-w-none -translate-x-1/2 -translate-y-1/2 opacity-[0.55]" />
      {Icono ? (
        <span className="relative flex size-12 items-center justify-center rounded-full border border-azul-200 bg-azul-50 text-azul-700">
          <Icono aria-hidden className="size-6" strokeWidth={1.75} />
        </span>
      ) : null}
      <h2 className="relative text-lg font-bold text-tinta">{titulo}</h2>
      {descripcion ? <div className="relative max-w-md space-y-2 text-base text-tinta-suave">{descripcion}</div> : null}
      {accion ? <div className="relative mt-2 flex flex-wrap justify-center gap-3">{accion}</div> : null}
    </div>
  );
}
