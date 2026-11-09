'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTO_FICHA_CAMBIADA, leerUnaVez, MARGEN_ORDEN_MS } from './api';
import { EVENTO_PRESENCIA, sondearConBackoff } from './presencia';

export type EstadoLectura<T> = { tipo: 'cargando' } | { tipo: 'ok'; data: T } | { tipo: 'error'; mensaje: string };

/** Lecturas pedidas por una accion o al montar: solo se comparten entre copias del mismo componente (casi simultaneas). */
const VENTANA_ACCION_MS = 500;

/**
 * Lee una URL GET (con `leer`) y la mantiene al dia: recarga si cambia la URL, cada `intervaloMs` (valores en
 * sondeo.ts) mientras la pestana esta visible y en uso (presencia.ts) y cuando otro componente avisa que la ficha cambio.
 * Si varios tics seguidos no traen nada nuevo y nadie toca la pantalla, espacia los tics (backoff, ver `sondearConBackoff`).
 * Conserva el ultimo dato bueno mientras recarga (nada parpadea) y solo muestra el error si nunca hubo datos.
 *
 * Nunca hay dos lecturas a la vez: si llega otra orden mientras una viaja, se anota y se repite al terminar.
 * (Cancelar la lectura en vuelo en cada tic haria que, con un servidor lento, ninguna llegara jamas.)
 */
export function useLectura<T>(
  url: string | null,
  opciones: {
    intervaloMs?: number;
    referenciaId?: string;
    activo?: boolean;
    /** Cuando devuelve `true` para el dato leido, el sondeo por intervalo se detiene (la lectura ya es final). */
    parar?: (data: T) => boolean;
  } = {},
): { estado: EstadoLectura<T>; recargar: () => void; recargando: boolean } {
  const { intervaloMs, referenciaId, activo = true, parar } = opciones;
  const [estado, setEstado] = useState<EstadoLectura<T>>({ tipo: 'cargando' });
  const [recargando, setRecargando] = useState(false);
  const urlActual = useRef<string | null>(url);
  const urlCargada = useRef<string | null>(null);
  const enVuelo = useRef(false);
  const repetir = useRef(false);
  const montado = useRef(true);
  const pararRef = useRef(parar);
  const detenido = useRef(false);
  /** Lo ultimo leido, serializado: un tic de reloj que lee lo mismo cuenta como «sin cambios» para el backoff. */
  const huella = useRef<string | null>(null);
  const soloReloj = useRef(false);
  /** Instante de la ultima orden NO de reloj (accion propia, montaje): una respuesta de antes no sirve para ella. */
  const ordenDesde = useRef(0);
  // Un tic de reloj reutiliza lo que otra copia leyo hace menos de ~70 % del intervalo: N copias, una peticion por tic.
  const ventanaReloj = useRef(0);

  useEffect(() => {
    pararRef.current = parar;
    ventanaReloj.current = Math.round((intervaloMs ?? 0) * 0.7);
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  /** Devuelve `true` si lo leido es distinto de la lectura anterior. */
  const cargar = useCallback(async (reloj = false): Promise<boolean> => {
    if (!reloj) ordenDesde.current = Date.now() - MARGEN_ORDEN_MS;
    if (enVuelo.current) {
      repetir.current = true;
      if (!reloj) soloReloj.current = false;
      return false;
    }
    let cambio = false;
    enVuelo.current = true;
    soloReloj.current = reloj;
    try {
      do {
        repetir.current = false;
        const u = urlActual.current;
        if (!u) break;
        setRecargando(true);
        const r = soloReloj.current
          ? await leerUnaVez<T>(u, ventanaReloj.current)
          : await leerUnaVez<T>(u, VENTANA_ACCION_MS, ordenDesde.current);
        if (!montado.current) return false;
        // Una respuesta de una URL anterior ya no interesa: la lectura se repite con la actual.
        if (u === urlActual.current) {
          urlCargada.current = u;
          if (r.ok) {
            setEstado({ tipo: 'ok', data: r.data });
            const nueva = JSON.stringify(r.data);
            if (nueva !== huella.current) {
              huella.current = nueva;
              cambio = true;
            }
            detenido.current = pararRef.current?.(r.data) ?? false;
          }
          else if (r.mensaje) setEstado((previo) => (previo.tipo === 'ok' ? previo : { tipo: 'error', mensaje: r.mensaje }));
        } else repetir.current = true;
      } while (repetir.current && montado.current);
    } finally {
      enVuelo.current = false;
      if (montado.current) setRecargando(false);
    }
    return cambio;
  }, []);

  useEffect(() => {
    urlActual.current = url;
    if (!url || !activo) return;
    if (urlCargada.current !== url) {
      urlCargada.current = null;
      setEstado({ tipo: 'cargando' });
    }
    void cargar();
  }, [url, activo, cargar]);

  useEffect(() => {
    if (!url || !activo || !intervaloMs) return;
    return sondearConBackoff(intervaloMs, () => (detenido.current ? false : cargar(true)));
  }, [url, activo, intervaloMs, cargar]);

  // Al volver tras una ausencia (el sondeo estaba detenido) se lee en el acto, igual que el resto de la pantalla.
  useEffect(() => {
    if (!url || !activo || !intervaloMs) return;
    const alVolver = () => {
      if (!detenido.current) void cargar(true);
    };
    window.addEventListener(EVENTO_PRESENCIA, alVolver);
    return () => window.removeEventListener(EVENTO_PRESENCIA, alVolver);
  }, [url, activo, intervaloMs, cargar]);

  useEffect(() => {
    if (!referenciaId || !activo) return;
    const alCambiar = (e: Event) => {
      const id = (e as CustomEvent<{ referenciaId?: string }>).detail?.referenciaId;
      if (!id || id === referenciaId) void cargar();
    };
    window.addEventListener(EVENTO_FICHA_CAMBIADA, alCambiar);
    return () => window.removeEventListener(EVENTO_FICHA_CAMBIADA, alCambiar);
  }, [referenciaId, activo, cargar]);

  const recargar = useCallback(() => void cargar(), [cargar]);
  return { estado, recargar, recargando };
}
