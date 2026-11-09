import { cn } from '@/lib/utils';

/** Quita la marca `[DESARROLLO]` de los usuarios de prueba para mostrar el nombre limpio. */
export function nombreVisible(nombre: string): string {
  return nombre.replace(/\[.*?\]/g, '').replace(/\s+/g, ' ').trim() || nombre;
}

export function iniciales(nombre: string): string {
  return nombreVisible(nombre)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Tonos del avatar: solo azules y grises (el amarillo y el verde son del estado). El tono sale del
 * nombre, asi la misma persona es siempre del mismo color en toda la aplicacion.
 */
const TONOS = [
  'bg-azul-700 text-white',
  'bg-azul-600 text-white',
  'bg-azul-900 text-white',
  'bg-azul-100 text-azul-900',
  'bg-azul-200 text-azul-900',
  'bg-[#3a4a63] text-white',
] as const;

function tonoDe(nombre: string): string {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return TONOS[h % TONOS.length]!;
}

const TAMANOS = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-12 text-base' } as const;

/** Circulo con iniciales. Es decorativo (`aria-hidden`): el nombre siempre va al lado como texto. */
export function Avatar({
  nombre,
  tamano = 'md',
  tono,
  className,
}: {
  nombre: string;
  tamano?: keyof typeof TAMANOS;
  /** Fuerza una clase de tono (p. ej. blanco sobre la barra azul). */
  tono?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold tracking-tight',
        TAMANOS[tamano],
        tono ?? tonoDe(nombreVisible(nombre)),
        className,
      )}
    >
      {iniciales(nombre) || '?'}
    </span>
  );
}

/** Persona + organizacion: «Brian · Agencia Magnum». La organizacion es parte de la confianza (quien es quien). */
export function Persona({
  nombre,
  organizacion,
  detalle,
  tamano = 'md',
  esExterno = false,
  className,
}: {
  nombre: string;
  organizacion?: string;
  /** Segunda linea opcional (rol, fecha, «tu»). */
  detalle?: string;
  tamano?: keyof typeof TAMANOS;
  /** Agencia de aduana: se marca con la palabra, no con un color. */
  esExterno?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2.5', className)}>
      <Avatar nombre={nombre} tamano={tamano} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-semibold text-tinta">{nombreVisible(nombre)}</span>
        {organizacion || detalle ? (
          <span className="block truncate text-sm text-tinta-suave">
            {[organizacion ? `${esExterno ? 'Agencia ' : ''}${organizacion}` : null, detalle].filter(Boolean).join(' · ')}
          </span>
        ) : null}
      </span>
    </span>
  );
}
