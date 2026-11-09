'use client';

import { CheckCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { marcarNotificacionLeidaAccion, marcarTodasLeidasAccion } from '@/app/acciones/colaboracion';
import { Boton } from '@/componentes/ui/button';
import { useAvisos } from '@/componentes/ui/toast';
import { tituloSinMarca } from '@/dominio/colaboracion';
import { cn } from '@/lib/utils';
import type { NotificacionVista } from '@/server/politicas/colaboracion';
import { fechaHora, hace } from './api';
import { IconoAviso } from './piezas';

const ETIQUETA_TIPO: Record<string, string> = {
  asignacion: 'Envío',
  recordatorio: 'Recordatorio',
  respuesta: 'Parte lista',
  clasificada: 'Clasificada',
  reabierta: 'Reabierta',
  reapertura_solicitada: 'Reapertura',
  cambio_en_mi_campo: 'Cambio en tu campo',
  comentario: 'Comentario',
};

/** Una notificacion de la pagina completa: enlace a la ficha que la marca como leida al abrirla. */
export function FilaNotificacion({ n }: { n: NotificacionVista }) {
  const [leida, setLeida] = useState(n.leidaEn !== null);
  return (
    <li>
      <Link
        href={n.href}
        onClick={() => {
          if (!leida) {
            setLeida(true);
            void marcarNotificacionLeidaAccion({ notificacionId: n.id });
          }
        }}
        className={cn(
          'flex items-start gap-3.5 rounded-xl border px-4 py-3.5 transition-colors duration-150 hover:border-azul-500 hover:bg-azul-50/60',
          leida ? 'border-borde-suave bg-superficie' : 'border-azul-300 bg-azul-50/70',
        )}
        data-testid="fila-notificacion"
        data-leida={leida ? 'si' : 'no'}
      >
        <IconoAviso tipo={n.tipo} noLeida={!leida} />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-base leading-snug text-tinta', !leida && 'font-semibold')}>
            {!leida ? <span className="sr-solo">Nueva: </span> : null}
            {tituloSinMarca(n.titulo)}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-tinta-suave">
            <span>{ETIQUETA_TIPO[n.tipo] ?? 'Aviso'}</span>
            {/* El texto relativo depende de la hora: servidor y navegador pueden diferir un minuto. */}
            <time dateTime={n.creadaEn} title={fechaHora(n.creadaEn)} suppressHydrationWarning>
              {hace(n.creadaEn)}
            </time>
          </span>
        </span>
        {!leida ? (
          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-azul-800" aria-hidden>
            <span className="size-2 rounded-full bg-azul-500" />
            Nueva
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export function BotonMarcarTodas({ hayNoLeidas }: { hayNoLeidas: boolean }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [cargando, setCargando] = useState(false);
  return (
    <Boton
      variante="secundario"
      disabled={!hayNoLeidas}
      cargando={cargando}
      onClick={async () => {
        setCargando(true);
        const r = await marcarTodasLeidasAccion();
        setCargando(false);
        if (r.ok) {
          avisar({ tipo: 'exito', titulo: r.data.marcadas === 1 ? 'Marcaste 1 aviso como leído' : `Marcaste ${r.data.marcadas} avisos como leídos` });
          router.refresh();
        } else {
          avisar({ tipo: 'error', titulo: 'No pudimos marcar los avisos', descripcion: r.mensaje });
        }
      }}
    >
      <CheckCheck aria-hidden className="size-4" />
      Marcar todas como leídas
    </Boton>
  );
}
