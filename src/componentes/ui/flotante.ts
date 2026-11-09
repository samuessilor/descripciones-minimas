'use client';

import { useLayoutEffect, type RefObject } from 'react';

/**
 * Colocacion de capas flotantes (popover, tooltip, listas de combobox). Usan el API nativo `popover`:
 * viven en la capa superior del navegador, asi que no las recorta ningun `overflow` ni compiten por
 * `z-index`. Aqui solo se calcula la posicion `fixed` respecto al elemento ancla, con volteo
 * arriba/abajo cuando no cabe y sin salirse de la ventana.
 */
export type Lado = 'abajo' | 'arriba';
export type Alineacion = 'inicio' | 'fin' | 'centro';

export interface OpcionesPosicion {
  lado?: Lado;
  alinear?: Alineacion;
  separacion?: number;
  /** El panel mide lo mismo que el ancla (listas de combobox). */
  igualarAncho?: boolean;
}

const MARGEN = 8;

export function posicionar(ancla: HTMLElement, panel: HTMLElement, o: OpcionesPosicion = {}): void {
  const { lado = 'abajo', alinear = 'inicio', separacion = 6, igualarAncho = false } = o;
  const a = ancla.getBoundingClientRect();
  if (igualarAncho) panel.style.width = `${a.width}px`;
  panel.style.maxHeight = '';
  panel.style.overflowY = '';
  const p = panel.getBoundingClientRect();
  const anchoVentana = document.documentElement.clientWidth;
  const altoVentana = window.innerHeight;

  const espacioAbajo = altoVentana - a.bottom - separacion - MARGEN;
  const espacioArriba = a.top - separacion - MARGEN;
  let efectivo: Lado = lado;
  if (lado === 'abajo' && p.height > espacioAbajo && espacioArriba > espacioAbajo) efectivo = 'arriba';
  else if (lado === 'arriba' && p.height > espacioArriba && espacioAbajo > espacioArriba) efectivo = 'abajo';

  const disponible = Math.max(efectivo === 'abajo' ? espacioAbajo : espacioArriba, 120);
  if (p.height > disponible) {
    // Con la altura recortada, el panel se desplaza por dentro (el borde del CSS es `overflow: visible`).
    panel.style.maxHeight = `${disponible}px`;
    panel.style.overflowY = 'auto';
  }
  const alto = Math.min(p.height, disponible);

  const top = efectivo === 'abajo' ? a.bottom + separacion : a.top - separacion - alto;
  let left = alinear === 'inicio' ? a.left : alinear === 'fin' ? a.right - p.width : a.left + (a.width - p.width) / 2;
  left = Math.min(Math.max(left, MARGEN), Math.max(anchoVentana - p.width - MARGEN, MARGEN));

  panel.style.top = `${Math.max(top, MARGEN)}px`;
  panel.style.left = `${left}px`;
  panel.dataset.lado = efectivo;
}

/** Mientras `activo`, recoloca el panel al redimensionar o desplazar (en fase de captura: cualquier contenedor). */
export function useReposicionar(
  activo: boolean,
  ancla: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  opciones: OpcionesPosicion,
): void {
  const { lado, alinear, separacion, igualarAncho } = opciones;
  useLayoutEffect(() => {
    if (!activo) return;
    const recolocar = () => {
      if (ancla.current && panel.current) posicionar(ancla.current, panel.current, { lado, alinear, separacion, igualarAncho });
    };
    recolocar();
    window.addEventListener('resize', recolocar);
    window.addEventListener('scroll', recolocar, true);
    // Si el contenido llega o cambia con el panel abierto (la lista de versiones se carga despues de abrirlo), vuelve a
    // medir: sin esto el panel crece hacia abajo y se sale de la pantalla sin poder alcanzar sus botones.
    const observador = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(recolocar);
    if (observador && panel.current) observador.observe(panel.current);
    return () => {
      window.removeEventListener('resize', recolocar);
      window.removeEventListener('scroll', recolocar, true);
      observador?.disconnect();
    };
  }, [activo, ancla, panel, lado, alinear, separacion, igualarAncho]);
}

/** Abre/cierra un popover nativo sin lanzar si el navegador ya esta en ese estado. */
export function mostrar(panel: HTMLElement): void {
  try {
    if (!panel.matches(':popover-open')) panel.showPopover();
  } catch {
    /* sin soporte: el panel simplemente no se muestra */
  }
}

export function ocultar(panel: HTMLElement): void {
  try {
    if (panel.matches(':popover-open')) panel.hidePopover();
  } catch {
    /* idem */
  }
}
