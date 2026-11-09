'use client';

import { Check, Landmark } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { avisarCambioDeFicha, EVENTO_FICHA_CAMBIADA } from '@/componentes/colaboracion/api';
import { EVENTO_PRESENCIA, presente } from '@/componentes/colaboracion/presencia';
import { pedirVistaAduana } from '@/componentes/ficha/api-cliente';
import { Estado } from '@/componentes/Estado';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { AnillosLente } from '@/componentes/ui/decoracion';
import { Esqueleto, EsqueletoZona } from '@/componentes/ui/esqueleto';
import type { VistaAduana } from '@/server/politicas/aduana';
import { cn } from '@/lib/utils';
import { BloqueCierre } from './BloqueCierre';
import { BloqueDescripciones } from './BloqueDescripciones';
import { BloquePartida } from './BloquePartida';
import { BloqueRestricciones } from './BloqueRestricciones';
import { diligenciado, sinTexto } from './comun';

const SONDEO_MS = 20_000;

/**
 * ZONA DE LA ADUANA: el cuarto bloque de la ficha. En el formato de la agencia lo amarillo es lo que completa la
 * aduana; aqui esa idea se conserva con una zona propia (cabecera azul profundo con las lentes de la marca) que se
 * lee de un vistazo como "esto lo hace la agencia": partida -> descripciones minimas adicionales (y la respuesta del
 * area) -> restricciones y observaciones -> cierre. El amarillo y el verde se reservan para el estado de la referencia.
 */
export function ZonaAduana({ referenciaId }: { referenciaId: string }) {
  const [vista, setVista] = useState<VistaAduana | null>(null);
  const [error, setError] = useState('');
  const [pulso, setPulso] = useState(false);
  const previo = useRef<VistaAduana | null>(null);

  const cargar = useCallback(
    async (silencioso = false) => {
      const r = await pedirVistaAduana(referenciaId);
      if (!r.ok) {
        if (!silencioso) setError(r.mensaje);
        return;
      }
      setError('');
      const antes = previo.current;
      if (antes && antes.estado !== 'CLASIFICADA' && r.data.estado === 'CLASIFICADA') setPulso(true);
      previo.current = r.data;
      // Cerrar, reabrir, archivar o guardar aqui cambia la ficha entera (sello, semaforo, solo lectura): se avisa
      // para que la cabecera y «Siguiente paso» no esperen al sondeo de la ficha.
      if (
        antes &&
        (antes.versionFicha !== r.data.versionFicha || antes.estado !== r.data.estado || antes.archivada !== r.data.archivada)
      ) {
        avisarCambioDeFicha(referenciaId);
      }
      setVista(r.data);
    },
    [referenciaId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  // Sondeo suave: si otra persona cambia algo, la zona se actualiza sin recargar (sin websockets, D-17).
  useEffect(() => {
    const t = setInterval(() => {
      if (presente()) void cargar(true);
    }, SONDEO_MS);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar(true);
    };
    // Restaurar un valor desde el historial (u otro cambio de la ficha) avisa con un evento: se vuelve a leer ya.
    // Si la lectura trae una version nueva, `cargar` vuelve a avisar y la siguiente lectura ya no cambia nada.
    const alCambiarFicha = (e: Event) => {
      if ((e as CustomEvent<{ referenciaId?: string }>).detail?.referenciaId === referenciaId) void cargar(true);
    };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener(EVENTO_PRESENCIA, alVolver);
    window.addEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener(EVENTO_PRESENCIA, alVolver);
      window.removeEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
    };
  }, [cargar, referenciaId]);

  const irA = useCallback((d: 'partida' | 'descripciones' | 'restricciones') => {
    const el = document.getElementById(`aduana-${d}`);
    if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const foco = el.querySelector<HTMLElement>('input, textarea, select, button');
    setTimeout(() => foco?.focus({ preventScroll: true }), 250);
  }, []);

  if (error && !vista) {
    return (
      <section id="zona-aduana" aria-label="Zona de la aduana" className="rounded-2xl border border-borde-suave bg-superficie p-5">
        <Aviso
          tipo="error"
          titulo="No pudimos cargar la zona de la aduana"
          accion={
            <Boton variante="secundario" tamano="sm" onClick={() => void cargar()}>
              Reintentar
            </Boton>
          }
        >
          {error}
        </Aviso>
      </section>
    );
  }

  if (!vista) {
    return (
      <section id="zona-aduana" aria-label="Zona de la aduana" className="overflow-hidden rounded-2xl border border-borde-suave bg-superficie">
        <EsqueletoZona etiqueta="Cargando la zona de la aduana…">
          <div className="space-y-3 bg-azul-900 px-6 py-6">
            <Esqueleto className="h-5 w-48 bg-white/15" />
            <Esqueleto className="h-4 w-80 max-w-full bg-white/10" />
          </div>
          <div className="space-y-4 p-6">
            <Esqueleto className="h-5 w-40" />
            <Esqueleto className="h-11 w-full" />
            <Esqueleto className="h-24 w-full" />
          </div>
        </EsqueletoZona>
      </section>
    );
  }

  const cerrada = vista.estado === 'CLASIFICADA';
  const partidaLista = !!vista.partida && sinTexto(vista.partida.valor) !== '';
  // «No aplica» cuenta como hecho; una solicitud sin respuesta del area, no.
  const descripcionesListas = diligenciado(vista.descripcionesMinimas?.valor) && !vista.solicitudPendiente;
  const restriccionesListas = diligenciado(vista.restricciones?.valor) && diligenciado(vista.observaciones?.valor);
  const pasos = [
    { id: 'aduana-partida', texto: 'Partida', hecho: partidaLista },
    { id: 'aduana-descripciones', texto: 'Descripciones adicionales', hecho: descripcionesListas },
    { id: 'aduana-restricciones', texto: 'Restricciones', hecho: restriccionesListas },
    { id: 'aduana-cierre', texto: 'Cierre', hecho: cerrada },
  ];

  const subtitulo = vista.permisos.editar
    ? 'Aquí clasificas: partida, descripciones mínimas adicionales, restricciones, observaciones y cierre. Todo queda con tu nombre y la fecha.'
    : cerrada
      ? 'La clasificación está cerrada. Esta zona es de solo lectura.'
      : 'Esta zona la completa la agencia de aduana. Si pide información adicional, te llega como pendiente y la respondes aquí.';

  const alCambiar = () => void cargar(true);

  return (
    <section id="zona-aduana" aria-labelledby="zona-aduana-titulo" className="isolate rounded-2xl border-2 border-aduana-borde bg-aduana-fondo shadow-suave" data-zona="aduana">
      <header className="superficie-oscura relative overflow-hidden rounded-t-2xl bg-azul-900 px-5 pb-5 pt-5 text-white sm:px-6">
        <AnillosLente className="absolute -right-24 -top-16 w-[30rem] max-w-none opacity-90" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-azul-200">
              <Landmark aria-hidden className="size-4" />
              <span aria-hidden className="size-3 rounded-sm bg-aduana-marca ring-1 ring-black/20" />
              Lo llena la aduana
            </p>
            <h2 id="zona-aduana-titulo" className="font-display text-2xl font-extrabold tracking-tight text-white">
              Zona de la aduana
            </h2>
            <p className="max-w-prose text-base text-azul-200">{subtitulo}</p>
          </div>
          <Estado
            color={vista.color}
            texto={vista.archivada ? 'Archivada' : cerrada ? 'Clasificada' : vista.reabierta ? 'Reabierta' : 'Pendiente'}
            tamano="lg"
            pulso={pulso}
            className="shrink-0"
          />
        </div>
        <nav aria-label="Pasos de la zona de la aduana" className="relative mt-5">
          <ol className="flex flex-wrap gap-2">
            {pasos.map((p) => (
              <li key={p.id}>
                <a
                  href={`#${p.id}`}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition-colors duration-150',
                    p.hecho ? 'border-white bg-white text-azul-900 hover:bg-azul-50' : 'border-azul-300/60 text-azul-100 hover:bg-white/10',
                  )}
                >
                  {p.hecho ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : <span aria-hidden className="size-2 rounded-full border border-azul-300" />}
                  {p.texto}
                  <span className="sr-solo">{p.hecho ? ' (listo)' : ' (pendiente)'}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div className="divide-y divide-borde-suave">
        {vista.bloqueo === 'borrador' ? (
          <div className="px-5 py-4 sm:px-6">
            <Aviso tipo="info">Esta referencia sigue en borrador. Cuando se envíe a la aduana se podrá clasificar.</Aviso>
          </div>
        ) : null}
        <Bloque id="aduana-partida">
          <BloquePartida vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque id="aduana-descripciones">
          <BloqueDescripciones vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque id="aduana-restricciones">
          <BloqueRestricciones vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque id="aduana-cierre" fondo>
          <BloqueCierre vista={vista} alCambiar={alCambiar} irA={irA} />
        </Bloque>
      </div>
    </section>
  );
}

function Bloque({ id, fondo = false, children }: { id: string; fondo?: boolean; children: ReactNode }) {
  return (
    <div id={id} className={cn('px-5 py-6 sm:px-6 sm:py-7', fondo && 'rounded-b-2xl bg-azul-50/60')}>
      {children}
    </div>
  );
}
