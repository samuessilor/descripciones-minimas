import { cn } from '@/lib/utils';

/**
 * Firma visual de la aplicacion: anillos concentricos como el borde de una lente, muy tenues, sobre
 * superficies azules (entrada, cabecera de la ficha, estados vacios). Es decoracion pura (`aria-hidden`).
 * Dos lentes que se solapan citan, sin copiarlo, el simbolo de la marca.
 */
export function AnillosLente({ className, tono = 'claro' }: { className?: string; tono?: 'claro' | 'oscuro' }) {
  const trazo = tono === 'claro' ? '#ffffff' : '#0b2f6b';
  return (
    <svg
      aria-hidden
      focusable="false"
      viewBox="0 0 600 360"
      fill="none"
      className={cn('pointer-events-none select-none', className)}
    >
      <g stroke={trazo} strokeWidth="1.25">
        {[150, 122, 94, 66, 38].map((r, i) => (
          <circle key={`a${r}`} cx="190" cy="180" r={r} strokeOpacity={0.05 + i * 0.022} />
        ))}
        {[150, 122, 94, 66, 38].map((r, i) => (
          <circle key={`b${r}`} cx="410" cy="180" r={r} strokeOpacity={0.05 + i * 0.022} />
        ))}
      </g>
    </svg>
  );
}
