'use client';

import { Check, ChevronDown, Landmark } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { avisarCambioDeFicha, EVENTO_FICHA_CAMBIADA } from '@/componentes/colaboracion/api';
import { alVolverDePestana, EVENTO_PRESENCIA } from '@/componentes/colaboracion/presencia';
import { pedirVistaAduana } from '@/componentes/ficha/api-cliente';
import { EVENTO_CIERRE_CAMBIADO } from '@/componentes/ficha/cierre-aduana';
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
import { BloqueRim } from './BloqueRim';
import { diligenciado, sinTexto } from './comun';

/**
 * ZONA DE LA ADUANA: el cuarto bloque de la ficha. En el formato de la agencia lo amarillo es lo que completa la
 * aduana; aqui esa idea se conserva con una zona propia (cabecera azul profundo con las lentes de la marca) que se
 * lee de un vistazo como "esto lo hace la agencia": partida -> RIM (Sí/No) -> descripciones minimas adicionales (y la respuesta del
 * area) -> restricciones y observaciones -> cierre. El amarillo y el verde se reservan para el estado de la referencia.
 */
export function ZonaAduana({ referenciaId }: { referenciaId: string }) {
  const [vista, setVista] = useState<VistaAduana | null>(null);
  const [error, setError] = useState('');
  const [pulso, setPulso] = useState(false);
  const previo = useRef<VistaAduana | null>(null);

  const cargar = useCallback(
    async (silencioso = false, avisar = true) => {
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
      // para que la cabecera y «Siguiente paso» no esperen al sondeo de la ficha. Si la lectura la pidio ese mismo
      // aviso (`avisar = false`) no se repite: la ficha y los demas ya lo estan releyendo.
      if (
        avisar &&
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

  // Sin reloj propio (los tiempos de sondeo viven en sondeo.ts): si otra persona cambia algo, el sondeo de la ficha ve una
  // version nueva y avisa con `EVENTO_FICHA_CAMBIADA`; tambien se relee al volver a la pestana tras una ausencia y cuando
  // un guardado propio cambia lo que falta para cerrar (`EVENTO_CIERRE_CAMBIADO`).
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void cargar(true);
    };
    // Restaurar un valor desde el historial (u otro cambio de la ficha) avisa con un evento: se vuelve a leer ya.
    const alCambiarFicha = (e: Event) => {
      if ((e as CustomEvent<{ referenciaId?: string }>).detail?.referenciaId === referenciaId) void cargar(true, false);
    };
    const dejarDeEscuchar = alVolverDePestana(alVolver);
    window.addEventListener(EVENTO_PRESENCIA, alVolver);
    window.addEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
    // Un guardado propio de la ficha se aplica en local (no relee nada) pero movio lo que falta para cerrar: el resumen de
    // cierre de esta zona (advertencia A1) se calcula en el servidor, asi que se relee. Mismo manejo que un cambio de ficha.
    window.addEventListener(EVENTO_CIERRE_CAMBIADO, alCambiarFicha);
    return () => {
      dejarDeEscuchar();
      window.removeEventListener(EVENTO_PRESENCIA, alVolver);
      window.removeEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
      window.removeEventListener(EVENTO_CIERRE_CAMBIADO, alCambiarFicha);
    };
  }, [cargar, referenciaId]);

  // Bloques plegados por defecto (reunion 2026-11). Lo que la persona abre o cierra se conserva mientras no recargue:
  // el sondeo solo cambia `vista`, nunca este estado.
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const alternarBloque = useCallback((id: string, valor: boolean) => setAbiertos((a) => ({ ...a, [id]: valor })), []);

  // Abre un bloque, baja hasta el y, si se pide, le da el foco (un bloque plegado esta `hidden`: no se puede enfocar).
  const abrirBloque = useCallback((id: string, enfocar: boolean) => {
    setAbiertos((a) => (a[id] ? a : { ...a, [id]: true }));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        if (enfocar) el.querySelector<HTMLElement>('input, textarea, select, button:not([data-bloque-toggle])')?.focus({ preventScroll: true });
      }),
    );
  }, []);

  const irA = useCallback(
    (d: 'partida' | 'rim' | 'descripciones' | 'restricciones') => abrirBloque(`aduana-${d}`, true),
    [abrirBloque],
  );

  // Un enlace con ancla a un bloque (#aduana-partida) lo abre. La zona se carga despues de la pagina, asi que el
  // navegador no alcanza a bajar solo: se hace cuando la vista ya esta lista, y tambien si cambia el ancla.
  const listo = vista !== null;
  const anclaAplicada = useRef(false);
  useEffect(() => {
    const aplicar = () => {
      const ancla = window.location.hash.replace('#', '');
      if (ancla.startsWith('aduana-')) abrirBloque(ancla, false);
    };
    if (listo && !anclaAplicada.current) {
      anclaAplicada.current = true;
      aplicar();
    }
    window.addEventListener('hashchange', aplicar);
    return () => window.removeEventListener('hashchange', aplicar);
  }, [listo, abrirBloque]);

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
  const rimListo = vista.requiereRim?.valor === 'SI' || vista.requiereRim?.valor === 'NO';
  const descripcionesListas = diligenciado(vista.descripcionesMinimas?.valor) && !vista.solicitudPendiente;
  const restriccionesListas = diligenciado(vista.restricciones?.valor) && diligenciado(vista.observaciones?.valor);
  const pasos = [
    { id: 'aduana-partida', texto: 'Partida', hecho: partidaLista },
    { id: 'aduana-rim', texto: 'RIM', hecho: rimListo },
    { id: 'aduana-descripciones', texto: 'Descripciones adicionales', hecho: descripcionesListas },
    { id: 'aduana-restricciones', texto: 'Restricciones', hecho: restriccionesListas },
    { id: 'aduana-cierre', texto: 'Cierre', hecho: cerrada },
  ];

  const subtitulo = vista.permisos.editar
    ? 'Aquí clasificas: partida, RIM, descripciones mínimas adicionales, restricciones, observaciones y cierre. Todo queda con tu nombre y la fecha.'
    : cerrada
      ? 'La clasificación está cerrada. Esta zona es de solo lectura.'
      : 'Esta zona la completa la agencia de aduana. Si pide información adicional, te llega como pendiente y la respondes aquí.';

  const alCambiar = () => void cargar(true);

  // Encabezado de cada bloque: verde «Completa» o amarillo «Falta N» (el mismo lenguaje que las secciones de la ficha).
  const textoFalta = (n: number) => (n === 1 ? 'Falta 1' : `Faltan ${n}`);
  const plegado = (id: string, hecho: boolean, pendiente = 'Falta 1') => ({
    id,
    color: (hecho ? 'verde' : 'amarillo') as 'verde' | 'amarillo',
    estadoTexto: hecho ? 'Completa' : pendiente,
    abierto: abiertos[id] ?? false,
    onAlternar: (v: boolean) => alternarBloque(id, v),
  });

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
                  onClick={(e) => {
                    // Los bloques arrancan plegados: el atajo lo abre y baja hasta el.
                    e.preventDefault();
                    history.replaceState(null, '', `#${p.id}`);
                    abrirBloque(p.id, false);
                  }}
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
        <Bloque titulo="Partida arancelaria" {...plegado('aduana-partida', partidaLista)}>
          <BloquePartida vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque titulo="Registro de importación (RIM)" {...plegado('aduana-rim', rimListo)}>
          <BloqueRim vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque titulo="Descripciones mínimas adicionales" {...plegado('aduana-descripciones', descripcionesListas, vista.solicitudPendiente ? 'Pendiente del área' : 'Falta 1')}>
          <BloqueDescripciones vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque
          titulo="Restricciones y observaciones"
          {...plegado('aduana-restricciones', restriccionesListas, textoFalta((diligenciado(vista.restricciones?.valor) ? 0 : 1) + (diligenciado(vista.observaciones?.valor) ? 0 : 1)))}
        >
          <BloqueRestricciones vista={vista} alCambiar={alCambiar} />
        </Bloque>
        <Bloque titulo="Cierre de la clasificación" fondo {...plegado('aduana-cierre', cerrada, 'Falta cerrar')}>
          <BloqueCierre vista={vista} alCambiar={alCambiar} irA={irA} />
        </Bloque>
      </div>
    </section>
  );
}

/**
 * Bloque de la zona: plegable, con el titulo, el estado (verde «Completa» / amarillo «Falta N») y el chevron en un solo
 * boton (`aria-expanded`, teclado). Plegado queda `hidden`: no recibe foco ni se lee, pero sigue montado, asi que lo
 * que se estaba escribiendo no se pierde.
 */
function Bloque({
  id,
  titulo,
  color,
  estadoTexto,
  abierto,
  onAlternar,
  fondo = false,
  children,
}: {
  id: string;
  titulo: string;
  color: 'verde' | 'amarillo';
  estadoTexto: string;
  abierto: boolean;
  onAlternar: (abierto: boolean) => void;
  fondo?: boolean;
  children: ReactNode;
}) {
  const idTitulo = `${id}-titulo`;
  const idCuerpo = `${id}-cuerpo`;
  return (
    <div id={id} className={cn('scroll-mt-32', fondo && 'rounded-b-2xl bg-azul-50/60')}>
      <h3 className="m-0">
        <button
          type="button"
          data-bloque-toggle
          aria-expanded={abierto}
          aria-controls={idCuerpo}
          onClick={() => onAlternar(!abierto)}
          className={cn(
            'flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-left hover:bg-azul-50/70 focus-visible:outline-offset-[-3px] sm:px-6',
            fondo && !abierto && 'rounded-b-2xl',
          )}
        >
          <span id={idTitulo} className="min-w-0 flex-1 font-display text-lg font-extrabold leading-tight tracking-tight text-tinta">
            {titulo}
          </span>
          <Estado color={color} texto={estadoTexto} sinRol />
          <ChevronDown aria-hidden className={cn('size-5 shrink-0 text-tinta-suave transition-transform duration-200 ease-salida', abierto && 'rotate-180')} />
        </button>
      </h3>
      {/* El titulo ya esta en el boton de arriba: el del bloque queda solo para lectores de pantalla (y para su `aria-labelledby`). */}
      <div id={idCuerpo} hidden={!abierto} role="region" aria-labelledby={idTitulo} className="px-5 pb-7 pt-2 sm:px-6 [&_h3]:sr-solo">
        {children}
      </div>
    </div>
  );
}
