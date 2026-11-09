import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * Logo de EssilorLuxottica (11.2). Los SVG de `public/marca/` vienen de un agregador de terceros y NO son
 * el kit oficial (PA-15): el wordmark es el real; lo pendiente es solo reemplazar el archivo.
 *
 * - `fondo="oscuro"` usa el wordmark BLANCO (barra superior, entrada). `fondo="claro"` el NEGRO.
 * - `variante="simbolo"` muestra las dos lentes (solo existe en negro: usarlo sobre fondo claro).
 * - Nunca se deforma (la relacion de aspecto sale del viewBox) ni se recolorea.
 * - Zona de respeto: deja libre, a cada lado, al menos la altura del logo (lo resuelven los
 *   contenedores donde se usa; ver docs/UI-GUIA.md).
 */
const WORDMARK = { ancho: 1550, alto: 169 } as const;
const SIMBOLO = { ancho: 1524, alto: 677 } as const;

export function Logo({
  fondo = 'oscuro',
  variante = 'wordmark',
  className,
  alto = 24,
}: {
  fondo?: 'oscuro' | 'claro';
  variante?: 'wordmark' | 'simbolo';
  className?: string;
  /** Alto en px del logo (24 en la barra de escritorio, 16-18 en movil). */
  alto?: number;
}) {
  const dim = variante === 'simbolo' ? SIMBOLO : WORDMARK;
  const src =
    variante === 'simbolo'
      ? '/marca/essilorluxottica-simbolo-negro.svg'
      : fondo === 'oscuro'
        ? '/marca/essilorluxottica-wordmark-blanco.svg'
        : '/marca/essilorluxottica-wordmark-negro.svg';
  const ancho = Math.round((alto * dim.ancho) / dim.alto);
  return (
    <Image
      src={src}
      alt="EssilorLuxottica"
      width={ancho}
      height={alto}
      unoptimized
      priority
      className={cn('block max-w-none select-none', className)}
      style={{ width: ancho, height: alto }}
    />
  );
}
