'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Pestanas } from '@/componentes/ui/pestanas';
import { EVENTO_AVISOS_NUEVOS } from './api';
import { alVolverDePestana, EVENTO_PRESENCIA, presente } from './presencia';
import { SONDEO } from './sondeo';

/**
 * Pestañas del inicio: «Para mí · Esperando a otros · Recientes» (F7). El contenido de cada una llega ya
 * dibujado desde el servidor; aqui solo se cambia de pestaña. Tambien refresca la bandeja sola cada `SONDEO.bandeja`
 * mientras la pestaña del navegador esta visible y en uso, y al volver a ella tras una ausencia: asi un aviso nuevo
 * aparece sin recargar a mano.
 */
export function BandejaTabs({
  inicial,
  paraMi,
  esperando,
  recientes,
  contadores,
}: {
  inicial: 'para-mi' | 'esperando' | 'recientes';
  paraMi: ReactNode;
  esperando: ReactNode;
  recientes: ReactNode;
  contadores: { paraMi: number; esperando: number };
}) {
  const router = useRouter();

  useEffect(() => {
    // Al volver a la pestana con un aviso nuevo llegan DOS motivos a la vez (presencia y campana): un solo render.
    let ultimo = 0;
    const refrescar = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultimo < 3000) return;
      ultimo = Date.now();
      router.refresh();
    };
    // Refrescar Inicio es volver a renderizar la pagina entera en el servidor (lo mas caro de la app): solo cuando hay
    // motivo (la campana vio un aviso nuevo, o se vuelve a la pestana) y, de respaldo, cada varios minutos.
    const t = setInterval(() => {
      if (presente()) router.refresh();
    }, SONDEO.bandeja);
    // Cambiar de pestana un instante no renderiza Inicio de nuevo: solo si estuvo oculta mas de `OCULTA_MIN_MS`.
    const dejarDeEscuchar = alVolverDePestana(refrescar);
    window.addEventListener(EVENTO_PRESENCIA, refrescar);
    window.addEventListener(EVENTO_AVISOS_NUEVOS, refrescar);
    return () => {
      clearInterval(t);
      dejarDeEscuchar();
      window.removeEventListener(EVENTO_PRESENCIA, refrescar);
      window.removeEventListener(EVENTO_AVISOS_NUEVOS, refrescar);
    };
  }, [router]);

  return (
    <Pestanas
      etiqueta="Mis referencias"
      valorInicial={inicial}
      items={[
        { id: 'para-mi', etiqueta: 'Para mí', contador: contadores.paraMi, contenido: paraMi },
        { id: 'esperando', etiqueta: 'Esperando a otros', contador: contadores.esperando, contenido: esperando },
        { id: 'recientes', etiqueta: 'Recientes', contenido: recientes },
      ]}
    />
  );
}
