import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tabla de datos que NUNCA crece hacia los lados (A2, 10.3): desde 600 px es una tabla con columnas fijas
 * y pocas; por debajo se vuelve una lista de tarjetas. Una sola definicion de columnas alimenta ambas.
 *
 *   <TablaDatos etiqueta="Referencias" filas={filas} clave={(f) => f.id} hrefFila={(f) => `/referencias/${f.id}`}
 *     columnas={[
 *       { id: 'estado', encabezado: 'Estado', celda: (f) => <EstadoChip … /> },
 *       { id: 'codigo', encabezado: 'Referencia', principal: true, celda: (f) => f.codigo },
 *       { id: 'dias', encabezado: 'Dias', alinear: 'der', celda: (f) => f.dias },
 *     ]} />
 *
 * - `principal`: la celda con el enlace de la fila (toda la fila es clicable, pero hay UN solo enlace, asi
 *   el teclado y los lectores de pantalla no recorren 7 enlaces por fila). Si no marcas ninguna, es la 1.a.
 * - `ocultarBajo`: oculta una columna secundaria cuando el ANCHO DE LA TABLA (no el de la ventana: el menu
 *   lateral se come ~320 px) baja de `md` (672), `lg` (896) o `xl` (1152); en tarjeta siempre se ve. Si aun asi
 *   un dato largo no cabe, la tabla se desplaza hacia los lados en vez de recortar columnas.
 * - `tarjeta`: contenido propio de la tarjeta movil si el automatico no te sirve.
 * - Es un componente de servidor: no tiene estado ni eventos.
 */
export interface ColumnaTabla<T> {
  id: string;
  encabezado: ReactNode;
  celda: (fila: T) => ReactNode;
  principal?: boolean;
  alinear?: 'izq' | 'der';
  ocultarBajo?: 'md' | 'lg' | 'xl';
  /** Texto de la etiqueta en la tarjeta movil (por defecto, el encabezado si es texto). */
  etiquetaTarjeta?: string;
  /** Clases extra de la celda (anchos). */
  className?: string;
  /** En movil no se muestra la columna en la tarjeta. */
  noEnTarjeta?: boolean;
}

/** Clases literales (Tailwind solo genera las que ve escritas): 42rem, 56rem y 72rem de contenedor. */
const OCULTAR_BAJO = { md: '@max-2xl:hidden', lg: '@max-4xl:hidden', xl: '@max-6xl:hidden' } as const;

export function Tabla({ className, children }: { className?: string; children: ReactNode }) {
  return <table className={cn('w-full border-collapse text-left text-base', className)}>{children}</table>;
}

export function TablaDatos<T>({
  etiqueta,
  columnas,
  filas,
  clave,
  hrefFila,
  etiquetaEnlace,
  tarjeta,
  vacio,
  className,
}: {
  etiqueta: string;
  columnas: readonly ColumnaTabla<T>[];
  filas: readonly T[];
  clave: (fila: T) => string;
  hrefFila?: (fila: T) => string;
  /** Nombre accesible del enlace de la fila («Abrir NSR E1»). */
  etiquetaEnlace?: (fila: T) => string;
  tarjeta?: (fila: T) => ReactNode;
  vacio?: ReactNode;
  className?: string;
}) {
  if (filas.length === 0) return <>{vacio ?? null}</>;
  const iPrincipal = Math.max(
    columnas.findIndex((c) => c.principal),
    0,
  );
  // Container queries (`@container` abajo): mandan los px que tiene la tabla, no los de la ventana
  const oculta = (c: ColumnaTabla<T>) => (c.ocultarBajo ? OCULTAR_BAJO[c.ocultarBajo] : '');

  return (
    <div className={cn('@container', className)}>
      {/* Tabla: desde 600 px. `overflow-x-auto` y no `overflow-hidden`: si algo no cabe se desplaza, nunca se pierde */}
      <div className="overflow-x-auto rounded-xl border border-borde-suave bg-superficie shadow-suave max-sm:hidden">
        <table className="w-full border-collapse text-left text-base">
          <caption className="sr-solo">{etiqueta}</caption>
          <thead>
            <tr className="border-b border-borde-suave bg-superficie-2">
              {columnas.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn('whitespace-nowrap px-4 py-3 text-sm font-semibold text-tinta-suave', c.alinear === 'der' && 'text-right', oculta(c), c.className)}
                >
                  {c.encabezado}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const href = hrefFila?.(f);
              return (
                <tr
                  key={clave(f)}
                  className={cn('relative border-b border-borde-suave last:border-b-0', href && 'hover:bg-azul-50/70 focus-within:bg-azul-50/70')}
                >
                  {columnas.map((c, i) => {
                    const contenido = c.celda(f);
                    const esEnlace = href && i === iPrincipal;
                    return (
                      <td key={c.id} className={cn('px-4 py-3 align-middle', c.alinear === 'der' && 'text-right tabular-nums', oculta(c), c.className)}>
                        {esEnlace ? (
                          <Link
                            href={href}
                            aria-label={etiquetaEnlace?.(f)}
                            className="whitespace-nowrap font-semibold text-tinta after:absolute after:inset-0 after:content-[''] hover:text-azul-700 focus-visible:outline-offset-[-2px]"
                          >
                            {contenido}
                          </Link>
                        ) : (
                          contenido
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tarjetas: bajo 600 px */}
      <ul aria-label={etiqueta} className="space-y-2.5 sm:hidden">
        {filas.map((f) => {
          const href = hrefFila?.(f);
          const cuerpo = tarjeta ? (
            tarjeta(f)
          ) : (
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 break-words font-semibold text-tinta">{columnas[iPrincipal]?.celda(f)}</span>
                {columnas[0] && iPrincipal !== 0 ? <span className="shrink-0">{columnas[0].celda(f)}</span> : null}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {columnas.map((c, i) =>
                  i === iPrincipal || (i === 0 && iPrincipal !== 0) || c.noEnTarjeta ? null : (
                    <div key={c.id} className="contents">
                      <dt className="text-tinta-suave">{c.etiquetaTarjeta ?? (typeof c.encabezado === 'string' ? c.encabezado : c.id)}</dt>
                      <dd className="min-w-0 break-words text-tinta">{c.celda(f)}</dd>
                    </div>
                  ),
                )}
              </dl>
            </div>
          );
          return (
            <li key={clave(f)} className="relative rounded-xl border border-borde-suave bg-superficie p-4 shadow-suave active:bg-azul-50">
              {cuerpo}
              {href ? (
                <Link href={href} aria-label={etiquetaEnlace?.(f) ?? 'Abrir'} className="absolute inset-0 rounded-xl" />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
