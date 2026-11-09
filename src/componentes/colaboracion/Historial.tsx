'use client';

import { Eraser, History, Lock, PencilLine, RotateCcw, Undo2 } from 'lucide-react';
import { useSyncExternalStore, useState } from 'react';
import { createPortal } from 'react-dom';
import { restaurarCampoAccion } from '@/app/acciones/ficha';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { Esqueleto, EsqueletoZona } from '@/componentes/ui/esqueleto';
import { Insignia } from '@/componentes/ui/insignia';
import { useAvisos } from '@/componentes/ui/toast';
import { cn } from '@/lib/utils';
import type { EntradaHistorialFicha, HistorialFicha, ResumenCampo, ResumenCampos } from '@/server/politicas/colaboracion';
import { PopoverEnPortal, useEnCliente } from './PopoverEnPortal';
import { abrirActividad, avisarCambioDeFicha, EVENTO_CAMPO_GUARDADO, EVENTO_FICHA_CAMBIADA, fechaHora, hace, leer, type DetalleCampoGuardado } from './api';
import { alVolverDePestana, EVENTO_PRESENCIA } from './presencia';
import { useLectura } from './usar-lectura';

// ---- Restaurar un valor (siempre con motivo) ----------------------------------------------------------------

export interface ObjetivoRestaurar {
  referenciaId: string;
  historialId: number;
  campo: string;
  etiqueta: string;
  valor: string;
}

/**
 * Restaurar repone un valor anterior creando un hecho NUEVO en el historial: nunca borra nada (9.6). Siempre
 * pide un motivo; si el valor vigente es de otra persona, ella recibe un aviso.
 */
export function DialogoRestaurar({
  objetivo,
  onCerrar,
  onHecho,
  enPortal = false,
}: {
  objetivo: ObjetivoRestaurar | null;
  onCerrar: () => void;
  onHecho: () => void;
  /** Dibujarlo en `document.body` (cuando su disparador vive dentro de un `<p>`). */
  enPortal?: boolean;
}) {
  const { avisar } = useAvisos();
  const enCliente = useEnCliente();
  if (!objetivo) return null;
  if (enPortal && !enCliente) return null;
  const dialogo = (
    <DialogoConfirmacion
      abierto
      onCerrar={onCerrar}
      titulo={`Restaurar «${objetivo.etiqueta}»`}
      descripcion={
        <>
          Vas a volver a poner <strong className="text-tinta">«{objetivo.valor}»</strong>. El valor de ahora queda en el historial: nada se borra.
        </>
      }
      confirmar="Restaurar este valor"
      cancelar="Todavía no"
      pedirMotivo
      etiquetaMotivo="Motivo"
      ayudaMotivo="Cuenta por qué lo restauras. Si el valor de ahora lo puso otra persona, recibirá un aviso con tu motivo."
      onConfirmar={async (motivo) => {
        const r = await restaurarCampoAccion({ referenciaId: objetivo.referenciaId, campo: objetivo.campo, historialId: objetivo.historialId, motivo });
        if (!r.ok) throw new Error(r.mensaje);
        avisar({ tipo: 'exito', titulo: `Restauraste «${objetivo.etiqueta}»`, descripcion: 'Quedó como una versión nueva en el historial.' });
        avisarCambioDeFicha(objetivo.referenciaId);
        onHecho();
      }}
    />
  );
  return enPortal ? createPortal(dialogo, document.body) : dialogo;
}

// ---- Linea de tiempo --------------------------------------------------------------------------------------------

const VERBO_EVENTO_PROPIO: Record<string, string> = {
  fijar: 'escribiste',
  vaciar: 'vaciaste el campo',
  restaurar: 'restauraste un valor anterior',
  sistema: 'registró el sistema',
};

const VERBO_EVENTO: Record<string, string> = {
  fijar: 'escribió',
  vaciar: 'vació el campo',
  restaurar: 'restauró un valor anterior',
  sistema: 'registró el sistema',
};

function IconoEvento({ tipo }: { tipo: string }) {
  const Icono = tipo === 'restaurar' ? RotateCcw : tipo === 'vaciar' ? Eraser : PencilLine;
  return (
    <span aria-hidden className="absolute left-0 top-0.5 flex size-6 items-center justify-center rounded-full border border-borde-suave bg-superficie text-tinta-suave">
      <Icono className="size-3.5" strokeWidth={2} />
    </span>
  );
}

export function EntradaLinea({
  e,
  anterior,
  mostrarCampo = true,
  onRestaurar,
  ahora,
}: {
  e: EntradaHistorialFicha;
  /** Valor de la version anterior del mismo campo, si esta cargada. */
  anterior?: string | undefined;
  mostrarCampo?: boolean;
  onRestaurar: (e: EntradaHistorialFicha) => void;
  ahora: Date;
}) {
  return (
    <li className="relative pb-5 pl-9 last:pb-0" data-testid="entrada-historial">
      <IconoEvento tipo={e.tipoEvento} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {mostrarCampo ? <span className="text-sm font-bold text-tinta">{e.etiqueta}</span> : null}
        <span className="text-xs tabular-nums text-tinta-suave">v{e.version}</span>
        {e.vigente ? <Insignia variante="azul">Valor actual</Insignia> : null}
      </div>
      <p className="text-sm text-tinta-suave">
        <span className="font-semibold text-tinta">{e.autorEsPropio ? 'Tú' : e.autor}</span> {(e.autorEsPropio ? VERBO_EVENTO_PROPIO : VERBO_EVENTO)[e.tipoEvento] ?? 'cambió'} ·{' '}
        <time dateTime={e.creadoEn} title={fechaHora(e.creadoEn)}>
          {hace(e.creadoEn, ahora)}
        </time>
      </p>
      <p className="mt-1.5 break-words rounded-md border border-borde-suave bg-superficie-2 px-2.5 py-1.5 text-sm text-tinta">
        {e.tipoEvento === 'vaciar' ? <span className="italic text-tinta-suave">Quedó vacío</span> : e.valor}
      </p>
      {anterior !== undefined ? <p className="mt-1 break-words text-xs text-tinta-suave">Antes: {anterior}</p> : null}
      {e.motivo ? (
        <p className="mt-1.5 text-sm text-tinta">
          <span className="font-semibold">Motivo:</span> {e.motivo}
        </p>
      ) : e.hayMotivoOculto ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-tinta-suave">
          <Lock aria-hidden className="size-3.5" />
          Hay un motivo, pero solo lo ve el equipo interno.
        </p>
      ) : null}
      {e.restaurable ? (
        <Boton variante="secundario" tamano="sm" className="mt-2" onClick={() => onRestaurar(e)} aria-label={`Restaurar «${e.etiqueta}» a la versión ${e.version}`}>
          <Undo2 aria-hidden className="size-4" />
          Restaurar este valor
        </Boton>
      ) : null}
    </li>
  );
}

export function LineaDeTiempo({
  items,
  mostrarCampo = true,
  onRestaurar,
}: {
  items: EntradaHistorialFicha[];
  mostrarCampo?: boolean;
  onRestaurar: (e: EntradaHistorialFicha) => void;
}) {
  const ahora = new Date();
  // "Antes: ..." = el valor de la version anterior del mismo campo, si esta en la lista.
  const porClave = new Map<string, EntradaHistorialFicha>();
  for (const e of items) porClave.set(`${e.campo}#${e.version}`, e);
  return (
    <ol className="relative before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-borde-suave">
      {items.map((e) => {
        const prev = porClave.get(`${e.campo}#${e.version - 1}`);
        return (
          <EntradaLinea
            key={e.id}
            e={e}
            ahora={ahora}
            mostrarCampo={mostrarCampo}
            onRestaurar={onRestaurar}
            anterior={prev ? (prev.tipoEvento === 'vaciar' ? 'Vacío' : prev.valor) : undefined}
          />
        );
      })}
    </ol>
  );
}

// ---- Resumen compartido "quien lo puso y cuando" -----------------------------------------------------------------

interface EstadoResumen {
  cargado: boolean;
  version: number;
  campos: Map<string, ResumenCampo>;
  /** Historial parcial (agencia): no se cuentan versiones ni se ofrece el panel completo. */
  limitado: boolean;
  error: string | null;
}

/**
 * Sin reloj propio: se lee al montar, cuando el sondeo de la ficha ve una version nueva (`EVENTO_FICHA_CAMBIADA`), al
 * volver a la pestana tras una ausencia y tras una accion propia. Un guardado propio no relee: aplica la respuesta.
 */
class AlmacenResumen {
  private estado: EstadoResumen = { cargado: false, version: 0, campos: new Map(), limitado: false, error: null };
  private suscriptores = new Set<() => void>();
  private dejarDeEscucharPestana: (() => void) | null = null;
  private baja: ReturnType<typeof setTimeout> | null = null;
  private ultimaCarga = 0;
  private enCurso = false;
  /** Instante del ultimo guardado propio aplicado: una lectura que salio antes puede no incluirlo. */
  private guardadoLocalEn = 0;
  private alCambiarFicha = () => void this.cargar();
  /** Al volver tras una ausencia no se estuvo mirando: se lee en el acto. */
  private alVolver = () => void this.cargar();
  /** Guardado propio: se aplica lo que respondio el servidor, sin releer. */
  private alGuardarCampo = (e: Event) => {
    const d = (e as CustomEvent<DetalleCampoGuardado>).detail;
    if (d?.referenciaId !== this.referenciaId) return;
    const campos = new Map(this.estado.campos);
    if (d.vacio) campos.delete(d.campo);
    else campos.set(d.campo, { clave: d.campo, autor: 'Tú', propio: true, instante: new Date().toISOString(), version: d.version });
    this.guardadoLocalEn = Date.now();
    this.estado = { ...this.estado, campos };
    for (const cb of this.suscriptores) cb();
  };

  constructor(private readonly referenciaId: string) {}

  suscribir = (cb: () => void): (() => void) => {
    this.suscriptores.add(cb);
    if (this.baja) {
      clearTimeout(this.baja);
      this.baja = null;
    }
    if (this.suscriptores.size === 1) {
      // Los datos recientes se reutilizan (no una lectura por cada montaje del campo).
      if (!this.estado.cargado || Date.now() - this.ultimaCarga > 15_000) void this.cargar();
      this.dejarDeEscucharPestana = alVolverDePestana(this.alVolver);
      window.addEventListener(EVENTO_FICHA_CAMBIADA, this.alCambiarFicha);
      window.addEventListener(EVENTO_CAMPO_GUARDADO, this.alGuardarCampo);
      window.addEventListener(EVENTO_PRESENCIA, this.alVolver);
    }
    return () => {
      this.suscriptores.delete(cb);
      if (this.suscriptores.size === 0) {
        this.dejarDeEscucharPestana?.();
        this.dejarDeEscucharPestana = null;
        window.removeEventListener(EVENTO_FICHA_CAMBIADA, this.alCambiarFicha);
        window.removeEventListener(EVENTO_CAMPO_GUARDADO, this.alGuardarCampo);
        window.removeEventListener(EVENTO_PRESENCIA, this.alVolver);
        // Se conserva unos segundos: un remontaje inmediato (cambio de seccion, modo estricto) no vuelve a leer.
        this.baja = setTimeout(() => almacenes.delete(this.referenciaId), 8000);
      }
    };
  };

  obtener = (): EstadoResumen => this.estado;

  async cargar(): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    const salida = Date.now();
    const r = await leer<ResumenCampos>(`/api/colaboracion/ficha/${this.referenciaId}/campos`);
    this.enCurso = false;
    // Un guardado propio llego mientras esta lectura viajaba: pudo salir antes de escribirse, asi que se repite.
    if (r.ok && this.guardadoLocalEn >= salida) return this.cargar();
    if (r.ok) {
      this.ultimaCarga = Date.now();
      this.estado = { cargado: true, version: r.data.version, campos: new Map(r.data.campos.map((c) => [c.clave, c])), limitado: r.data.historialLimitado, error: null };
    } else if (r.mensaje) {
      this.estado = { ...this.estado, cargado: true, error: r.mensaje };
    } else return;
    for (const cb of this.suscriptores) cb();
  }
}

const almacenes = new Map<string, AlmacenResumen>();
const VACIO: EstadoResumen = { cargado: false, version: 0, campos: new Map(), limitado: false, error: null };

function almacenDe(id: string): AlmacenResumen {
  let a = almacenes.get(id);
  if (!a) {
    a = new AlmacenResumen(id);
    almacenes.set(id, a);
  }
  return a;
}

/** Una sola lectura por ficha para todos los `HistorialCampo` de la pantalla (no una por campo). */
function useResumenCampos(referenciaId: string): EstadoResumen {
  const almacen = almacenDe(referenciaId);
  return useSyncExternalStore(almacen.suscribir, almacen.obtener, () => VACIO);
}

// ---- Indicador por campo ---------------------------------------------------------------------------------------------

/**
 * Bajo cada campo con valor: un acceso «Historial (n)» a sus versiones anteriores (popover en portal) con
 * «Restaurar este valor». Texto, no color. No dibuja nada si el campo aun no tiene valor.
 */
export function HistorialCampoCliente({ referenciaId, campo }: { referenciaId: string; campo: string }) {
  const resumen = useResumenCampos(referenciaId);
  const [objetivo, setObjetivo] = useState<ObjetivoRestaurar | null>(null);
  const dato = resumen.campos.get(campo);
  if (!dato) return null;
  // Con el historial parcial (agencia) `version` cuenta tambien versiones que no se ven: no se muestra el numero.
  const nVersiones = resumen.limitado ? null : dato.version;
  const ultima = `${dato.propio ? 'Tú' : dato.autor}, ${hace(dato.instante)}`;
  return (
    <span className="inline-flex items-center" data-testid={`historial-${campo}`}>
      <PopoverEnPortal
        etiqueta="Versiones de este campo"
        className="w-[min(24rem,calc(100vw-1rem))] p-0"
        disparador={(p) => (
          <button
            {...p}
            type="button"
            title={`Última versión: ${ultima}`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold text-azul-500 hover:bg-azul-50 hover:underline pointer-coarse:min-h-11"
            aria-label={`Ver el historial de este campo${nVersiones === null ? '' : ` (${plural(nVersiones)})`}. Última versión: ${ultima}`}
          >
            <History aria-hidden className="size-4" />
            Historial{nVersiones !== null && nVersiones > 1 ? ` (${nVersiones})` : ''}
          </button>
        )}
      >
        {({ cerrar }) => <VersionesDelCampo referenciaId={referenciaId} campo={campo} onRestaurar={setObjetivo} cerrar={cerrar} panelCompleto={!resumen.limitado} />}
      </PopoverEnPortal>
      <DialogoRestaurar enPortal objetivo={objetivo} onCerrar={() => setObjetivo(null)} onHecho={() => setObjetivo(null)} />
    </span>
  );
}

function plural(n: number): string {
  return n === 1 ? '1 versión' : `${n} versiones`;
}

function VersionesDelCampo({
  referenciaId,
  campo,
  onRestaurar,
  cerrar,
  panelCompleto,
}: {
  referenciaId: string;
  campo: string;
  onRestaurar: (o: ObjetivoRestaurar) => void;
  cerrar: () => void;
  /** El panel lateral muestra el historial de toda la ficha: una agencia no lo tiene. */
  panelCompleto: boolean;
}) {
  const lectura = useLectura<HistorialFicha>(`/api/colaboracion/ficha/${referenciaId}/historial?campo=${encodeURIComponent(campo)}`, { referenciaId });

  return (
    <div className="flex max-h-[min(30rem,calc(100dvh-6rem))] flex-col">
      <div className="border-b border-borde-suave px-4 py-3">
        <h2 className="font-display text-base font-extrabold text-tinta">Versiones de este campo</h2>
        <p className="text-xs text-tinta-suave">Nada se borra: cada cambio queda aquí.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {lectura.estado.tipo === 'cargando' ? (
          <EsqueletoZona etiqueta="Cargando versiones…" className="space-y-3">
            <Esqueleto className="h-16" />
            <Esqueleto className="h-16" />
          </EsqueletoZona>
        ) : lectura.estado.tipo === 'error' ? (
          <Aviso
            tipo="error"
            titulo="No pudimos cargar las versiones"
            accion={
              <Boton variante="secundario" tamano="sm" onClick={lectura.recargar}>
                Reintentar
              </Boton>
            }
          >
            {lectura.estado.mensaje}
          </Aviso>
        ) : (
          <LineaDeTiempo
            items={lectura.estado.data.items}
            mostrarCampo={false}
            onRestaurar={(e) => {
              cerrar();
              onRestaurar({ referenciaId, historialId: e.id, campo: e.campo, etiqueta: e.etiqueta, valor: e.tipoEvento === 'vaciar' ? 'Vacío' : e.valor });
            }}
          />
        )}
      </div>
      {panelCompleto ? (
        <div className={cn('flex items-center justify-between gap-2 border-t border-borde-suave bg-superficie-2 px-4 py-2.5')}>
          <Boton
            variante="terciario"
            tamano="sm"
            onClick={() => {
              cerrar();
              abrirActividad({ referenciaId, pestana: 'historial', campo });
            }}
          >
            Ver en el panel completo
          </Boton>
        </div>
      ) : null}
    </div>
  );
}
