import { Building2, ChevronRight, ListChecks, Mail, ScrollText, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { FilaAtencion, Seccion } from '@/componentes/admin/piezas';
import { plural } from '@/componentes/admin/formato';
import { nombreVisible } from '@/componentes/ui/avatar';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { getConfig } from '@/server/config';
import { resumenAdmin } from '@/server/politicas/administracion';
import { contextoAdmin } from './_contexto';

export const metadata: Metadata = { title: 'Administración · Descripciones mínimas' };

const COLOR_ESTADO = {
  pendiente: { clase: 'bg-azul-300', nombre: 'En cola' },
  enviando: { clase: 'bg-azul-500', nombre: 'Enviándose' },
  enviado: { clase: 'bg-azul-800', nombre: 'Enviados' },
  fallido: { clase: 'bg-error', nombre: 'Fallidos' },
  abandonado: { clase: 'bg-tinta-suave', nombre: 'Abandonados' },
} as const;

function listaNatural(nombres: string[], max = 3): string {
  const visibles = nombres.slice(0, max);
  const resto = nombres.length - visibles.length;
  const base = visibles.length > 1 ? `${visibles.slice(0, -1).join(', ')} y ${visibles.at(-1)}` : (visibles[0] ?? '');
  return resto > 0 ? `${visibles.join(', ')} y ${plural(resto, 'más', 'más')}` : base;
}

export default async function Administracion() {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const r = await resumenAdmin(ctx.db, ctx.actor);

  const fallosCorreo = r.correo.fallido + r.correo.abandonado;
  const totalCorreo = Object.values(r.correo).reduce((a, b) => a + b, 0);
  const avisosPorCorreo = getConfig().AVISOS_POR_CORREO;

  const atenciones: Array<{ clave: string; nodo: ReactNode }> = [];
  if (r.usuarios.sinIngreso > 0) {
    atenciones.push({
      clave: 'sin-ingreso',
      nodo: (
        <FilaAtencion
          titulo={`${plural(r.usuarios.sinIngreso, 'persona aún no ha entrado', 'personas aún no han entrado')}`}
          detalle={`Invitadas y sin primer ingreso: ${listaNatural(r.sinIngresoLista.map((u) => nombreVisible(u.nombre)))}.`}
          href="/admin/usuarios?estado=sin_ingreso"
          salida="Ver y reenviar"
        />
      ),
    });
  }
  if (fallosCorreo > 0) {
    atenciones.push({
      clave: 'correo',
      nodo: (
        <FilaAtencion
          grave
          titulo={`${plural(fallosCorreo, 'correo no salió', 'correos no salieron')}`}
          detalle={`${r.correo.fallido} esperando otro intento · ${r.correo.abandonado} abandonados. El pendiente existe igual en la bandeja de cada persona.`}
          href={`/admin/correo?estado=${r.correo.abandonado > 0 ? 'abandonado' : 'fallido'}`}
          salida="Revisar la cola"
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
              ? 'No podrás enviarle referencias hasta que invites a alguien.'
              : `${listaNatural(r.agenciasSinUsuarios.map((a) => a.nombre))}. No podrás enviarles referencias hasta que invites a alguien.`
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
  if (r.usuarios.correoInvalido > 0) {
    atenciones.push({
      clave: 'correo-invalido',
      nodo: (
        <FilaAtencion
          titulo={`${plural(r.usuarios.correoInvalido, 'persona tiene el correo marcado como inválido', 'personas tienen el correo marcado como inválido')}`}
          detalle="No reciben avisos por correo. Confirma el correo con ellas y quita la marca."
          href="/admin/usuarios?estado=correo_invalido"
          salida="Ver personas"
        />
      ),
    });
  }

  const atajos: Array<{ href: string; etiqueta: string; detalle: string; icono: LucideIcon }> = [
    { href: '/admin/usuarios', etiqueta: 'Usuarios', detalle: `${r.usuarios.activos} activos${r.usuarios.inactivos > 0 ? ` · ${r.usuarios.inactivos} inactivos` : ''}`, icono: Users },
    { href: '/admin/organizaciones', etiqueta: 'Organizaciones', detalle: `${plural(r.organizaciones.internas, 'área interna', 'áreas internas')} · ${plural(r.organizaciones.agencias, 'agencia', 'agencias')}`, icono: Building2 },
    { href: '/admin/catalogos', etiqueta: 'Catálogos', detalle: 'Listas, restricciones y partidas', icono: ListChecks },
    { href: '/admin/auditoria', etiqueta: 'Auditoría', detalle: 'Quién hizo qué y cuándo', icono: ScrollText },
    { href: '/admin/correo', etiqueta: 'Cola de correo', detalle: fallosCorreo > 0 ? `${plural(fallosCorreo, 'con fallo', 'con fallos')}` : 'Todo sale con normalidad', icono: Mail },
    { href: '/admin/parametros', etiqueta: 'Parámetros', detalle: 'Límites y vigencias en uso', icono: SlidersHorizontal },
  ];

  return (
    <>
      <EncabezadoPagina titulo="Administración" descripcion="Personas, organizaciones, listas y partidas, y lo que mantiene la plataforma en orden." />

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
                <EstadoVacio compacto titulo="Todo en orden" descripcion="No hay personas sin ingresar, correos con fallo ni propuestas por aprobar." />
              </div>
            )}
          </Seccion>

          <Seccion
            id="correo"
            titulo="Cola de correo"
            descripcion={
              avisosPorCorreo
                ? 'Los avisos con enlace que salen a cada persona.'
                : 'Los avisos por correo están apagados (AVISOS_POR_CORREO); los avisos viven en la campana.'
            }
            acciones={
              <Link href="/admin/correo" className="text-sm font-semibold text-azul-500 underline underline-offset-2">
                Abrir la cola
              </Link>
            }
          >
            {totalCorreo === 0 ? (
              <p className="text-base text-tinta-suave">
                {avisosPorCorreo
                  ? 'Todavía no se ha encolado ningún correo. Aparecerán aquí cuando alguien envíe una referencia.'
                  : 'Todavía no se ha encolado ningún correo. Mientras los avisos por correo sigan apagados, enviar una referencia no deja nada aquí.'}
              </p>
            ) : (
              <div className="space-y-4">
                <div
                  role="img"
                  aria-label={`Correos: ${Object.entries(COLOR_ESTADO)
                    .map(([k, v]) => `${r.correo[k as keyof typeof r.correo]} ${v.nombre.toLowerCase()}`)
                    .join(', ')}`}
                  className="flex h-3 overflow-hidden rounded-full bg-muted"
                >
                  {(Object.keys(COLOR_ESTADO) as Array<keyof typeof COLOR_ESTADO>).map((k) =>
                    r.correo[k] > 0 ? <span key={k} className={COLOR_ESTADO[k].clase} style={{ width: `${(r.correo[k] / totalCorreo) * 100}%` }} /> : null,
                  )}
                </div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-5">
                  {(Object.keys(COLOR_ESTADO) as Array<keyof typeof COLOR_ESTADO>).map((k) => (
                    <li key={k} className="flex items-center gap-2 text-sm">
                      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${COLOR_ESTADO[k].clase}`} />
                      <span className="text-tinta-suave">{COLOR_ESTADO[k].nombre}</span>
                      <span className="ml-auto font-bold tabular-nums text-tinta">{r.correo[k]}</span>
                    </li>
                  ))}
                </ul>
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
