'use client';

import { Bell, BellOff, CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { marcarNotificacionLeidaAccion, marcarTodasLeidasAccion } from '@/app/acciones/colaboracion';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { EsqueletoFilas } from '@/componentes/ui/esqueleto';
import { Popover, useCerrarPopover } from '@/componentes/ui/popover';
import { tituloSinMarca } from '@/dominio/colaboracion';
import { cn } from '@/lib/utils';
import type { ListaNotificaciones, NotificacionVista } from '@/server/politicas/colaboracion';
import { EVENTO_AVISOS_LEIDOS, EVENTO_AVISOS_NUEVOS, hace, leerUnaVez, MARGEN_ORDEN_MS } from './api';
import { IconoAviso } from './piezas';
import { alVolverDePestana, EVENTO_PRESENCIA, sondearConBackoff } from './presencia';
import { OCULTA_MIN_MS, SONDEO } from './sondeo';

const SONDEO_MS = SONDEO.campana;

/**
 * Campana de la barra superior: contador de no leidas, desplegable con las ultimas, marcar leidas y
 * enlace a la pagina completa. Se actualiza por sondeo (cada `SONDEO.campana` mientras la pestana esta visible y en uso, y al
 * volver a ella tras una ausencia): sin websockets, que Vercel no sostiene. Si hay mas de una campana en pantalla (barra de escritorio y de
 * movil) comparten la lectura. Cuando llegan avisos nuevos avisa a Inicio para que renueve sus listas. Sobre fondo
 * OSCURO (barra azul).
 */
export function CampanaCliente() {
  const [datos, setDatos] = useState<ListaNotificaciones | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const [, setLatido] = useState(0);
  const previo = useRef<number | null>(null);
  /** Huella de lo ultimo leido y cuando se leyo: el sondeo la usa para saber si hubo cambios y el foco para no releer de mas. */
  const huella = useRef('');
  const ultimaLectura = useRef(0);

  /** Devuelve `true` si lo leido cambio respecto a la lectura anterior (el backoff del sondeo lo necesita). */
  const cargar = useCallback(async (reloj = false): Promise<boolean> => {
    const url = '/api/colaboracion/notificaciones?limite=8';
    ultimaLectura.current = Date.now();
    const r = reloj ? await leerUnaVez<ListaNotificaciones>(url, Math.round(SONDEO_MS * 0.7)) : await leerUnaVez<ListaNotificaciones>(url, 500, Date.now() - MARGEN_ORDEN_MS);
    if (!r.ok) {
      if (r.mensaje) setError(r.mensaje);
      return false;
    }
    const nueva = JSON.stringify(r.data);
    const cambio = nueva !== huella.current;
    huella.current = nueva;
    setError(null);
    setDatos(r.data);
    setLatido((n) => n + 1);
    const antes = previo.current;
    if (antes !== null && r.data.noLeidas > antes) {
      const nuevos = r.data.noLeidas - antes;
      setAnuncio(nuevos === 1 ? 'Tienes un aviso nuevo.' : `Tienes ${nuevos} avisos nuevos.`);
      window.dispatchEvent(new Event(EVENTO_AVISOS_NUEVOS));
    }
    previo.current = r.data.noLeidas;
    return cambio;
  }, []);

  useEffect(() => {
    // La primera lectura corre fuera del cuerpo del efecto para no encadenar renders sincronos.
    const inicio = setTimeout(() => void cargar(), 0);
    const detenerSondeo = sondearConBackoff(SONDEO_MS, () => cargar(true));
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar();
    };
    // Cambiar de ventana o de pestana un instante no consulta: solo tras una ausencia de mas de `OCULTA_MIN_MS`.
    const alEnfocar = () => {
      if (Date.now() - ultimaLectura.current > OCULTA_MIN_MS) alVolver();
    };
    const dejarDeEscuchar = alVolverDePestana(alVolver);
    window.addEventListener('focus', alEnfocar);
    window.addEventListener(EVENTO_PRESENCIA, alVolver);
    // Marcar avisos como leidos en la pagina de notificaciones: recontar ya, o `previo` quedaria alto y un aviso nuevo
    // posterior no se anunciaria.
    const alLeer = () => void cargar();
    window.addEventListener(EVENTO_AVISOS_LEIDOS, alLeer);
    return () => {
      clearTimeout(inicio);
      detenerSondeo();
      dejarDeEscuchar();
      window.removeEventListener('focus', alEnfocar);
      window.removeEventListener(EVENTO_PRESENCIA, alVolver);
      window.removeEventListener(EVENTO_AVISOS_LEIDOS, alLeer);
    };
  }, [cargar]);

  const noLeidas = datos?.noLeidas ?? 0;
  const etiqueta = noLeidas > 0 ? `Notificaciones, ${noLeidas} sin leer` : 'Notificaciones';

  return (
    <>
      <Popover
        etiqueta="Notificaciones"
        alinear="fin"
        enfocar="panel"
        className="w-[min(23.5rem,calc(100vw-1rem))] overflow-hidden p-0"
        onCambio={(abierto) => {
          if (abierto) void cargar();
        }}
        disparador={(p) => (
          <Boton {...p} variante="fantasma-claro" tamano="icono" aria-label={etiqueta} className="relative">
            <Bell aria-hidden className="size-5" />
            {noLeidas > 0 ? (
              <span
                aria-hidden
                data-testid="contador-campana"
                className="absolute right-0.5 top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[0.6875rem] font-bold leading-none text-azul-900 ring-2 ring-azul-900"
              >
                {noLeidas > 99 ? '99+' : noLeidas}
              </span>
            ) : null}
          </Boton>
        )}
      >
        {({ cerrar }) => (
          <PanelCampana
            datos={datos}
            error={error}
            alMarcarTodas={async () => {
              const r = await marcarTodasLeidasAccion();
              if (r.ok) {
                setDatos((d) => (d ? { ...d, noLeidas: 0, items: d.items.map((i) => ({ ...i, leidaEn: i.leidaEn ?? new Date().toISOString() })) } : d));
                previo.current = 0;
              } else {
                setError(r.mensaje);
              }
            }}
            alAbrir={(n) => {
              if (!n.leidaEn) {
                setDatos((d) =>
                  d
                    ? {
                        ...d,
                        noLeidas: Math.max(0, d.noLeidas - 1),
                        items: d.items.map((i) => (i.id === n.id ? { ...i, leidaEn: new Date().toISOString() } : i)),
                      }
                    : d,
                );
                previo.current = Math.max(0, (previo.current ?? 1) - 1);
                void marcarNotificacionLeidaAccion({ notificacionId: n.id });
              }
              cerrar();
            }}
            reintentar={() => void cargar()}
          />
        )}
      </Popover>
      <div className="sr-solo" role="status" aria-live="polite" aria-atomic="true">
        {anuncio}
      </div>
    </>
  );
}

function PanelCampana({
  datos,
  error,
  alMarcarTodas,
  alAbrir,
  reintentar,
}: {
  datos: ListaNotificaciones | null;
  error: string | null;
  alMarcarTodas: () => Promise<void>;
  alAbrir: (n: NotificacionVista) => void;
  reintentar: () => void;
}) {
  const cerrar = useCerrarPopover();
  const [marcando, setMarcando] = useState(false);
  const ahora = new Date();
  const hayNoLeidas = (datos?.noLeidas ?? 0) > 0;

  return (
    <div className="flex max-h-[min(34rem,calc(100dvh-5rem))] flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-borde-suave px-4 py-3">
        <h2 className="font-display text-base font-extrabold text-tinta">Notificaciones</h2>
        <Boton
          variante="terciario"
          tamano="sm"
          disabled={!hayNoLeidas}
          cargando={marcando}
          onClick={async () => {
            setMarcando(true);
            await alMarcarTodas();
            setMarcando(false);
          }}
          className="-mr-2"
        >
          <CheckCheck aria-hidden className="size-4" />
          Marcar todas como leídas
        </Boton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && !datos ? (
          <div className="p-4">
            <Aviso
              tipo="error"
              titulo="No pudimos cargar tus avisos"
              accion={
                <Boton variante="secundario" tamano="sm" onClick={reintentar}>
                  Reintentar
                </Boton>
              }
            >
              {error}
            </Aviso>
          </div>
        ) : !datos ? (
          <div className="p-3">
            <EsqueletoFilas filas={3} />
          </div>
        ) : datos.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full border border-azul-200 bg-azul-50 text-azul-700">
              <BellOff aria-hidden className="size-6" strokeWidth={1.75} />
            </span>
            <p className="font-semibold text-tinta">No tienes avisos nuevos.</p>
            <p className="text-sm text-tinta-suave">Cuando alguien te envíe una referencia, el aviso aparece aquí.</p>
          </div>
        ) : (
          <>
            {!hayNoLeidas ? <p className="px-4 pt-3 text-sm font-semibold text-tinta">No tienes avisos nuevos.</p> : null}
            <ul className="p-1.5">
              {datos.items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => alAbrir(n)}
                    className={cn(
                      'flex items-start gap-3 rounded-lg px-2.5 py-2.5 hover:bg-azul-50 focus-visible:bg-azul-50',
                      !n.leidaEn && 'bg-azul-50/60',
                    )}
                  >
                    <IconoAviso tipo={n.tipo} noLeida={!n.leidaEn} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm leading-snug text-tinta', !n.leidaEn && 'font-semibold')}>
                        {!n.leidaEn ? <span className="sr-solo">Nueva: </span> : null}
                        {tituloSinMarca(n.titulo)}
                      </span>
                      <span className="mt-0.5 block text-xs text-tinta-suave">{hace(n.creadaEn, ahora)}</span>
                    </span>
                    {!n.leidaEn ? <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-azul-500" /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="border-t border-borde-suave bg-superficie-2 px-4 py-2.5">
        <Link
          href="/notificaciones"
          onClick={cerrar}
          className="flex min-h-9 items-center justify-center rounded-md text-sm font-semibold text-azul-700 hover:bg-azul-50"
        >
          Ver todas
        </Link>
      </div>
    </div>
  );
}
