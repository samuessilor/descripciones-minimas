import { CircleAlert, Clock, MailX, ShieldCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Insignia } from '@/componentes/ui/insignia';
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/componentes/ui/tarjeta';
import { cn } from '@/lib/utils';
import { ROL_ETIQUETA, TIPO_ORG_ETIQUETA } from './formato';

/** Bloque con titulo: una tarjeta (nunca dentro de otra) con cabecera y cuerpo. */
export function Seccion({
  id,
  titulo,
  descripcion,
  acciones,
  children,
  className,
  sinPadding = false,
}: {
  id?: string;
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
  sinPadding?: boolean;
}) {
  return (
    <Tarjeta className={className} {...(id ? { id, 'aria-labelledby': `${id}-t` } : {})}>
      <TarjetaCabecera
        titulo={<span id={id ? `${id}-t` : undefined}>{titulo}</span>}
        {...(descripcion ? { descripcion } : {})}
        {...(acciones ? { acciones } : {})}
      />
      {sinPadding ? children : <TarjetaCuerpo>{children}</TarjetaCuerpo>}
    </Tarjeta>
  );
}

/** Lista de datos (etiqueta · valor), una columna en movil y dos desde 600 px. */
export function Datos({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('grid gap-x-8 gap-y-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]', className)}>{children}</dl>;
}

export function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-tinta-suave sm:pt-0.5">{etiqueta}</dt>
      <dd className="min-w-0 break-words text-base text-tinta">{children}</dd>
    </>
  );
}

export function InsigniaRol({ rol }: { rol: string }) {
  return <Insignia variante={rol === 'admin' ? 'oscura' : 'azul'}>{ROL_ETIQUETA[rol as keyof typeof ROL_ETIQUETA] ?? rol}</Insignia>;
}

export function InsigniaTipoOrg({ tipo }: { tipo: string }) {
  return <Insignia variante="contorno">{TIPO_ORG_ETIQUETA[tipo as keyof typeof TIPO_ORG_ETIQUETA] ?? tipo}</Insignia>;
}

/** Estado de una persona: siempre palabra + icono, nunca solo color. Pueden ir varias a la vez. */
export function EstadosUsuario({ activo, ultimoIngreso, correoInvalido }: { activo: boolean; ultimoIngreso: string | null; correoInvalido: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {!activo ? (
        <Insignia variante="neutra" icono={<UserX aria-hidden className="size-3" />}>
          Inactivo
        </Insignia>
      ) : ultimoIngreso === null ? (
        <Insignia variante="contorno" icono={<Clock aria-hidden className="size-3" />}>
          Sin ingresar
        </Insignia>
      ) : (
        <Insignia variante="azul" icono={<ShieldCheck aria-hidden className="size-3" />}>
          Activo
        </Insignia>
      )}
      {correoInvalido ? (
        <Insignia variante="error" icono={<MailX aria-hidden className="size-3" />}>
          Correo inválido
        </Insignia>
      ) : null}
    </span>
  );
}

/** Fila de «requiere atencion»: icono, que pasa, y la salida (un enlace a donde se resuelve). */
export function FilaAtencion({
  titulo,
  detalle,
  href,
  salida,
  grave = false,
}: {
  titulo: ReactNode;
  detalle?: ReactNode;
  href: string;
  salida: string;
  grave?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
      <span
        aria-hidden
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full border',
          grave ? 'border-error/40 bg-error-fondo text-error' : 'border-azul-200 bg-azul-50 text-azul-700',
        )}
      >
        <CircleAlert className="size-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1 basis-60">
        <p className="text-base font-semibold text-tinta">{titulo}</p>
        {detalle ? <p className="text-sm text-tinta-suave">{detalle}</p> : null}
      </div>
      <Link href={href} className="inline-flex min-h-10 items-center rounded-md border border-borde-campo bg-superficie px-3 text-sm font-semibold text-azul-700 hover:border-azul-700 hover:bg-azul-50">
        {salida}
      </Link>
    </li>
  );
}

/** Texto de una cifra grande con su etiqueta, para los resumenes (sin adornos). */
export function Cifra({ valor, etiqueta, className }: { valor: ReactNode; etiqueta: string; className?: string }) {
  return (
    <div className={className}>
      <p className="font-display text-3xl font-extrabold tabular-nums leading-none text-azul-900">{valor}</p>
      <p className="mt-1 text-sm text-tinta-suave">{etiqueta}</p>
    </div>
  );
}

/** Pestañas que son enlaces (el contenido cambia con la URL). La activa va en negrita y subrayada, con `aria-current`. */
export function PestanasEnlace({
  etiqueta,
  items,
  activa,
}: {
  etiqueta: string;
  items: ReadonlyArray<{ id: string; etiqueta: string; href: string; contador?: number }>;
  activa: string;
}) {
  return (
    <nav aria-label={etiqueta} className="mb-6">
      <ul className="flex flex-wrap gap-1.5">
        {items.map((it) => {
          const esActiva = it.id === activa;
          return (
            <li key={it.id}>
              <Link
                href={it.href}
                aria-current={esActiva ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-150',
                  esActiva
                    ? 'border-azul-700 bg-azul-700 font-bold text-white'
                    : 'border-borde-campo bg-superficie font-semibold text-tinta hover:border-azul-700 hover:bg-azul-50',
                )}
              >
                {it.etiqueta}
                {it.contador !== undefined ? (
                  <span className={cn('tabular-nums', esActiva ? 'text-azul-200' : 'text-tinta-suave')}>{it.contador}</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Desplegable nativo (`<details>`) para formularios de edicion en linea: sin JavaScript, con teclado y lector de pantalla. */
export function Desplegable({
  resumen,
  children,
  className,
  abierto = false,
  etiquetaAria,
}: {
  resumen: ReactNode;
  children: ReactNode;
  className?: string;
  abierto?: boolean;
  etiquetaAria?: string;
}) {
  return (
    <details open={abierto} className={cn('group w-fit max-w-full rounded-lg border border-borde-suave bg-superficie open:w-full', className)}>
      <summary
        aria-label={etiquetaAria}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-azul-700 hover:bg-azul-50 [&::-webkit-details-marker]:hidden"
      >
        {resumen}
      </summary>
      <div className="border-t border-borde-suave p-4">{children}</div>
    </details>
  );
}
