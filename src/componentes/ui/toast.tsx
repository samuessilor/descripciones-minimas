'use client';

import { Check, CircleAlert, Info, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { mostrar, ocultar } from './flotante';

/**
 * Avisos efimeros (toast). Montado una vez en el layout raiz; en cualquier componente cliente:
 *
 *   const { avisar } = useAvisos();
 *   avisar({ tipo: 'exito', titulo: 'Enviamos el aviso a Brian' });
 *   avisar({ tipo: 'error', titulo: 'No pudimos enviar el aviso', descripcion: 'La referencia sigue guardada.',
 *            accion: { etiqueta: 'Reintentar', onClick: reintentar } });
 *
 * - Exito/info desaparecen solos (5 s). Los ERRORES NO desaparecen (11.5): hay que cerrarlos.
 * - Siempre ofrece una salida en los errores («Reintentar»).
 * - Lectores de pantalla: el texto se anuncia en una region viva aparte (exito/info `polite`,
 *   error `assertive`); el aviso visual no es una region viva para no repetirlo.
 * - Las tarjetas viven en la capa superior (popover) y se re-montan arriba en cada aviso, asi se ven
 *   incluso si hay un dialogo abierto (aunque, con el dialogo modal abierto, no se pueden pulsar:
 *   dentro de un dialogo muestra los errores en linea).
 */
export type TipoToast = 'exito' | 'info' | 'aviso' | 'error';

export interface OpcionesAviso {
  tipo?: TipoToast;
  titulo: string;
  descripcion?: string;
  accion?: { etiqueta: string; onClick?: () => void; href?: string };
  /** ms; `null` = no se cierra solo. Por defecto 5000 (6500 si hay accion) y `null` para errores. */
  duracion?: number | null;
}

interface Toast extends OpcionesAviso {
  id: number;
  tipo: TipoToast;
}

interface ApiAvisos {
  avisar: (o: OpcionesAviso) => number;
  descartar: (id: number) => void;
}

const Contexto = createContext<ApiAvisos | null>(null);

export function useAvisos(): ApiAvisos {
  const c = useContext(Contexto);
  if (!c) throw new Error('useAvisos necesita <ProveedorAvisos> (esta en el layout raiz).');
  return c;
}

const ICONO = { exito: Check, info: Info, aviso: ShieldAlert, error: CircleAlert } as const;
const COLOR = {
  exito: 'text-azul-700 bg-azul-50 border-azul-200',
  info: 'text-azul-700 bg-azul-50 border-azul-200',
  aviso: 'text-tinta bg-muted border-borde-fuerte',
  error: 'text-error bg-error-fondo border-error/40',
} as const;

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const [anuncio, setAnuncio] = useState<{ amable: string; urgente: string }>({ amable: '', urgente: '' });
  const siguiente = useRef(1);
  const region = useRef<HTMLDivElement | null>(null);
  const temporizadores = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const descartar = useCallback((id: number) => {
    const t = temporizadores.current.get(id);
    if (t) clearTimeout(t);
    temporizadores.current.delete(id);
    setLista((l) => l.filter((x) => x.id !== id));
  }, []);

  const avisar = useCallback(
    (o: OpcionesAviso) => {
      const id = siguiente.current++;
      const tipo = o.tipo ?? 'info';
      const duracion = o.duracion !== undefined ? o.duracion : tipo === 'error' ? null : o.accion ? 6500 : 5000;
      setLista((l) => [...l.slice(-3), { ...o, id, tipo }]);
      const texto = [o.titulo, o.descripcion].filter(Boolean).join('. ');
      setAnuncio((a) => (tipo === 'error' ? { ...a, urgente: `${texto}​${id}` } : { ...a, amable: `${texto}​${id}` }));
      if (duracion !== null) temporizadores.current.set(id, setTimeout(() => descartar(id), duracion));
      return id;
    },
    [descartar],
  );

  // La region vive en la capa superior; se vuelve a abrir en cada aviso para quedar encima de todo.
  useEffect(() => {
    const el = region.current;
    if (!el) return;
    if (lista.length > 0) {
      ocultar(el);
      mostrar(el);
    } else {
      ocultar(el);
    }
  }, [lista]);

  useEffect(() => {
    const mapa = temporizadores.current;
    return () => mapa.forEach((t) => clearTimeout(t));
  }, []);

  const api = useMemo(() => ({ avisar, descartar }), [avisar, descartar]);

  return (
    <Contexto.Provider value={api}>
      {children}
      <div className="sr-solo" role="status" aria-live="polite" aria-atomic="true">
        {anuncio.amable}
      </div>
      <div className="sr-solo" role="alert" aria-live="assertive" aria-atomic="true">
        {anuncio.urgente}
      </div>
      <div
        ref={region}
        popover="manual"
        aria-label="Avisos"
        role="region"
        className="flotante inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] w-auto max-w-none sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[26rem] lg:bottom-6 lg:right-6"
        data-listo=""
      >
        <ol className="flex flex-col gap-2">
          {lista.map((t) => {
            const Icono = ICONO[t.tipo];
            return (
              <li
                key={t.id}
                className={cn(
                  'flex animate-entrar-aviso items-start gap-3 rounded-xl border bg-superficie p-3.5 shadow-flotante',
                  t.tipo === 'error' ? 'border-error/50' : 'border-borde-suave',
                )}
              >
                <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border', COLOR[t.tipo])}>
                  <Icono aria-hidden className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold leading-snug text-tinta">{t.titulo}</p>
                  {t.descripcion ? <p className="mt-0.5 text-sm text-tinta-suave">{t.descripcion}</p> : null}
                  {t.accion ? (
                    t.accion.href ? (
                      <Link href={t.accion.href} onClick={() => descartar(t.id)} className="mt-1.5 inline-block text-sm font-semibold text-azul-500 underline underline-offset-2">
                        {t.accion.etiqueta}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          t.accion?.onClick?.();
                          descartar(t.id);
                        }}
                        className="mt-1.5 inline-flex min-h-8 items-center text-sm font-semibold text-azul-500 underline underline-offset-2"
                      >
                        {t.accion.etiqueta}
                      </button>
                    )
                  ) : null}
                </div>
                <button
                  type="button"
                  aria-label={`Cerrar aviso: ${t.titulo}`}
                  onClick={() => descartar(t.id)}
                  className="-mr-1 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-tinta-suave hover:bg-azul-50 hover:text-tinta"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </Contexto.Provider>
  );
}
