import { cn } from '@/lib/utils';

/**
 * Barra de progreso de la ficha: «9 de 17 campos». Es AZUL a proposito: el verde significa
 * «clasificada», y una ficha con todos los campos llenos todavia puede estar pendiente de la aduana.
 */
export function BarraProgreso({
  completados,
  total,
  etiqueta = 'campos',
  mostrarTexto = true,
  className,
}: {
  completados: number;
  total: number;
  /** Plural de lo que se cuenta: «campos», «datos». */
  etiqueta?: string;
  mostrarTexto?: boolean;
  className?: string;
}) {
  const t = Math.max(total, 0);
  const c = Math.min(Math.max(completados, 0), t);
  const pct = t === 0 ? 0 : Math.round((c / t) * 100);
  const texto = `${c} de ${t} ${etiqueta}`;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={`Avance: ${texto}`}
        aria-valuemin={0}
        aria-valuemax={t}
        aria-valuenow={c}
        aria-valuetext={texto}
        className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-azul-100"
      >
        <div
          className="h-full rounded-full bg-azul-600 transition-[width] duration-300 ease-salida"
          style={{ width: `${pct}%` }}
        />
      </div>
      {mostrarTexto ? <span className="shrink-0 text-sm font-semibold tabular-nums text-tinta-suave">{texto}</span> : null}
    </div>
  );
}
