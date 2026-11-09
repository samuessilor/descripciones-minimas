'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Pestanas } from '@/componentes/ui/pestanas';
import { EVENTO_PRESENCIA, presente } from './presencia';

/**
 * Pestañas del inicio: «Para mí · Esperando a otros · Recientes» (F7). El contenido de cada una llega ya
 * dibujado desde el servidor; aqui solo se cambia de pestaña. Tambien refresca la bandeja sola cada ~45 s mientras
 * la pestaña del navegador esta visible y en uso, y al volver a ella: asi un aviso nuevo aparece sin recargar a mano.
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
    const refrescar = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const t = setInterval(() => {
      if (presente()) router.refresh();
    }, 45_000);
    document.addEventListener('visibilitychange', refrescar);
    window.addEventListener(EVENTO_PRESENCIA, refrescar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refrescar);
      window.removeEventListener(EVENTO_PRESENCIA, refrescar);
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
