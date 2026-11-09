import { Building2, ChevronRight, ListChecks, ScrollText, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { FilaAtencion, Seccion } from '@/componentes/admin/piezas';
import { plural } from '@/componentes/admin/formato';
import { nombreVisible } from '@/componentes/ui/avatar';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { puede } from '@/dominio/permisos';
import { resumenAdmin } from '@/server/politicas/administracion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin } from './_contexto';

export const metadata: Metadata = { title: 'Administración · Descripciones mínimas' };

function listaNatural(nombres: string[], max = 3): string {
  const visibles = nombres.slice(0, max);
  const resto = nombres.length - visibles.length;
  const base = visibles.length > 1 ? `${visibles.slice(0, -1).join(', ')} y ${visibles.at(-1)}` : (visibles[0] ?? '');
  return resto > 0 ? `${visibles.join(', ')} y ${plural(resto, 'más', 'más')}` : base;
}

export default async function Administracion() {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const r = await resumenAdmin(ctx.db, ctx.actor);

  const atenciones: Array<{ clave: string; nodo: ReactNode }> = [];
  if (r.usuarios.sinIngreso > 0) {
    atenciones.push({
      clave: 'sin-ingreso',
      nodo: (
        <FilaAtencion
          titulo={`${plural(r.usuarios.sinIngreso, 'cuenta aún no ha entrado', 'cuentas aún no han entrado')}`}
          detalle={`Creadas y sin primer ingreso: ${listaNatural(r.sinIngresoLista.map((u) => nombreVisible(u.nombre)))}. ${puede(ctx.actor, 'administrar') ? 'Entrégales su usuario y contraseña.' : 'El administrador les entrega su usuario y contraseña.'}`}
          href="/admin/usuarios?estado=sin_ingreso"
          salida="Ver cuentas"
        />
      ),
    });
  }
  if (r.agenciasSinUsuarios.length > 0) {
    const una = r.agenciasSinUsuarios.length === 1 ? r.agenciasSinUsuarios[0] : undefined;
    atenciones.push({
      clave: 'agencias',
      nodo: (
        <FilaAtencion
          titulo={una ? `${una.nombre} no tiene personas activas` : `${r.agenciasSinUsuarios.length} agencias no tienen personas activas`}
          detalle={
            una
              ? 'No podrás enviarle referencias hasta que crees su cuenta.'
              : `${listaNatural(r.agenciasSinUsuarios.map((a) => a.nombre))}. No podrás enviarles referencias hasta que crees sus cuentas.`
          }
          href={una ? `/admin/organizaciones/${una.id}` : '/admin/organizaciones'}
          salida={una ? 'Abrir la agencia' : 'Ver agencias'}
        />
      ),
    });
  }
  if (r.fichasConVariasAgencias.length > 0) {
    atenciones.push({
      clave: 'varias-agencias',
      nodo: (
        <FilaAtencion
          titulo={`${plural(r.fichasConVariasAgencias.length, 'referencia está abierta a más de una agencia', 'referencias están abiertas a más de una agencia')}`}
          detalle={`Por defecto una referencia trabaja con una sola agencia a la vez. ${r.fichasConVariasAgencias
            .slice(0, 2)
            .map((f) => `${f.codigo}: ${f.agencias.join(' y ')}`)
            .join(' · ')}.`}
          href="/admin/organizaciones"
          salida="Retirar un acceso"
        />
      ),
    });
  }
  const atajos: Array<{ href: string; etiqueta: string; detalle: string; icono: LucideIcon }> = [
    { href: '/admin/usuarios', etiqueta: 'Usuarios', detalle: `${r.usuarios.activos} activos${r.usuarios.inactivos > 0 ? ` · ${r.usuarios.inactivos} inactivos` : ''}`, icono: Users },
    { href: '/admin/organizaciones', etiqueta: 'Organizaciones', detalle: `${plural(r.organizaciones.internas, 'área interna', 'áreas internas')} · ${plural(r.organizaciones.agencias, 'agencia', 'agencias')}`, icono: Building2 },
    { href: '/admin/catalogos', etiqueta: 'Catálogos', detalle: 'Listas, restricciones y partidas', icono: ListChecks },
    { href: '/admin/auditoria', etiqueta: 'Auditoría', detalle: 'Quién hizo qué y cuándo', icono: ScrollText },
    ...(puede(ctx.actor, 'administrar') ? [{ href: '/admin/parametros', etiqueta: 'Parámetros', detalle: 'Límites y vigencias en uso', icono: SlidersHorizontal }] : []),
  ];

  return (
    <>
      <EncabezadoPagina titulo="Administración" descripcion="Cuentas, organizaciones, listas y partidas, y lo que mantiene la plataforma en orden." />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start">
        <div className="space-y-6">
          <Seccion id="atencion" titulo="Requiere atención" descripcion="Lo que conviene resolver hoy. Cada fila lleva a donde se arregla." sinPadding>
            {atenciones.length > 0 ? (
              <ul className="divide-y divide-borde-suave">
                {atenciones.map((a) => (
                  <Fragment key={a.clave}>{a.nodo}</Fragment>
                ))}
              </ul>
            ) : (
              <div className="p-5">
                <EstadoVacio compacto titulo="Todo en orden" descripcion="No hay cuentas sin ingresar ni referencias abiertas a varias agencias." />
              </div>
            )}
          </Seccion>
        </div>

        <nav aria-label="Atajos de administración">
          <Seccion titulo="Ir a" sinPadding>
            <ul className="divide-y divide-borde-suave">
              {atajos.map((a) => {
                const Icono = a.icono;
                return (
                  <li key={a.href}>
                    <Link href={a.href} className="group flex min-h-16 items-center gap-3 px-5 py-3 hover:bg-azul-50/70 focus-visible:bg-azul-50/70">
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-azul-50 text-azul-700 group-hover:bg-azul-100">
                        <Icono className="size-5" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-base font-semibold text-tinta">{a.etiqueta}</span>
                        <span className="block truncate text-sm text-tinta-suave">{a.detalle}</span>
                      </span>
                      <ChevronRight aria-hidden className="size-4 shrink-0 text-tinta-suave" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Seccion>
        </nav>
      </div>
    </>
  );
}
