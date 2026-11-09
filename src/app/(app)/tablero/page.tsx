import { CircleCheck, Hourglass, TriangleAlert, UserRoundX } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { destinosPara } from '@/componentes/navegacion';
import { BotonExportar } from '@/componentes/slots/BotonExportar';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { ContenedorAncho, ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { Tarjeta } from '@/componentes/ui/tarjeta';
import { nombreDeArea } from '@/dominio/areas';
import { ETIQUETA_TIPO } from '@/dominio/campos';
import { ETIQUETA_PARTE, plural, textoDias, type ParteFicha } from '@/dominio/colaboracion';
import { cn } from '@/lib/utils';
import { DIAS_DETENIDA, PARTES, tableroDe, type FilaTablero } from '@/server/politicas/tablero';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Resumen · Descripciones mínimas' };

const ETIQUETA_CORTA: Record<ParteFicha, string> = { producto: 'Producto', detalle: 'Detalle', especificaciones: 'Especif.', aduana: 'Aduana' };

const FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });

/** Primero lo detenido (lleva dias sin moverse), luego lo que nadie tiene, luego lo mas antiguo. */
function prioridad(f: FilaTablero): number {
  return (f.detenida ? 2 : 0) + (f.bloqueo.clase === 'sin_responsable' ? 1 : 0);
}

export default async function Tablero() {
  const ctx = await exigirContexto();
  // El servidor aplica la misma regla que el menu: quien no ve «Resumen» en la navegacion (la aduana) no lo abre por URL.
  if (!destinosPara(ctx.actor.rol).some((d) => d.href === '/tablero')) {
    return (
      <ContenedorLectura>
        <SinPermiso />
      </ContenedorLectura>
    );
  }
  const ahora = new Date();
  const t = await tableroDe(ctx.db, ctx.actor, ahora);
  const abiertas = [...t.abiertas].sort((a, b) => prioridad(b) - prioridad(a) || b.diasEnGestion - a.diasEnGestion);

  return (
    <ContenedorAncho>
      <EncabezadoPagina
        titulo="Resumen"
        descripcion="Qué está cerrado, qué falta y de quién está pendiente cada parte."
        acciones={<BotonExportar />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="resumen-cifras">
        <Cifra icono={<CircleCheck aria-hidden className="size-5" />} tono="verde" valor={t.resumen.clasificadas} etiqueta="Clasificadas" />
        <Cifra icono={<TriangleAlert aria-hidden className="size-5" />} tono="amarillo" valor={t.resumen.abiertas} etiqueta="Abiertas" />
        <Cifra
          icono={<UserRoundX aria-hidden className="size-5" />}
          tono={t.resumen.sinResponsable > 0 ? 'amarillo' : 'neutro'}
          valor={t.resumen.sinResponsable}
          etiqueta="Sin responsable"
          href="/referencias?sinResponsable=1"
        />
        <Cifra
          icono={<Hourglass aria-hidden className="size-5" />}
          tono={t.resumen.detenidas > 0 ? 'amarillo' : 'neutro'}
          valor={t.resumen.detenidas}
          etiqueta={`Sin moverse ${DIAS_DETENIDA}+ días`}
        />
      </div>

      {t.porPersona.length > 0 ? (
        <section aria-labelledby="h-personas" className="mt-8">
          <h2 id="h-personas" className="mb-3 text-lg font-bold text-tinta">
            Qué espera cada persona
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {t.porPersona.map((p) => (
              <li key={p.usuarioId} className="flex items-center gap-3 rounded-xl border border-borde-suave bg-superficie px-4 py-3 shadow-suave">
                <Avatar nombre={p.nombre} tamano="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-tinta">{nombreVisible(p.nombre)}</p>
                  <p className="truncate text-xs text-tinta-suave">{p.organizacion}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold tabular-nums text-tinta">{p.pendientes}</p>
                  <p className="text-xs text-tinta-suave">{p.masAntiguaDias > 0 ? `desde hace ${textoDias(p.masAntiguaDias)}` : 'desde hoy'}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="h-abiertas" className="mt-8">
        <h2 id="h-abiertas" className="mb-3 text-lg font-bold text-tinta">
          Abiertas
          <span className="ml-2 text-sm font-normal text-tinta-suave">{plural(abiertas.length, 'referencia', 'referencias')} · lo urgente primero</span>
        </h2>
        {abiertas.length === 0 ? (
          <EstadoVacio titulo="No hay referencias abiertas" descripcion="Todo lo que se pidió ya está clasificado." />
        ) : (
          <Tarjeta className="overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,2.4fr)_minmax(0,1.3fr)_5.5rem] gap-4 border-b border-borde-suave bg-superficie-2 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave lg:grid">
              <span>Referencia</span>
              <span>Partes</span>
              <span>Quién falta</span>
              <span className="text-right">Días</span>
            </div>
            <ul className="divide-y divide-borde-suave" data-testid="resumen-abiertas">
              {abiertas.map((f) => (
                <FilaAbierta key={f.id} f={f} />
              ))}
            </ul>
          </Tarjeta>
        )}
      </section>

      <section aria-labelledby="h-cerradas" className="mt-8">
        <h2 id="h-cerradas" className="mb-3 text-lg font-bold text-tinta">
          Cerradas
          <span className="ml-2 text-sm font-normal text-tinta-suave">las últimas {t.cerradas.length} · el historial completo está en «Referencias» y en el Excel</span>
        </h2>
        {t.cerradas.length === 0 ? (
          <EstadoVacio titulo="Aún no hay referencias clasificadas" descripcion="Cuando la aduana cierre una, aparece aquí con su fecha." />
        ) : (
          <Tarjeta className="overflow-hidden">
            <ul className="divide-y divide-borde-suave" data-testid="resumen-cerradas">
              {t.cerradas.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/referencias/${f.id}`}
                    className="grid items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-foco sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_9rem_5.5rem]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-tinta">{f.codigo}</span>
                      <span className="block truncate text-sm text-tinta-suave">
                        {f.nombreProducto} · {ETIQUETA_TIPO[f.tipoProducto]}
                      </span>
                    </span>
                    <span className="truncate text-sm tabular-nums text-tinta-suave">{f.partida ? `Partida ${f.partida}` : 'Sin partida'}</span>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-verde-texto">
                      <CircleCheck aria-hidden className="size-4" />
                      {f.clasificadaEn ? FECHA.format(new Date(f.clasificadaEn)).replace(/\./g, '') : 'Clasificada'}
                    </span>
                    <span className="text-sm tabular-nums text-tinta-suave sm:text-right">{textoDias(f.diasEnGestion)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Tarjeta>
        )}
      </section>
    </ContenedorAncho>
  );
}

function Cifra({
  icono,
  valor,
  etiqueta,
  tono,
  href,
}: {
  icono: ReactNode;
  valor: number;
  etiqueta: string;
  tono: 'verde' | 'amarillo' | 'neutro';
  /** Lista que produce la cifra (opcional). */
  href?: string;
}) {
  const clases = cn(
    'flex items-center gap-3 rounded-xl border px-4 py-3 shadow-suave',
    tono === 'verde' && 'border-verde-solido bg-verde-fondo text-verde-texto',
    tono === 'amarillo' && 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
    tono === 'neutro' && 'border-borde-suave bg-superficie text-tinta-suave',
    href && 'hover:underline focus-visible:outline-2 focus-visible:outline-foco',
  );
  const contenido = (
    <>
      {icono}
      <div>
        <p className="text-2xl font-extrabold leading-none tabular-nums">{valor}</p>
        <p className="mt-1 text-xs font-semibold">{etiqueta}</p>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className={clases}>
      {contenido}
    </Link>
  ) : (
    <div className={clases}>{contenido}</div>
  );
}

function FilaAbierta({ f }: { f: FilaTablero }) {
  const urgente = f.bloqueo.clase === 'sin_responsable';
  return (
    <li>
      <Link
        href={`/referencias/${f.id}`}
        className="grid items-start gap-x-4 gap-y-2 px-4 py-3 hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-foco lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2.4fr)_minmax(0,1.3fr)_5.5rem]"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-tinta">{f.codigo}</span>
          <span className="block truncate text-sm text-tinta-suave">
            {f.nombreProducto} · {ETIQUETA_TIPO[f.tipoProducto]}
          </span>
        </span>
        <span className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {PARTES.map((p) => (
            <Parte key={p} parte={p} f={f} />
          ))}
        </span>
        <span className={cn('text-sm', urgente ? 'font-semibold text-amarillo-texto' : 'text-tinta')}>{f.bloqueo.texto}</span>
        <span className="text-sm tabular-nums lg:text-right">
          <span className="block text-tinta">{textoDias(f.diasEnGestion)}</span>
          {f.detenida ? <span className="block text-xs font-semibold text-amarillo-texto">sin moverse {f.diasSinMovimiento} d</span> : null}
        </span>
      </Link>
    </li>
  );
}

function Parte({ parte, f }: { parte: ParteFicha; f: FilaTablero }) {
  const v = f.partes[parte];
  const verde = v.estado === 'verde';
  const dueno = v.responsables[0];
  return (
    <span
      data-estado={v.estado}
      title={verde ? `${ETIQUETA_PARTE[parte]}: completa` : `${ETIQUETA_PARTE[parte]}: ${v.faltan > 0 ? plural(v.faltan, 'campo por llenar', 'campos por llenar') : 'pendiente'}`}
      className={cn(
        'min-w-0 rounded-lg border px-2 py-1.5 text-xs leading-tight',
        verde ? 'border-verde-solido bg-verde-fondo text-verde-texto' : 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
      )}
    >
      <span className="flex items-center gap-1 font-semibold">
        {verde ? <CircleCheck aria-hidden className="size-3.5 shrink-0" /> : <TriangleAlert aria-hidden className="size-3.5 shrink-0" />}
        <span className="truncate">{ETIQUETA_CORTA[parte]}</span>
      </span>
      {verde ? null : (
        <span className="mt-0.5 block truncate font-normal">
          {dueno
            ? `${nombreVisible(dueno.nombre).split(' ')[0]}${v.responsables.length > 1 ? ` +${v.responsables.length - 1}` : ''}`
            : v.faltan === 0 && parte !== 'aduana'
              ? 'Pide la aduana'
              : f.area && parte !== 'aduana'
                ? nombreDeArea(f.area)
                : 'Sin asignar'}
        </span>
      )}
    </span>
  );
}
