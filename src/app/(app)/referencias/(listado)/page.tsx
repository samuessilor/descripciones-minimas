import { Archive, CircleCheck, Layers, TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Estado } from '@/componentes/Estado';
import { FiltrosListado } from '@/componentes/listado/FiltrosListado';
import { BotonExportar } from '@/componentes/slots/BotonExportar';
import { EnlaceBoton } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { nombreVisible } from '@/componentes/ui/avatar';
import { Insignia } from '@/componentes/ui/insignia';
import { ContenedorAncho, EncabezadoPagina } from '@/componentes/ui/pagina';
import { Paginacion } from '@/componentes/ui/paginacion';
import { TablaDatos, type ColumnaTabla } from '@/componentes/ui/tabla';
import { nombreDeArea } from '@/dominio/areas';
import { ETIQUETA_TIPO } from '@/dominio/campos';
import { puede } from '@/dominio/permisos';
import { cn } from '@/lib/utils';
import {
  filtrosDesdeParametros,
  listarPagina,
  parametrosDeFiltros,
  type EstadoFiltro,
  type FilaListadoVista,
  type FiltrosListado as Filtros,
} from '@/server/politicas/listado';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Referencias · Descripciones mínimas' };

const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' });
const FORMATO_HORA = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
const FORMATO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' });
const NUMERO = new Intl.NumberFormat('es-CO');

function actualizada(iso: string, ahora: Date): string {
  const d = new Date(iso);
  if (FORMATO_DIA.format(d) === FORMATO_DIA.format(ahora)) return `hoy, ${FORMATO_HORA.format(d)}`;
  return FORMATO_FECHA.format(d).replace('.', '');
}

function href(f: Filtros, cambios: Partial<Filtros>): string {
  const qs = parametrosDeFiltros({ ...f, pagina: 1, ...cambios }).toString();
  return qs ? `/referencias?${qs}` : '/referencias';
}

function Faltante({ fila }: { fila: FilaListadoVista }) {
  if (fila.archivada) return <span className="text-tinta-suave">Archivada</span>;
  if (fila.estado === 'CLASIFICADA') return <span className="text-tinta-suave">—</span>;
  if (fila.pendiente) {
    // Seccion amarilla sin campos vacios (la aduana marco «NO»): se dice por que, no «faltan 0»
    if (fila.pendiente.faltan === 0) {
      return (
        <span>
          <span className="font-semibold text-tinta">{fila.pendiente.etiqueta}</span>{' '}
          <span className="text-tinta-suave">· {fila.pendiente.texto}</span>
        </span>
      );
    }
    return (
      // Puede partir entre la seccion y «· faltan N» (asi la columna no fuerza ancho), pero «· faltan N» va junto
      <span>
        <span className="font-semibold text-tinta">{fila.pendiente.etiqueta}</span>{' '}
        <span className="whitespace-nowrap text-tinta-suave">
          · {fila.pendiente.faltan === 1 ? 'falta 1' : `faltan ${fila.pendiente.faltan}`}
        </span>
      </span>
    );
  }
  if (fila.esperaRespuesta) return <span className="text-tinta">Falta la respuesta del área</span>;
  return <span className="text-tinta-suave">Solo falta la aduana</span>;
}

function EnEspera({ fila }: { fila: FilaListadoVista }) {
  if (fila.estado === 'CLASIFICADA' || fila.archivada) return <span className="text-tinta-suave">—</span>;
  if (fila.responsables.length === 0) {
    // Nadie la tiene en la mano: es de su area responsable (C1), si esa area tiene cuenta.
    if (fila.area) return <span className="text-tinta">{nombreDeArea(fila.area)}</span>;
    return fila.sinResponsable ? <Insignia variante="contorno">Sin responsable</Insignia> : <span className="text-tinta-suave">Aún sin enviar</span>;
  }
  const [primero, ...resto] = fila.responsables;
  return (
    <span className="text-tinta">
      {nombreVisible(primero ?? '')}
      {resto.length > 0 ? <span className="text-tinta-suave"> +{resto.length}</span> : null}
    </span>
  );
}

/**
 * El esqueleto de carga (`loading.tsx`) vive en el grupo `(listado)` y no en la carpeta `referencias/`: un
 * `loading.tsx` en la carpeta envolveria tambien a `/referencias/[id]` y una ficha ajena responderia 200 en vez de 404.
 */
export default async function Referencias({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { db, actor } = await exigirContexto();
  const ahora = new Date();
  const filtros = filtrosDesdeParametros(await searchParams);
  const esInterno = actor.organizacionTipo === 'interna';
  const puedeCrear = puede(actor, 'crear_referencia');
  const puedeArchivadas = actor.rol !== 'aduana';

  const r = await listarPagina(db, actor, filtros, ahora);
  const hayFiltros = !!(filtros.q || filtros.partida || filtros.tipo || filtros.mias || filtros.agencia || filtros.sinResponsable);
  const hayAlgo = hayFiltros || filtros.estado !== 'todas';
  const totalGeneral = r.contadores.amarillas + r.contadores.verdes;

  const pestanas: Array<{ id: EstadoFiltro; etiqueta: string; valor: number | null; icono: ReactNode }> = [
    { id: 'todas', etiqueta: 'Todas', valor: totalGeneral, icono: <Layers aria-hidden className="size-5" /> },
    { id: 'amarillas', etiqueta: 'Pendientes', valor: r.contadores.amarillas, icono: <TriangleAlert aria-hidden className="size-5" strokeWidth={2.25} /> },
    { id: 'verdes', etiqueta: 'Clasificadas', valor: r.contadores.verdes, icono: <CircleCheck aria-hidden className="size-5" strokeWidth={2.25} /> },
    ...(puedeArchivadas ? [{ id: 'archivadas' as const, etiqueta: 'Archivadas', valor: null, icono: <Archive aria-hidden className="size-5" /> }] : []),
  ];

  const columnas: ColumnaTabla<FilaListadoVista>[] = [
    {
      id: 'estado',
      encabezado: 'Estado',
      celda: (f) =>
        f.archivada ? (
          <Insignia variante="neutra">Archivada</Insignia>
        ) : (
          <Estado color={f.color} texto={f.color === 'verde' ? 'Clasificada' : 'Pendiente'} tamano="sm" sinRol />
        ),
    },
    {
      id: 'codigo',
      encabezado: 'Código',
      principal: true,
      celda: (f) => <span className="font-mono text-[0.9375rem] font-bold tracking-wide">{f.codigo}</span>,
    },
    {
      id: 'nombre',
      encabezado: 'Nombre del producto',
      celda: (f) => <span className="line-clamp-2 break-words">{f.nombreProducto}</span>,
      className: 'max-w-[18rem]',
      etiquetaTarjeta: 'Producto',
    },
    // Tipo y Actualizada se ocultan bajo 1152 px de tabla: con menu lateral, las 9 columnas no caben ni a 1440 px de ventana
    { id: 'tipo', encabezado: 'Tipo', ocultarBajo: 'xl', celda: (f) => <span className="text-tinta-suave">{ETIQUETA_TIPO[f.tipoProducto]}</span> },
    { id: 'falta', encabezado: 'Falta', celda: (f) => <Faltante fila={f} />, etiquetaTarjeta: 'Falta' },
    { id: 'espera', encabezado: 'En espera de', ocultarBajo: 'lg', celda: (f) => <EnEspera fila={f} />, etiquetaTarjeta: 'En espera de' },
    {
      id: 'partida',
      encabezado: 'Partida final',
      ocultarBajo: 'lg',
      celda: (f) =>
        f.partida ? <span className="whitespace-nowrap font-mono text-[0.9375rem]">{f.partida}</span> : <span className="text-tinta-suave">—</span>,
      etiquetaTarjeta: 'Partida arancelaria final',
    },
    {
      id: 'dias',
      encabezado: 'Días',
      alinear: 'der',
      // L4: el contador se congela al clasificar (dominio/dias-gestion) y entonces se ve en verde
      celda: (f) => (f.estado === 'CLASIFICADA' ? <span className="font-semibold text-verde-texto">{f.diasEnGestion}</span> : f.diasEnGestion),
      etiquetaTarjeta: 'Días en gestión',
    },
    {
      id: 'actualizada',
      encabezado: 'Actualizada',
      ocultarBajo: 'xl',
      celda: (f) => <span className="whitespace-nowrap text-tinta-suave">{actualizada(f.actualizadaEn, ahora)}</span>,
      etiquetaTarjeta: 'Actualizada',
    },
  ];

  const vacio = hayAlgo ? (
    <EstadoVacio
      icono={Layers}
      titulo={filtros.q ? `No encontramos «${filtros.q}»` : 'No hay referencias con esos filtros'}
      descripcion={
        filtros.q
          ? 'Revisa cómo la escribiste o prueba con una parte del código. También puedes quitar algún filtro.'
          : 'Prueba quitando algún filtro para ver más referencias.'
      }
      accion={
        <div className="flex flex-wrap justify-center gap-3">
          <EnlaceBoton href="/referencias" variante="secundario">
            Limpiar filtros
          </EnlaceBoton>
          {puedeCrear && filtros.q ? <EnlaceBoton href={`/referencias/nueva?codigo=${encodeURIComponent(filtros.q)}`}>Crear «{filtros.q}»</EnlaceBoton> : null}
          {!puedeCrear && filtros.q ? <p className="w-full text-sm text-tinta-suave">Pregúntale a quien la solicitó o a un administrador.</p> : null}
        </div>
      }
    />
  ) : (
    <EstadoVacio
      icono={Layers}
      titulo={actor.rol === 'aduana' ? 'Todavía no tienes referencias asignadas' : 'Aún no hay referencias'}
      descripcion={
        actor.rol === 'aduana'
          ? 'Cuando alguien te envíe una referencia, aparecerá aquí y te llegará un aviso con el enlace.'
          : puedeCrear
            ? 'Crea la primera y empezamos la base.'
            : 'Cuando se creen, las verás aquí.'
      }
      accion={puedeCrear ? <EnlaceBoton href="/referencias/nueva">Crear referencia</EnlaceBoton> : undefined}
    />
  );

  return (
    <ContenedorAncho className="space-y-5">
      <EncabezadoPagina
        titulo="Referencias"
        meta={
          <span aria-live="polite">
            {r.total === 0 ? 'Sin resultados' : `Mostrando ${NUMERO.format(r.desde)}–${NUMERO.format(r.hasta)} de ${NUMERO.format(r.total)}`}
          </span>
        }
        acciones={
          <>
            <BotonExportar />
            {puedeCrear ? <EnlaceBoton href="/referencias/nueva">Nueva referencia</EnlaceBoton> : null}
          </>
        }
      />

      <nav aria-label="Estado de las referencias" className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
        {pestanas.map((p) => {
          const activa = filtros.estado === p.id;
          return (
            <Link
              key={p.id}
              href={href(filtros, { estado: p.id })}
              aria-current={activa ? 'page' : undefined}
              className={cn(
                'group flex min-h-16 min-w-0 items-center gap-3 rounded-xl border bg-superficie px-4 py-3 transition-[border-color,box-shadow] duration-150 ease-salida hover:border-azul-700 sm:min-w-44',
                activa ? 'border-azul-700 shadow-[0_0_0_3px_rgb(11_47_107/0.14)]' : 'border-borde-suave shadow-suave',
                p.id === 'archivadas' && 'max-sm:col-span-2',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-9 shrink-0 items-center justify-center rounded-full border',
                  p.id === 'amarillas' && 'border-amarillo-borde bg-amarillo-fondo text-amarillo-texto',
                  p.id === 'verdes' && 'border-verde-solido bg-verde-fondo text-verde-texto',
                  (p.id === 'todas' || p.id === 'archivadas') && 'border-azul-200 bg-azul-50 text-azul-700',
                )}
              >
                {p.icono}
              </span>
              <span className="min-w-0 leading-tight">
                {p.valor !== null ? <span className="block font-display text-2xl font-extrabold tabular-nums text-tinta">{NUMERO.format(p.valor)}</span> : null}
                <span className={cn('block text-sm font-semibold text-tinta-suave', p.valor === null && 'text-base text-tinta')}>{p.etiqueta}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <FiltrosListado filtros={filtros} agencias={r.agencias} esInterno={esInterno} hayFiltros={hayFiltros} />

      <TablaDatos
        etiqueta="Referencias"
        filas={r.filas}
        clave={(f) => f.id}
        hrefFila={(f) => `/referencias/${f.id}`}
        etiquetaEnlace={(f) => `Abrir ${f.codigo}, ${f.nombreProducto}`}
        columnas={columnas}
        vacio={vacio}
      />

      {r.total > 0 ? (
        <Paginacion
          resumen={`Mostrando ${NUMERO.format(r.desde)}–${NUMERO.format(r.hasta)} de ${NUMERO.format(r.total)}`}
          anterior={r.pagina > 1 ? { href: href(filtros, { pagina: r.pagina - 1 }) } : null}
          siguiente={r.pagina < r.paginas ? { href: href(filtros, { pagina: r.pagina + 1 }) } : null}
        />
      ) : null}
    </ContenedorAncho>
  );
}
