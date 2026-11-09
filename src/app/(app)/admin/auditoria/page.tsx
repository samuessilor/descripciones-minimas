import { Download, ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ETIQUETA_ENTIDAD, etiquetaAccion, fechaHora } from '@/componentes/admin/formato';
import { Boton, botonVariantes } from '@/componentes/ui/button';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { Etiqueta } from '@/componentes/ui/etiqueta';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { Paginacion } from '@/componentes/ui/paginacion';
import { TablaDatos } from '@/componentes/ui/tabla';
import { nombreVisible } from '@/componentes/ui/avatar';
import {
  listarAuditoriaAdmin,
  opcionesFiltroAuditoria,
  type FilaAuditoria,
  type FiltrosAuditoria,
} from '@/server/politicas/administracion-auditoria';
import { contextoAdmin, param } from '../_contexto';

export const metadata: Metadata = { title: 'Auditoría · Descripciones mínimas' };

function enlaceEntidad(f: FilaAuditoria): string | null {
  switch (f.entidad) {
    case 'referencia':
      return `/referencias/${f.entidadId}`;
    case 'usuario':
      return f.entidadId === 'desconocido' ? null : `/admin/usuarios/${f.entidadId}`;
    case 'organizacion':
      return `/admin/organizaciones/${f.entidadId}`;
    default:
      // Envios, fotos...: la ficha viaja en el detalle.
      return typeof f.detalle?.referenciaId === 'string' ? `/referencias/${f.detalle.referenciaId}` : null;
  }
}

function valorLegible(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v === '' ? '—' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 1);
}

function Sobre({ f }: { f: FilaAuditoria }) {
  const href = enlaceEntidad(f);
  const nombre = ETIQUETA_ENTIDAD[f.entidad] ?? f.entidad;
  const texto = f.entidadEtiqueta ? nombreVisible(f.entidadEtiqueta) : null;
  const contenido = (
    <>
      <span className="text-tinta-suave">{nombre}</span>
      {texto ? <span className="ml-1.5 font-semibold text-tinta">{texto}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className="underline-offset-2 hover:underline">
      {contenido}
    </Link>
  ) : (
    <span>{contenido}</span>
  );
}

function Detalle({ f }: { f: FilaAuditoria }) {
  const entradas = Object.entries(f.detalle ?? {});
  return (
    <details className="group max-w-md text-sm">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded px-1 font-semibold text-azul-500 underline underline-offset-2 [&::-webkit-details-marker]:hidden">
        Ver detalle
      </summary>
      <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg border border-borde-suave bg-superficie-2 p-3">
        <dt className="text-tinta-suave">Evento</dt>
        <dd className="font-mono text-xs">#{f.id}</dd>
        <dt className="text-tinta-suave">Acción</dt>
        <dd className="font-mono text-xs">{f.accion}</dd>
        <dt className="text-tinta-suave">Sobre</dt>
        <dd className="break-all font-mono text-xs">
          {f.entidad} · {f.entidadId}
        </dd>
        <dt className="text-tinta-suave">Dirección IP</dt>
        <dd className="font-mono text-xs">{f.ip ?? '—'}</dd>
        {entradas.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-tinta-suave">{k.replace(/_/g, ' ')}</dt>
            <dd className="whitespace-pre-wrap break-words text-xs text-tinta">{valorLegible(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default async function AdminAuditoria({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const sp = await searchParams;
  const filtros: FiltrosAuditoria = {
    desde: param(sp.desde),
    hasta: param(sp.hasta),
    usuarioId: param(sp.persona),
    accion: param(sp.accion),
    ficha: param(sp.ficha),
    pagina: Math.max(1, Number(param(sp.pagina)) || 1),
  };
  const [{ filas, total, pagina, porPagina, fichaNoExiste }, opciones] = await Promise.all([
    listarAuditoriaAdmin(ctx.db, ctx.actor, filtros),
    opcionesFiltroAuditoria(ctx.db, ctx.actor),
  ]);

  const consulta = (extra: Record<string, string | undefined> = {}) => {
    const u = new URLSearchParams();
    const base: Record<string, string | undefined> = { desde: filtros.desde, hasta: filtros.hasta, persona: filtros.usuarioId, accion: filtros.accion, ficha: filtros.ficha, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const hayFiltros = !!(filtros.desde || filtros.hasta || filtros.usuarioId || filtros.accion || filtros.ficha);
  const desdeFila = total === 0 ? 0 : (pagina - 1) * porPagina + 1;
  const hastaFila = Math.min(total, pagina * porPagina);
  const hayMas = pagina * porPagina < total;

  return (
    <>
      <EncabezadoPagina
        titulo="Auditoría"
        descripcion="Quién hizo qué y cuándo. Es un registro de solo lectura: nadie puede cambiarlo ni borrarlo."
        acciones={
          <a href={`/api/admin/auditoria/exportar${consulta()}`} className={botonVariantes({ variante: 'secundario' })} download>
            <Download aria-hidden className="size-4" />
            Descargar CSV
          </a>
        }
      />

      <form method="get" action="/admin/auditoria" role="search" aria-label="Filtrar la auditoría" className="mb-4 grid gap-3 rounded-xl border border-borde-suave bg-superficie p-4 shadow-suave sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <div className="space-y-1.5">
          <Etiqueta htmlFor="a-desde">Desde</Etiqueta>
          <Campo id="a-desde" name="desde" type="date" defaultValue={filtros.desde ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="a-hasta">Hasta</Etiqueta>
          <Campo id="a-hasta" name="hasta" type="date" defaultValue={filtros.hasta ?? ''} />
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="a-persona">Persona</Etiqueta>
          <Seleccion id="a-persona" name="persona" defaultValue={filtros.usuarioId ?? ''}>
            <option value="">Todas</option>
            {opciones.usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {nombreVisible(u.nombre)}
              </option>
            ))}
          </Seleccion>
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="a-accion">Acción</Etiqueta>
          <Seleccion id="a-accion" name="accion" defaultValue={filtros.accion ?? ''}>
            <option value="">Todas</option>
            {opciones.acciones.map((a) => (
              <option key={a} value={a}>
                {etiquetaAccion(a)}
              </option>
            ))}
          </Seleccion>
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="a-ficha">Referencia</Etiqueta>
          <Campo id="a-ficha" name="ficha" defaultValue={filtros.ficha ?? ''} placeholder="Código, ej. TEST-0001" autoComplete="off" />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Boton type="submit" variante="secundario" className="flex-1">
            Filtrar
          </Boton>
          {hayFiltros ? (
            <Link href="/admin/auditoria" className={botonVariantes({ variante: 'terciario' })}>
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      <p className="mb-3 text-sm text-tinta-suave" aria-live="polite">
        {total === 0 ? 'Sin eventos' : `Eventos ${desdeFila.toLocaleString('es-CO')}–${hastaFila.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`}, del más reciente al más antiguo. Hora de Bogotá.
      </p>

      <TablaDatos
        etiqueta="Eventos de auditoría"
        filas={filas}
        clave={(f) => String(f.id)}
        columnas={[
          { id: 'fecha', encabezado: 'Fecha', celda: (f) => <span className="whitespace-nowrap text-sm">{fechaHora(f.creadoEn)}</span> },
          { id: 'persona', encabezado: 'Persona', celda: (f) => <span className="text-sm">{f.usuarioNombre ? nombreVisible(f.usuarioNombre) : <span className="text-tinta-suave">Sin sesión</span>}</span> },
          { id: 'accion', encabezado: 'Acción', celda: (f) => <span className="text-sm font-semibold">{etiquetaAccion(f.accion)}</span> },
          { id: 'sobre', encabezado: 'Sobre', ocultarBajo: 'md', celda: (f) => <span className="text-sm"><Sobre f={f} /></span> },
          { id: 'detalle', encabezado: 'Detalle', celda: (f) => <Detalle f={f} /> },
        ]}
        vacio={
          <EstadoVacio
            icono={ScrollText}
            titulo={fichaNoExiste ? 'No existe esa referencia' : hayFiltros ? 'Ningún evento con esos filtros' : 'Todavía no hay eventos'}
            descripcion={
              fichaNoExiste
                ? 'Revisa el código tal como aparece en la ficha. No importan las mayúsculas ni los guiones.'
                : hayFiltros
                  ? 'Prueba con otro rango de fechas o quita algún filtro.'
                  : 'Cada ingreso, invitación y cambio quedará registrado aquí.'
            }
            accion={
              hayFiltros ? (
                <Link href="/admin/auditoria" className={botonVariantes({ variante: 'secundario' })}>
                  Quitar los filtros
                </Link>
              ) : undefined
            }
          />
        }
      />

      {total > porPagina ? (
        <Paginacion
          className="mt-4"
          resumen={`Página ${pagina} de ${Math.ceil(total / porPagina)}`}
          anterior={pagina > 1 ? { href: `/admin/auditoria${consulta({ pagina: String(pagina - 1) })}` } : null}
          siguiente={hayMas ? { href: `/admin/auditoria${consulta({ pagina: String(pagina + 1) })}` } : null}
        />
      ) : null}
    </>
  );
}
