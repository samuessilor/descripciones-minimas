'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENTO_FICHA_CAMBIADA, leer } from './api';
import { presente } from './presencia';

export type EstadoLectura<T> = { tipo: 'cargando' } | { tipo: 'ok'; data: T } | { tipo: 'error'; mensaje: string };

/**
 * Lee una URL GET (con `leer`) y la mantiene al dia: recarga si cambia la URL, cada `intervaloMs` mientras
 * la pestana esta visible y en uso (presencia.ts) y cuando otro componente avisa que la ficha cambio. Conserva el ultimo dato bueno
 * mientras recarga (nada parpadea) y solo muestra el error si nunca hubo datos.
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

  useEffect(() => {
    pararRef.current = parar;
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const cargar = useCallback(async () => {
    if (enVuelo.current) {
      repetir.current = true;
      return;
    }
    enVuelo.current = true;
    try {
      do {
        repetir.current = false;
        const u = urlActual.current;
        if (!u) break;
        setRecargando(true);
        const r = await leer<T>(u);
        if (!montado.current) return;
        // Una respuesta de una URL anterior ya no interesa: la lectura se repite con la actual.
        if (u === urlActual.current) {
          urlCargada.current = u;
          if (r.ok) {
            setEstado({ tipo: 'ok', data: r.data });
            detenido.current = pararRef.current?.(r.data) ?? false;
          }
          else if (r.mensaje) setEstado((previo) => (previo.tipo === 'ok' ? previo : { tipo: 'error', mensaje: r.mensaje }));
        } else repetir.current = true;
      } while (repetir.current && montado.current);
    } finally {
      enVuelo.current = false;
      if (montado.current) setRecargando(false);
    }
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
    const t = setInterval(() => {
      if (presente() && !detenido.current) void cargar();
    }, intervaloMs);
    return () => clearInterval(t);
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
