import { BellOff } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BotonMarcarTodas, FilaNotificacion } from '@/componentes/colaboracion/ListaNotificaciones';
import { EnlaceBoton } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { ContenedorAncho, EncabezadoPagina } from '@/componentes/ui/pagina';
import { cn } from '@/lib/utils';
import { notificacionesDe } from '@/server/politicas/colaboracion';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Notificaciones · Descripciones mínimas' };

/**
 * Bandeja completa (3.6): todos los avisos, filtro «Todas / Sin leer», «Marcar todas como leídas» y paginacion
 * por cursor. La campana de la barra muestra solo las ultimas. El pendiente real vive en «Para mí» del inicio.
 */
export default async function Notificaciones({ searchParams }: { searchParams: Promise<{ f?: string; antes?: string }> }) {
  const { f, antes } = await searchParams;
  const soloNoLeidas = f === 'no-leidas';
  const soloLeidas = f === 'leidas';
  const { db, actor } = await exigirContexto();
  const lista = await notificacionesDe(db, actor, { soloNoLeidas, soloLeidas, limite: 25, antes: antes ?? null });
  const hayNoLeidas = lista.noLeidas > 0;

  const pestana = (activa: boolean) =>
    cn(
      'inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-semibold transition-colors duration-150',
      activa ? 'border-azul-700 bg-azul-700 text-white' : 'border-borde-campo bg-superficie text-tinta hover:border-azul-700 hover:bg-azul-50',
    );

  return (
    <ContenedorAncho>
      <div className="mx-auto max-w-3xl">
        <EncabezadoPagina
          titulo="Notificaciones"
          descripcion="Envíos, recordatorios, comentarios y cambios en lo que escribiste. Lo que tienes pendiente está en el inicio."
          acciones={<BotonMarcarTodas hayNoLeidas={hayNoLeidas} />}
        />

        <nav aria-label="Filtrar avisos" className="mb-5 flex flex-wrap gap-2">
          <Link href="/notificaciones" aria-current={!soloNoLeidas && !soloLeidas ? 'page' : undefined} className={pestana(!soloNoLeidas && !soloLeidas)}>
            Todas
          </Link>
          <Link href="/notificaciones?f=no-leidas" aria-current={soloNoLeidas ? 'page' : undefined} className={pestana(soloNoLeidas)}>
            Sin leer
            {hayNoLeidas ? (
              <span className={cn('inline-flex min-h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold', soloNoLeidas ? 'bg-white text-azul-900' : 'bg-azul-700 text-white')}>
                {lista.noLeidas}
              </span>
            ) : null}
          </Link>
          <Link href="/notificaciones?f=leidas" aria-current={soloLeidas ? 'page' : undefined} className={pestana(soloLeidas)}>
            Leídas
          </Link>
        </nav>

        {lista.items.length === 0 ? (
          <EstadoVacio
            icono={BellOff}
            titulo={soloNoLeidas ? 'No tienes avisos sin leer' : soloLeidas ? 'Aún no has leído ningún aviso' : 'Todavía no tienes avisos'}
            descripcion={
              soloNoLeidas
                ? 'Estás al día. Los avisos que ya leíste siguen en «Todas».'
                : soloLeidas
                  ? 'Cuando leas un aviso, queda guardado aquí.'
                  : 'Cuando alguien te envíe una referencia, te recuerde algo o comente, el aviso aparece aquí.'
            }
            accion={
              soloNoLeidas || soloLeidas ? (
                <EnlaceBoton href="/notificaciones" variante="secundario">
                  Ver todas
                </EnlaceBoton>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="space-y-2.5" aria-label="Avisos">
              {lista.items.map((n) => (
                <FilaNotificacion key={n.id} n={n} />
              ))}
            </ul>
            {lista.siguiente ? (
              <div className="mt-6 flex justify-center">
                <EnlaceBoton
                  href={`/notificaciones?${soloNoLeidas ? 'f=no-leidas&' : soloLeidas ? 'f=leidas&' : ''}antes=${encodeURIComponent(lista.siguiente)}`}
                  variante="secundario"
                >
                  Ver avisos más antiguos
                </EnlaceBoton>
              </div>
            ) : null}
          </>
        )}
      </div>
    </ContenedorAncho>
  );
}
