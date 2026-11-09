import { Mail, RefreshCw, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { reintentarCorreoAccion } from '@/app/acciones/admin';
import { BotonAccion } from '@/componentes/admin/acciones';
import { dentroDe, etiquetaPlantillaCorreo, fechaHora, hace, plural } from '@/componentes/admin/formato';
import { Seccion } from '@/componentes/admin/piezas';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton, botonVariantes } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Campo } from '@/componentes/ui/input';
import { Insignia } from '@/componentes/ui/insignia';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { Paginacion } from '@/componentes/ui/paginacion';
import { TablaDatos } from '@/componentes/ui/tabla';
import { cn } from '@/lib/utils';
import {
  ESTADOS_CORREO,
  listarCorreoDev,
  listarCorreosAdmin,
  resumenColaCorreo,
  type EstadoCorreo,
  type FilaCorreoAdmin,
} from '@/server/politicas/administracion-correo';
import { contextoAdmin, param } from '../_contexto';

export const metadata: Metadata = { title: 'Cola de correo · Descripciones mínimas' };

const NOMBRE: Record<EstadoCorreo, string> = {
  pendiente: 'En cola',
  enviando: 'Enviándose',
  enviado: 'Enviado',
  fallido: 'Fallido',
  abandonado: 'Abandonado',
};
const VARIANTE: Record<EstadoCorreo, 'azul' | 'contorno' | 'oscura' | 'error' | 'neutra'> = {
  pendiente: 'contorno',
  enviando: 'azul',
  enviado: 'oscura',
  fallido: 'error',
  abandonado: 'neutra',
};
const AYUDA: Record<EstadoCorreo, string> = {
  pendiente: 'Esperando su turno en la cola.',
  enviando: 'Lo tiene el despachador ahora mismo.',
  enviado: 'El proveedor lo aceptó. Que llegue al buzón no se puede confirmar desde aquí.',
  fallido: 'No salió; la cola lo intentará de nuevo sola.',
  abandonado: 'Agotó sus intentos o ya no hay a quién enviárselo. Reintenta a mano si corresponde.',
};

function CuandoCorreo({ f }: { f: FilaCorreoAdmin }) {
  if (f.estado === 'enviado') return <span title={fechaHora(f.enviadoEn)}>Enviado {hace(f.enviadoEn)}</span>;
  if (f.estado === 'pendiente' || f.estado === 'fallido') return <span>Próximo intento {dentroDe(f.proximoIntento)}</span>;
  if (f.estado === 'enviando') return <span>Enviándose</span>;
  return <span className="text-tinta-suave">Sin más intentos</span>;
}

export default async function AdminCorreo({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const sp = await searchParams;
  const estado = ESTADOS_CORREO.find((e) => e === param(sp.estado));
  const q = param(sp.q);
  const pagina = Math.max(1, Number(param(sp.pagina)) || 1);

  const [conteos, lista, dev] = await Promise.all([
    resumenColaCorreo(ctx.db, ctx.actor),
    listarCorreosAdmin(ctx.db, ctx.actor, { estado, q, pagina }),
    listarCorreoDev(ctx.db, ctx.actor),
  ]);
  const total = Object.values(conteos).reduce((a, b) => a + b, 0);
  const con = (extra: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const base: Record<string, string | undefined> = { estado, q, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v);
    const s = u.toString();
    return `/admin/correo${s ? `?${s}` : ''}`;
  };
  const esDev = process.env.NODE_ENV === 'development';
  const hayMas = lista.pagina * lista.porPagina < lista.total;

  return (
    <>
      <EncabezadoPagina
        titulo="Cola de correo"
        descripcion="Los avisos con enlace que salen a cada persona. El pendiente existe igual en su bandeja aunque el correo falle."
      />

      <nav aria-label="Filtrar por estado" className="mb-4">
        <ul className="flex flex-wrap gap-1.5">
          {[{ id: undefined, nombre: 'Todos', n: total }, ...ESTADOS_CORREO.map((e) => ({ id: e as EstadoCorreo | undefined, nombre: NOMBRE[e], n: conteos[e] }))].map((c) => {
            const activa = c.id === estado;
            return (
              <li key={c.id ?? 'todos'}>
                <Link
                  href={con({ estado: c.id, pagina: undefined })}
                  aria-current={activa ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm transition-colors duration-150',
                    activa ? 'border-azul-700 bg-azul-700 font-bold text-white' : 'border-borde-campo bg-superficie font-semibold text-tinta hover:border-azul-700 hover:bg-azul-50',
                  )}
                >
                  {c.nombre}
                  <span className={cn('tabular-nums', activa ? 'text-azul-200' : (c.id === 'fallido' || c.id === 'abandonado') && c.n > 0 ? 'text-error' : 'text-tinta-suave')}>{c.n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {estado ? <p className="mb-4 text-sm text-tinta-suave">{AYUDA[estado]}</p> : null}

      <form method="get" action="/admin/correo" role="search" aria-label="Buscar por destinatario" className="mb-4 flex flex-wrap items-center gap-2">
        {estado ? <input type="hidden" name="estado" value={estado} /> : null}
        <div className="relative min-w-0 flex-1 basis-64 sm:max-w-sm">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
          <Campo name="q" type="search" defaultValue={q ?? ''} placeholder="Buscar por correo del destinatario" aria-label="Buscar por correo del destinatario" className="pl-9" autoComplete="off" />
        </div>
        <Boton type="submit" variante="secundario">
          Buscar
        </Boton>
        {q ? (
          <Link href={con({ q: undefined })} className={botonVariantes({ variante: 'terciario' })}>
            Quitar búsqueda
          </Link>
        ) : null}
      </form>

      <TablaDatos
        etiqueta="Correos de la cola"
        filas={lista.filas}
        clave={(f) => f.id}
        columnas={[
          { id: 'estado', encabezado: 'Estado', celda: (f) => <Insignia variante={VARIANTE[f.estado]}>{NOMBRE[f.estado]}</Insignia> },
          {
            id: 'dest',
            encabezado: 'Destinatario',
            celda: (f) => (
              <span className="block min-w-0">
                <span className="block break-all text-sm font-semibold text-tinta">{f.destinatario}</span>
                <span className="block text-xs text-tinta-suave">{etiquetaPlantillaCorreo(f.plantilla)}</span>
              </span>
            ),
          },
          { id: 'cuando', encabezado: 'Cuándo', ocultarBajo: 'md', celda: (f) => <span className="text-sm text-tinta-suave"><CuandoCorreo f={f} /></span> },
          { id: 'intentos', encabezado: 'Intentos', alinear: 'der', ocultarBajo: 'md', celda: (f) => f.intentos },
          {
            id: 'error',
            encabezado: 'Error',
            ocultarBajo: 'lg',
            className: 'max-w-xs',
            celda: (f) => (f.ultimoError ? <span className="line-clamp-2 break-words text-sm text-error" title={f.ultimoError}>{f.ultimoError}</span> : <span className="text-sm text-tinta-suave">—</span>),
          },
          {
            id: 'acciones',
            encabezado: <span className="sr-solo">Acciones</span>,
            etiquetaTarjeta: 'Acciones',
            alinear: 'der',
            celda: (f) => (
              <span className="flex flex-wrap items-center justify-end gap-2">
                <Link href={`/admin/correo/${f.id}`} className={botonVariantes({ variante: 'terciario', tamano: 'sm' })} aria-label={`Ver el correo a ${f.destinatario}`}>
                  Ver
                </Link>
                {f.estado === 'fallido' || f.estado === 'abandonado' ? (
                  <BotonAccion
                    accion={reintentarCorreoAccion}
                    campos={{ entregaId: f.id }}
                    etiquetaAria={`Reintentar el correo a ${f.destinatario}`}
                  >
                    <RefreshCw aria-hidden className="size-4" />
                    Reintentar
                  </BotonAccion>
                ) : null}
              </span>
            ),
          },
        ]}
        vacio={
          <EstadoVacio
            icono={Mail}
            titulo={total === 0 ? 'La cola está vacía' : 'Ningún correo con ese filtro'}
            descripcion={
              total === 0
                ? 'Aquí aparecerán los avisos que se envíen a las personas (referencias nuevas, recordatorios, respuestas…). Todavía no se ha encolado ninguno.'
                : 'Prueba con otro estado o quita la búsqueda.'
            }
            accion={
              estado || q ? (
                <Link href="/admin/correo" className={botonVariantes({ variante: 'secundario' })}>
                  Ver todos
                </Link>
              ) : undefined
            }
          />
        }
      />

      {lista.total > lista.porPagina ? (
        <Paginacion
          className="mt-4"
          resumen={`${plural(lista.total, 'correo', 'correos')} · página ${lista.pagina} de ${Math.ceil(lista.total / lista.porPagina)}`}
          anterior={lista.pagina > 1 ? { href: con({ pagina: String(lista.pagina - 1) }) } : null}
          siguiente={hayMas ? { href: con({ pagina: String(lista.pagina + 1) }) } : null}
        />
      ) : null}

      {esDev ? (
        <div className="mt-10">
          <Seccion
            id="desarrollo"
            titulo="Correos de desarrollo"
            descripcion="Solo en desarrollo: los enlaces de acceso e invitaciones salen por consola y quedan aquí. En producción esta sección no existe."
            sinPadding
          >
            {dev.length === 0 ? (
              <p className="px-5 py-4 text-base text-tinta-suave">Todavía no ha salido ningún correo de acceso.</p>
            ) : (
              <ul className="divide-y divide-borde-suave">
                {dev.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="break-all text-sm font-semibold text-tinta">{d.destinatario}</p>
                      <p className="text-sm text-tinta-suave">{d.asunto}</p>
                    </div>
                    <span className="text-sm text-tinta-suave">{hace(d.creadoEn)}</span>
                    <Link href={`/admin/correo/${d.id}?origen=desarrollo`} className={botonVariantes({ variante: 'terciario', tamano: 'sm' })} aria-label={`Ver el correo de desarrollo a ${d.destinatario}`}>
                      Ver
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </div>
      ) : (
        <Aviso tipo="info" className="mt-8">
          Los correos de entrada (enlace de acceso e invitación) salen directo por el proveedor y no pasan por esta cola.
        </Aviso>
      )}
    </>
  );
}
