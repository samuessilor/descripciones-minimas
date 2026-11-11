'use client';

import { Copy, EllipsisVertical, Lock, Pencil, Trash2, TriangleAlert, CircleCheck, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { eliminarReferenciaAccion } from '@/app/acciones/ficha';
import { avisarCambioDeFicha, avisarCampoGuardado, EVENTO_FICHA_CAMBIADA } from '@/componentes/colaboracion/api';
import { alVolverDePestana, EVENTO_PRESENCIA, sondearConBackoff } from '@/componentes/colaboracion/presencia';
import { SONDEO } from '@/componentes/colaboracion/sondeo';
import { Estado } from '@/componentes/Estado';
import { PanelActividad } from '@/componentes/slots/PanelActividad';
import { BotonEnviarA } from '@/componentes/slots/BotonEnviarA';
import { SeccionAduana } from '@/componentes/slots/SeccionAduana';
import { Aviso } from '@/componentes/ui/aviso';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { AnillosLente } from '@/componentes/ui/decoracion';
import { DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { useAvisos } from '@/componentes/ui/toast';
import { ItemMenu, MenuDesplegable } from '@/componentes/ui/menu-desplegable';
import { Migas } from '@/componentes/ui/pagina';
import { SeccionFicha } from '@/componentes/ui/tarjeta';
import type { ResponsablesPorParte } from '@/server/politicas/tablero';
import { AvisoDesignarAduana } from './AvisoDesignarAduana';
import { PendienteDeSeccion } from './PendienteDeSeccion';
import {
  CAMPOS,
  ETIQUETA_SECCION,
  ETIQUETA_TIPO,
  SECCIONES,
  aplicaEnFicha,
  esVisible,
  type CampoDef,
  type Seccion,
  type TipoProducto,
} from '@/dominio/campos';
import type { Pais } from '@/dominio/paises';
import { puede, puedeEscribirCampo, type ActorLike } from '@/dominio/permisos';
import { estaVacio } from '@/dominio/valores';
import { esArea } from '@/dominio/areas';
import { cn } from '@/lib/utils';
import type { AdjuntoVista } from '@/server/acciones/adjuntos';
import type { EstadoFicha as EstadoSondeo } from '@/server/acciones/estado-ficha';
import type { FichaVista } from '@/server/politicas/referencias';
import { CampoFicha, FASES_PENDIENTES, type FaseCampo, type OpcionesCatalogo } from './CampoFicha';
import { CorregirCodigo } from './CorregirCodigo';
import { pedirEstado, pedirFicha } from './api-cliente';
import { avisarCierreCambiado, cambiaElResumenDeCierre, PAUSA_AVISO_CIERRE_MS } from './cierre-aduana';
import { aplicarGuardado, type GuardadoCampo } from './guardado-local';
import { FotosFicha } from './FotosFicha';
import { SiguientePaso } from './SiguientePaso';

const SONDEO_MS = SONDEO.estadoFicha;

/**
 * Cuando un guardado no se puede aplicar en pantalla solo (alguien mas escribio, o toca una columna que mantiene el
 * servidor), la ficha se relee tras esta pausa: una rafaga de guardados seguidos pide UNA lectura, no una por campo.
 */
const PAUSA_REFRESCO_MS = 1_500;

/** Campos que la ficha no pinta como campo de formulario (van en la cabecera, en su propio bloque o los calcula el sistema). */
const NO_ES_CAMPO: ReadonlySet<string> = new Set(['calculado', 'codigo']);

export interface ActorFicha extends ActorLike {
  /** Id de quien creo la referencia (la fecha de solicitud se corrige solo mientras es borrador). */
  creadaPorId: string;
}

const ICONO_SECCION = { amarillo: TriangleAlert, verde: CircleCheck } as const;

export function FichaFormulario({
  inicial,
  adjuntosIniciales,
  fotosActivas,
  actor,
  catalogos,
  paises,
  responsables,
}: {
  inicial: FichaVista;
  adjuntosIniciales: AdjuntoVista[];
  /** Falso en produccion mientras no exista el almacen de fotos: el bloque «Foto» no se muestra. */
  fotosActivas: boolean;
  actor: ActorFicha;
  catalogos: OpcionesCatalogo;
  paises: readonly Pais[];
  /** Quien tiene pendiente cada parte (asignaciones activas). */
  responsables: ResponsablesPorParte;
}) {
  const [ficha, setFicha] = useState(inicial);
  const [adjuntos, setAdjuntos] = useState(adjuntosIniciales);
  const [editando, setEditando] = useState<EstadoSondeo['editando']>([]);
  const [problemaSondeo, setProblemaSondeo] = useState<'sesion' | 'red' | null>(null);
  const [fases, setFases] = useState<Record<string, { fase: FaseCampo; etiqueta: string }>>({});
  // Todas las secciones arrancan plegadas (reunion 2026-11: «que se vea limpio»). Lo que la persona abre o cierra a mano se
  // conserva mientras no recargue: los refrescos por sondeo cambian `ficha`, nunca este estado. Excepcion: una ficha
  // borrador recien creada, sin ningun campo lleno, abre Producto; un enlace con ancla abre su seccion (efecto de abajo).
  const [manual, setManual] = useState<Partial<Record<Seccion, boolean>>>(() => (esBorradorVirgen(inicial) ? { producto: true } : {}));
  const abiertas = Object.fromEntries(SECCIONES.map((s) => [s, manual[s] ?? false])) as Record<Seccion, boolean>;
  const setAbiertas = (fn: (a: Record<Seccion, boolean>) => Record<Seccion, boolean>) => setManual(fn(abiertas));
  const [activa, setActiva] = useState<Seccion>('producto');
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const router = useRouter();
  const { avisar } = useAvisos();
  const [ultimoGuardado, setUltimoGuardado] = useState<number | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const versionConocida = useRef(inicial.version);
  // Espejo de `ficha` para decidir un guardado sin esperar al siguiente render (dos guardados seguidos).
  const fichaRef = useRef(ficha);
  useEffect(() => {
    fichaRef.current = ficha;
  });
  const temporizadorRefresco = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporizadorCierre = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tipo = ficha.tipoProducto;
  const cerrada = ficha.estado === 'CLASIFICADA' || ficha.archivada;

  // ---- Refresco de la ficha (semaforo, progreso, valores ajenos) -------------------------------------
  const refrescar = useCallback(async () => {
    const r = await pedirFicha(inicial.id).catch(() => null);
    // Una respuesta anterior a un guardado propio ya aplicado en pantalla es vieja: pisaria lo mas nuevo.
    if (r?.ok && r.data.ficha.version >= versionConocida.current) {
      versionConocida.current = r.data.ficha.version;
      setFicha(r.data.ficha);
      setAdjuntos(r.data.adjuntos);
    }
  }, [inicial.id]);

  /**
   * Un campo se guardo. Si la respuesta basta (nadie mas escribio y el campo no toca nada que calcule solo el servidor)
   * se aplica aqui, sin pedir la ficha otra vez. Si no (o si no hay respuesta que aplicar), se relee tras una pausa
   * avisando a toda la pantalla (`EVENTO_FICHA_CAMBIADA`): ficha, quien puso cada campo, zona de la aduana.
   * Si se aplica aqui, la zona de la aduana (sin reloj) no se entera: se le avisa aparte, y solo si el guardado cambio
   * lo que falta para cerrar (ver `cierre-aduana.ts`).
   */
  const alGuardar = useCallback(
    (guardado?: GuardadoCampo) => {
      setUltimoGuardado(Date.now());
      if (guardado) {
        // El resumen «quien lo puso y cuantas versiones» se actualiza en el acto, vaya o no vaya a releerse la ficha.
        avisarCampoGuardado({ referenciaId: inicial.id, campo: guardado.campo, version: guardado.version, vacio: estaVacio(guardado.valor) });
        const nueva = aplicarGuardado(fichaRef.current, versionConocida.current, guardado);
        if (nueva) {
          if (cambiaElResumenDeCierre(fichaRef.current.completitud, nueva.completitud)) {
            if (temporizadorCierre.current) clearTimeout(temporizadorCierre.current);
            temporizadorCierre.current = setTimeout(() => avisarCierreCambiado(inicial.id), PAUSA_AVISO_CIERRE_MS);
          }
          fichaRef.current = nueva;
          versionConocida.current = nueva.version;
          setFicha(nueva);
          return;
        }
      }
      if (temporizadorRefresco.current) clearTimeout(temporizadorRefresco.current);
      temporizadorRefresco.current = setTimeout(() => avisarCambioDeFicha(inicial.id), PAUSA_REFRESCO_MS);
    },
    [inicial.id],
  );

  // ---- Sondeo (D-17): quien esta escribiendo y si cambio la version (intervalo: SONDEO.estadoFicha) -----------
  useEffect(() => {
    let vivo = true;
    /** Devuelve `true` si la version cambio (el backoff vuelve al ritmo base). */
    const tick = async (): Promise<boolean> => {
      if (document.visibilityState === 'hidden') return false;
      let e;
      try {
        e = await pedirEstado(inicial.id);
      } catch {
        if (vivo) setProblemaSondeo('red');
        return false;
      }
      if (!vivo) return false;
      if (!e.ok) {
        setProblemaSondeo((e.detalle as { sesionVencida?: boolean } | undefined)?.sesionVencida ? 'sesion' : 'red');
        return false;
      }
      setProblemaSondeo(null);
      setEditando(e.data.editando);
      if (e.data.version === versionConocida.current) return false;
      // Otra persona cambio la ficha. El aviso hace que TODO lo que la muestra se relea (esta ficha, quien puso cada
      // campo, zona de la aduana, contexto): ninguno de ellos tiene reloj propio.
      avisarCambioDeFicha(inicial.id);
      return true;
    };
    // Solo mientras alguien usa la pestana (presencia.ts): una ficha abierta y desatendida no mantiene la base despierta.
    // Una ficha cerrada se consulta mucho menos (SONDEO.fichaCerrada): solo puede cambiar si la reabren.
    const detenerSondeo = sondearConBackoff(cerrada ? SONDEO.fichaCerrada : SONDEO_MS, tick);
    // Un primer vistazo a los pocos segundos: sin el, quien abre la ficha no veria quien esta escribiendo hasta el primer tic.
    const primero = setTimeout(() => void tick(), 3000);
    const alVolver = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    // Al volver de otra pestana solo se consulta si estuvo oculta un rato (OCULTA_MIN_MS).
    const dejarDeEscuchar = alVolverDePestana(alVolver);
    window.addEventListener(EVENTO_PRESENCIA, alVolver);
    return () => {
      vivo = false;
      detenerSondeo();
      clearTimeout(primero);
      dejarDeEscuchar();
      window.removeEventListener(EVENTO_PRESENCIA, alVolver);
      if (temporizadorRefresco.current) clearTimeout(temporizadorRefresco.current);
      if (temporizadorCierre.current) clearTimeout(temporizadorCierre.current);
    };
  }, [inicial.id, cerrada]);

  // Una accion propia en otro bloque (cerrar o reabrir la clasificacion, enviar, restaurar) se ve al instante:
  // no espera al sondeo, que es para los cambios de otras personas.
  useEffect(() => {
    const alCambiarFicha = (e: Event) => {
      if ((e as CustomEvent<{ referenciaId?: string }>).detail?.referenciaId === inicial.id) void refrescar();
    };
    window.addEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
    return () => window.removeEventListener(EVENTO_FICHA_CAMBIADA, alCambiarFicha);
  }, [inicial.id, refrescar]);

  // ---- Fases de guardado de todos los campos ------------------------------------------------------------
  const fasesRef = useRef<Record<string, { fase: FaseCampo; etiqueta: string }>>({});
  const temporizadorAnuncio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alCambiarFase = useCallback((clave: string, fase: FaseCampo, etiqueta: string) => {
    if (fasesRef.current[clave]?.fase === fase) return;
    fasesRef.current = { ...fasesRef.current, [clave]: { fase, etiqueta } };
    setFases(fasesRef.current);
    // Anuncio para lectores de pantalla: una vez por rafaga, no por cada campo (SPEC 11.6).
    const todas = Object.values(fasesRef.current);
    if (temporizadorAnuncio.current) clearTimeout(temporizadorAnuncio.current);
    const errores = todas.filter((f) => f.fase === 'error');
    if (errores.length > 0) {
      setAnuncio(`No se guardó ${errores.map((f) => `«${f.etiqueta}»`).join(', ')}. Tu texto sigue en pantalla.`);
    } else if (fase === 'guardado' && !todas.some((f) => FASES_PENDIENTES.includes(f.fase))) {
      temporizadorAnuncio.current = setTimeout(() => setAnuncio('Guardado'), 600);
    }
  }, []);

  const lista = Object.entries(fases);
  const guardando = lista.some(([, f]) => f.fase === 'guardando');
  const conError = lista.filter(([, f]) => f.fase === 'error');
  const pendiente = lista.some(([, f]) => FASES_PENDIENTES.includes(f.fase) && f.fase !== 'guardando' && f.fase !== 'error');
  const hayPendientes = lista.some(([, f]) => FASES_PENDIENTES.includes(f.fase));

  // No perder lo escrito al cerrar la pestana.
  useEffect(() => {
    if (!hayPendientes) return;
    const antes = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', antes);
    return () => window.removeEventListener('beforeunload', antes);
  }, [hayPendientes]);

  // ---- Secciones y campos ----------------------------------------------------------------------------------
  const valores = useMemo(() => Object.fromEntries(Object.entries(ficha.campos).map(([k, v]) => [k, v.valor])), [ficha.campos]);

  const ocultosAlCambiarTipo = useCallback(
    (nuevo: TipoProducto) =>
      CAMPOS.filter((c) => esVisible(c, tipo) && !esVisible(c, nuevo) && !estaVacio(valores[c.clave])).map((c) => c.etiqueta.toLowerCase()),
    [tipo, valores],
  );

  function permiso(def: CampoDef): { puede: boolean; razon: string | null } {
    const r = puedeEscribirCampo(actor, def, { estado: ficha.estado, archivada: ficha.archivada, creadaPor: actor.creadaPorId });
    if (r.ok) return { puede: true, razon: null };
    if (r.codigo === 'FICHA_CERRADA') return { puede: false, razon: ficha.archivada ? 'La referencia está archivada' : 'La referencia está clasificada' };
    if (actor.rol === 'lector') return { puede: false, razon: 'Solo lectura' };
    if (def.grupo === 'A') return { puede: false, razon: 'Lo completa la aduana' };
    if (def.grupo === 'S') return { puede: false, razon: 'Se calcula sola' };
    return { puede: false, razon: 'Lo completa el área' };
  }

  /** Los campos del grupo aduana (partida, descripciones minimas, restricciones, cierre) viven en el cuarto bloque, el de la aduana: aqui no se repiten. */
  function loLlevaElBloqueAduana(def: CampoDef): boolean {
    return def.grupo === 'A';
  }

  // Un campo que depende de otro (la cantidad, si requiere RIM) aparece o se va segun el valor vigente.
  const camposPorSeccion = useMemo(
    () =>
      Object.fromEntries(
        SECCIONES.map((s) => [
          s,
          CAMPOS.filter((c) => c.seccion === s && !c.subbloque && aplicaEnFicha(c, tipo, valores) && !NO_ES_CAMPO.has(c.tipoDato)),
        ]),
      ) as Record<Seccion, CampoDef[]>,
    [tipo, valores],
  );

  // Un enlace con ancla (#detalle, o el nombre de un campo: #uso) abre esa seccion y baja hasta ella (F8).
  useEffect(() => {
    const ancla = window.location.hash.replace('#', '');
    const seccion: Seccion | undefined = (SECCIONES as readonly string[]).includes(ancla)
      ? (ancla as Seccion)
      : CAMPOS.find((c) => c.clave === ancla && !c.subbloque)?.seccion;
    if (!seccion) return;
    const t = requestAnimationFrame(() => {
      setManual((m) => ({ ...m, [seccion]: true }));
      requestAnimationFrame(() => (document.querySelector<HTMLElement>(`[data-campo="${CSS.escape(ancla)}"]`) ?? document.getElementById(seccion))?.scrollIntoView({ block: 'start' }));
    });
    return () => cancelAnimationFrame(t);
  }, []);

  // Seccion activa en la barra pegajosa.
  useEffect(() => {
    const observador = new IntersectionObserver(
      (entradas) => {
        const visibles = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const primera = visibles[0]?.target.id as Seccion | undefined;
        if (primera) setActiva(primera);
      },
      { rootMargin: '-120px 0px -55% 0px', threshold: 0 },
    );
    for (const s of SECCIONES) {
      const el = document.getElementById(s);
      if (el) observador.observe(el);
    }
    return () => observador.disconnect();
  }, []);

  function irA(s: Seccion) {
    setAbiertas((a) => ({ ...a, [s]: true }));
    setActiva(s);
    requestAnimationFrame(() => {
      document.getElementById(s)?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      history.replaceState(null, '', `#${s}`);
    });
  }

  const comp = ficha.completitud;

  function irAlPrimeroQueFalta() {
    for (const s of SECCIONES) {
      const clave = comp.secciones[s].faltantes[0];
      if (!clave) continue;
      setAbiertas((a) => ({ ...a, [s]: true }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`[data-campo="${clave}"]`) ?? document.getElementById(s);
          el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          el?.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
        }),
      );
      return;
    }
  }
  const rolAduana = actor.rol === 'aduana';
  const mostrarDesignar =
    !cerrada && !rolAduana && actor.rol !== 'lector' && comp.tresSeccionesVerdes && responsables.aduana.length === 0 && puede(actor, 'enviar_a');
  const panelSiguientePaso =
    actor.rol === 'lector' ? null : (
      <SiguientePaso
        referenciaId={ficha.id}
        rolAduana={rolAduana}
        cerrada={cerrada}
        estado={ficha.estado}
        faltanArea={comp.area.faltan}
        faltantesAduana={comp.aduana.faltantes}
        hayPendientes={hayPendientes}
        hayError={conError.length > 0}
        responsablesAduana={responsables.aduana.map((r) => (r.organizacion ? `${nombreVisible(r.nombre)} (${r.organizacion})` : nombreVisible(r.nombre)))}
        puedeCrear={puede(actor, 'crear_referencia')}
        irAlPrimeroQueFalta={irAlPrimeroQueFalta}
      />
    );
  const totalArea = comp.area.total;
  const hechos = totalArea - comp.area.faltan;
  const pct = totalArea === 0 ? 0 : Math.round((hechos / totalArea) * 100);

  const personasEditando = [...new Set(editando.map((e) => e.usuario))];
  const puedeAdjuntar = puede(actor, 'adjuntar_foto', { estadoFicha: ficha.estado }) && !ficha.archivada;
  const puedeCorregir = puede(actor, 'corregir_codigo', { esCreador: actor.usuarioId === actor.creadaPorId, estadoFicha: ficha.estado }) && !ficha.archivada;
  const puedeSimilar = puede(actor, 'crear_referencia');
  // Eliminar (administrador y supervisora general): la referencia, cerrada o pendiente, se borra con todo lo suyo.
  const puedeEliminar = puede(actor, 'supervisar');
  const verde = ficha.color === 'verde';
  const textoSello = verde ? 'Clasificada' : 'Pendiente';

  // Texto del estado de guardado (barra pegajosa).
  let estadoGuardado: { texto: string; tono: 'normal' | 'error' | 'ok' };
  if (conError.length > 0) estadoGuardado = { texto: 'No se guardó', tono: 'error' };
  else if (guardando) estadoGuardado = { texto: 'Guardando…', tono: 'normal' };
  else if (pendiente) estadoGuardado = { texto: 'Sin guardar', tono: 'normal' };
  else if (ultimoGuardado) estadoGuardado = { texto: 'Guardado', tono: 'ok' };
  else estadoGuardado = { texto: cerrada ? 'Solo lectura' : 'Se guarda solo', tono: 'normal' };

  return (
    <div className="contenedor-lectura space-y-5 pb-24 sm:pb-6">
      {/* La barra inferior de navegacion se oculta aqui: manda el pie con «Enviar a…» (RV-43). */}
      <span data-sin-barra-inferior hidden />

      <Migas
        items={[
          { etiqueta: 'Referencias', href: '/referencias' },
          { etiqueta: ficha.codigo },
        ]}
      />

      {/* ---- Cabecera ---------------------------------------------------------------------------------- */}
      <header className="superficie-oscura relative overflow-hidden rounded-2xl bg-azul-700 px-5 py-5 text-white sm:px-7 sm:py-7">
        <AnillosLente className="absolute -right-24 -top-10 h-[130%] w-auto opacity-90" />
        <div className="relative flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-sm font-medium text-azul-200 max-sm:pr-28">Formulario descripciones mínimas</p>
            <h1 className="mt-1 text-balance break-words font-display text-[1.75rem] font-extrabold leading-tight tracking-tight sm:text-4xl">
              {ficha.nombreProducto}
            </h1>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-azul-100">
              <span className="rounded-md bg-white/15 px-2.5 py-1 font-mono text-[0.9375rem] font-semibold tracking-wide text-white" data-codigo>
                {ficha.codigo}
              </span>
              <span>{ETIQUETA_TIPO[tipo]}</span>
              <span aria-hidden>·</span>
              {ficha.estado === 'CLASIFICADA' ? (
                // Clasificada: el contador se detuvo y se ve en verde, como en el listado (L4)
                <span className="rounded-md bg-verde-fondo px-2 py-0.5 font-semibold text-verde-texto" data-dias-detenido>
                  Día {ficha.diasEnGestion} en gestión (detenido)
                </span>
              ) : (
                <span>Día {ficha.diasEnGestion} en gestión</span>
              )}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1.5 max-sm:absolute max-sm:right-0 max-sm:top-0 sm:items-end">
            <Estado
              tamano="lg"
              color={ficha.color}
              texto={textoSello}
              etiquetaAria={`Estado de la referencia: ${textoSello.toLowerCase()}. ${ficha.etiqueta}`}
              className="shadow-suave max-sm:min-h-8 max-sm:px-3 max-sm:text-sm"
            />
            <p className="text-sm text-azul-100 max-sm:hidden">{ficha.etiqueta}</p>
          </div>
        </div>
        <p className="relative mt-4 text-sm text-azul-200">
          <span className="sm:hidden">{ficha.etiqueta} · </span>
          Creada por {nombreVisible(ficha.creadaPor)} · Solicitada el {new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ficha.fechaSolicitud}T00:00:00Z`))}
        </p>
      </header>

      {/* ---- Acciones y presencia --------------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border border-borde-suave bg-superficie px-4 py-3 shadow-suave">
        <div className="min-w-0 text-sm text-tinta-suave" aria-live="off">
          {personasEditando.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2" data-presencia>
              <span className="font-semibold text-tinta">Ahora editan</span>
              {personasEditando.map((n) => (
                <span key={n} className="inline-flex items-center gap-1.5">
                  <Avatar nombre={n} tamano="sm" />
                  {nombreVisible(n)}
                </span>
              ))}
            </p>
          ) : (
            <p className="flex items-center gap-1.5">
              <Pencil aria-hidden className="size-3.5" />
              Nadie más está editando ahora
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PanelActividad referenciaId={ficha.id} />
          <span className="max-sm:hidden">
            <BotonEnviarA referenciaId={ficha.id} />
          </span>
          {puedeEliminar ? (
            <Boton variante="peligro" onClick={() => setEliminando(true)} data-testid="eliminar-referencia">
              <Trash2 aria-hidden className="size-4" />
              <span className="max-sm:sr-solo">Eliminar</span>
              <span className="sr-solo"> referencia</span>
            </Boton>
          ) : null}
          {puedeSimilar || puedeCorregir ? (
            <MenuDesplegable
              etiqueta="Más acciones"
              alinear="fin"
              disparador={(p) => (
                <Boton {...p} variante="secundario" tamano="icono" aria-label="Más acciones">
                  <EllipsisVertical aria-hidden className="size-5" />
                </Boton>
              )}
            >
              {puedeSimilar ? (
                <ItemMenu href={`/referencias/nueva?similar=${ficha.id}`}>
                  <Copy aria-hidden />
                  Crear similar
                </ItemMenu>
              ) : null}
              {puedeCorregir ? (
                <ItemMenu onClick={() => setCorrigiendo(true)}>
                  <Pencil aria-hidden />
                  Corregir código
                </ItemMenu>
              ) : null}
            </MenuDesplegable>
          ) : null}
        </div>
      </div>

      {problemaSondeo === 'sesion' ? (
        <Aviso tipo="error" titulo="Tu sesión venció">
          Entra de nuevo en otra pestaña. Lo que escribes aquí sigue en pantalla y se guarda al volver a esta.
        </Aviso>
      ) : null}
      {problemaSondeo === 'red' ? (
        <Aviso tipo="aviso" titulo="Sin conexión por un momento">
          <span className="inline-flex items-center gap-1.5">
            <WifiOff aria-hidden className="size-4" />
            Seguimos intentando. Lo que escribes sigue en pantalla.
          </span>
        </Aviso>
      ) : null}
      {cerrada ? (
        <Aviso tipo="info" titulo={ficha.archivada ? 'Esta referencia está archivada' : 'Esta referencia está clasificada y no se edita'}>
          {ficha.archivada
            ? 'Puedes consultarla, pero no cambiarla. Un administrador puede restaurarla.'
            : 'Puedes consultarla y comentar. Si hay que cambiar algo, hay que reabrir la clasificación.'}
        </Aviso>
      ) : null}

      {/* ---- Barra pegajosa ------------------------------------------------------------------------------ */}
      <div
        className="sticky top-[var(--alto-barra-superior)] z-10 -mx-4 border-b border-borde-suave bg-superficie/95 backdrop-blur-sm sm:mx-0 sm:rounded-xl sm:border sm:shadow-suave"
        style={{ height: 'var(--alto-barra-sticky)' }}
        data-barra-ficha
      >
        <div className="flex h-[calc(var(--alto-barra-sticky)-4px)] items-center justify-between gap-2 px-3 sm:px-4">
          <nav aria-label="Secciones de la referencia" className="flex min-w-0 items-center gap-1 sm:gap-2">
            {SECCIONES.map((s, i) => {
              const r = comp.secciones[s];
              const Icono = ICONO_SECCION[r.estado];
              const texto = r.faltan === 0 && r.estado === 'verde' ? 'Completa' : r.estado === 'amarillo' && r.faltan === 0 ? 'Pendiente' : r.faltan === 1 ? 'Falta 1' : `Faltan ${r.faltan}`;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => irA(s)}
                  aria-current={activa === s ? 'location' : undefined}
                  className={cn(
                    'flex min-h-11 items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors duration-150 hover:bg-azul-50 sm:px-2',
                    activa === s && 'bg-azul-50',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border-2 font-display text-xs font-extrabold',
                      r.estado === 'verde' ? 'border-verde-solido bg-verde-fondo text-verde-texto' : 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="min-w-0 leading-tight max-[420px]:sr-solo">
                    <span className="block text-sm font-semibold text-tinta max-sm:sr-solo">{ETIQUETA_SECCION[s]}</span>
                    <span className="flex items-center gap-1 text-xs font-medium text-tinta-suave">
                      <Icono aria-hidden className={cn('size-3', r.estado === 'verde' ? 'text-verde-solido' : 'text-amarillo-borde')} strokeWidth={2.5} />
                      {texto}
                    </span>
                  </span>
                  <Icono aria-hidden className={cn('size-3.5 min-[421px]:hidden', r.estado === 'verde' ? 'text-verde-solido' : 'text-amarillo-borde')} strokeWidth={2.5} />
                </button>
              );
            })}
          </nav>
          <div className="flex shrink-0 flex-col items-end leading-tight">
            <span className="text-sm font-semibold tabular-nums text-tinta">
              {hechos} de {totalArea} <span className="max-sm:hidden">campos</span>
            </span>
            <span
              role="status"
              aria-live="polite"
              data-estado-guardado={estadoGuardado.tono}
              className={cn(
                'inline-flex items-center gap-1 text-xs font-medium',
                estadoGuardado.tono === 'error' ? 'text-error' : estadoGuardado.tono === 'ok' ? 'text-azul-700' : 'text-tinta-suave',
              )}
            >
              {estadoGuardado.tono === 'ok' ? <CircleCheck aria-hidden className="size-3" /> : null}
              {estadoGuardado.texto}
            </span>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={`Avance: ${hechos} de ${totalArea} campos`}
          aria-valuemin={0}
          aria-valuemax={totalArea}
          aria-valuenow={hechos}
          className="h-1 overflow-hidden bg-azul-100 sm:mx-1 sm:rounded-full"
        >
          <div className="h-full bg-azul-600 transition-[width] duration-300 ease-salida" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Region viva aparte: «Guardado» una vez por rafaga, errores con el nombre del campo. */}
      <p className="sr-solo" role="status" aria-live="polite" data-anuncio>
        {anuncio}
      </p>

      {/* ---- Quien llena que (el amarillo es el del formato de la aduana, F-ADI-30) -------------------------- */}
      <ul aria-label="Quién llena cada parte" className="flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-tinta">
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-4 rounded-sm border border-borde-fuerte bg-white" />
          Lo llena el área solicitante
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-4 rounded-sm border border-aduana-borde bg-aduana-marca" />
          Lo llena la aduana (zona amarilla, al final)
        </li>
      </ul>

      {/* ---- Secciones -------------------------------------------------------------------------------------- */}
      <div className="space-y-4">
        {SECCIONES.map((s, i) => {
          const r = comp.secciones[s];
          const total = r.total;
          const estadoTexto =
            r.estado === 'verde' ? 'Completa' : r.texto.startsWith('La aduana') ? r.texto : r.faltan === 1 ? 'Falta 1' : `Faltan ${r.faltan}`;
          return (
            <SeccionFicha
              key={s}
              id={s}
              numero={i + 1}
              titulo={ETIQUETA_SECCION[s]}
              color={r.estado}
              estadoTexto={estadoTexto}
              etiquetaEstadoAria={`Sección ${ETIQUETA_SECCION[s]}: ${estadoTexto.toLowerCase()}`}
              resumen={
                <>
                  {total - r.faltan} de {total}
                  <span className="max-sm:sr-solo"> campos</span>
                </>
              }
              abierta={abiertas[s]}
              onAlternar={(v) => setAbiertas((a) => ({ ...a, [s]: v }))}
            >
              {/* Cerrada (clasificada o archivada) nadie puede dejarla pendiente a otro: el aviso de arriba ya lo dice. */}
              {r.estado === 'amarillo' && !r.texto.startsWith('La aduana') && !cerrada ? (
                <PendienteDeSeccion
                  referenciaId={ficha.id}
                  seccion={s}
                  responsables={responsables[s]}
                  area={esArea(valores.area_responsable) ? valores.area_responsable : null}
                  puedeEnviar={actor.rol !== 'lector'}
                />
              ) : null}
              {s === 'especificaciones' ? (
                <p className="mb-5 text-sm text-tinta-suave">
                  <span className="font-semibold text-tinta">Del área:</span> {comp.area.completo ? 'completo' : `faltan ${comp.area.faltan}`} ·{' '}
                  <span className="font-semibold text-tinta">De la aduana:</span> {comp.aduana.faltan === 0 ? 'completo' : `faltan ${comp.aduana.faltan}`}
                </p>
              ) : null}
              <div className="space-y-7">
                {camposPorSeccion[s].map((def) => {
                  if (def.tipoDato === 'adjuntos') {
                    if (!fotosActivas) return null;
                    return (
                      <FotosFicha
                        key="adjuntos"
                        referenciaId={ficha.id}
                        adjuntos={adjuntos}
                        puedeAdjuntar={puedeAdjuntar}
                        razonSoloLectura={cerrada ? 'La referencia está clasificada' : actor.rol === 'lector' || actor.rol === 'aduana' ? 'Lo completa el área' : null}
                        alCambiar={() => void refrescar()}
                      />
                    );
                  }
                  if (loLlevaElBloqueAduana(def)) return null;
                  const p = permiso(def);
                  return (
                    <CampoFicha
                      key={`${def.clave}-${tipo}`}
                      referenciaId={ficha.id}
                      def={def}
                      tipo={tipo}
                      vista={ficha.campos[def.clave]}
                      puedeEditar={p.puede}
                      razonSoloLectura={p.razon}
                      catalogos={catalogos}
                      paises={paises}
                      editandoPor={editando.find((e) => e.campo === def.clave)?.usuario ?? null}
                      valores={valores}
                      ocultosAlCambiarTipo={def.clave === 'tipo_producto' ? ocultosAlCambiarTipo : undefined}
                      alCambiarFase={alCambiarFase}
                      alGuardar={alGuardar}
                    />
                  );
                })}
              </div>
              {camposOcultos(tipo).length > 0 && s === 'detalle' ? (
                <p className="mt-6 flex items-start gap-1.5 text-sm text-tinta-suave">
                  <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                  Según el tipo {ETIQUETA_TIPO[tipo]} no pedimos: {camposOcultos(tipo).join(', ')}.
                </p>
              ) : null}
            </SeccionFicha>
          );
        })}
      </div>

      {/* Las tres secciones del area completas y nadie de la aduana la tiene: aviso grande para designar la agencia responsable. */}
      {mostrarDesignar ? <AvisoDesignarAduana referenciaId={ficha.id} codigo={ficha.codigo} /> : null}

      {rolAduana ? null : panelSiguientePaso}

      {/* ---- Cuarto bloque: aduana (lo construye su dueno) ----------------------------------------------- */}
      {/* De quien es la parte de la aduana (o que aun no tiene agencia), igual que en las secciones del area. */}
      {!cerrada && !rolAduana && !mostrarDesignar ? (
        <PendienteDeSeccion
          referenciaId={ficha.id}
          seccion="aduana"
          responsables={responsables.aduana}
          puedeEnviar={actor.rol !== 'lector'}
          className="mb-0"
        />
      ) : null}
      <SeccionAduana referenciaId={ficha.id} />

      {rolAduana ? panelSiguientePaso : null}

      {/* ---- Pie fijo en movil (RV-43) ---------------------------------------------------------------------- */}
      <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-borde-suave bg-superficie px-4 py-3 shadow-[0_-4px_12px_rgb(7_31_74/0.08)] sm:hidden">
        <p className="min-w-0 text-sm font-medium text-tinta-suave">
          {hechos} de {totalArea} campos
        </p>
        <BotonEnviarA referenciaId={ficha.id} />
      </div>

      {puedeEliminar ? (
        <DialogoConfirmacion
          abierto={eliminando}
          onCerrar={() => setEliminando(false)}
          titulo={`Eliminar la referencia ${ficha.codigo}`}
          descripcion={
            <>
              Se borra {ficha.codigo} con todo lo suyo: lo que se escribió en cada campo, los comentarios, los pendientes y los avisos. Queda una constancia en la
              auditoría y el código se puede volver a usar. <strong>No se puede deshacer.</strong>
              {ficha.estado === 'CLASIFICADA' ? ' Está clasificada: se borra también su clasificación.' : ''} Si solo quieres sacarla del listado, mejor archívala.
            </>
          }
          confirmar="Eliminar referencia"
          cancelar="Todavía no"
          peligro
          onConfirmar={async () => {
            const r = await eliminarReferenciaAccion({ referenciaId: ficha.id });
            if (!r.ok) throw new Error(r.mensaje);
            avisar({ tipo: 'exito', titulo: `Eliminamos la referencia ${r.data.codigo}` });
            router.push('/referencias');
            router.refresh();
          }}
        />
      ) : null}

      {corrigiendo ? (
        <CorregirCodigo
          referenciaId={ficha.id}
          codigoActual={ficha.codigo}
          abierto
          onCerrar={() => setCorrigiendo(false)}
          alCorregir={() => void refrescar()}
        />
      ) : null}
    </div>
  );
}

/** Campos que ya trae una ficha al crearse (la ficha nace con ellos): no cuentan como «algo lleno». */
const CAMPOS_DE_ALTA: ReadonlySet<string> = new Set(['codigo', 'nombre_producto', 'fecha_solicitud', 'tipo_producto', 'area_responsable']);

/** Borrador recien creado: nadie ha llenado nada aparte de lo que pide el alta. */
function esBorradorVirgen(f: FichaVista): boolean {
  return f.estado === 'BORRADOR' && !f.archivada && Object.values(f.campos).every((c) => CAMPOS_DE_ALTA.has(c.clave) || estaVacio(c.valor));
}

/** Etiquetas de los campos con regla `-` para este tipo (transparencia: «no pedimos…»). */
function camposOcultos(tipo: TipoProducto): string[] {
  return CAMPOS.filter((c) => !esVisible(c, tipo) && !NO_ES_CAMPO.has(c.tipoDato)).map((c) => c.etiqueta.toLowerCase());
}
