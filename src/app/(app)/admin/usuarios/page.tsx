import { Search, UserPlus, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hace } from '@/componentes/admin/formato';
import { EstadosUsuario, InsigniaRol } from '@/componentes/admin/piezas';
import { nombreVisible } from '@/componentes/ui/avatar';
import { Boton, EnlaceBoton } from '@/componentes/ui/button';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { Etiqueta } from '@/componentes/ui/etiqueta';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { TablaDatos } from '@/componentes/ui/tabla';
import { ROLES, puede, type Rol } from '@/dominio/permisos';
import { listarOrganizacionesAdmin, listarUsuariosAdmin, type EstadoUsuarioFiltro } from '@/server/politicas/administracion';
import { ROL_ETIQUETA } from '@/componentes/admin/formato';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin, param } from '../_contexto';

export const metadata: Metadata = { title: 'Usuarios · Descripciones mínimas' };

const ESTADOS: Array<{ valor: EstadoUsuarioFiltro; etiqueta: string }> = [
  { valor: 'activo', etiqueta: 'Activos' },
  { valor: 'sin_ingreso', etiqueta: 'Sin ingresar todavía' },
  { valor: 'inactivo', etiqueta: 'Inactivos' },
];

export default async function AdminUsuarios({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const entregaClaves = puede(ctx.actor, 'administrar');
  const sp = await searchParams;
  const q = param(sp.q);
  const rolParam = param(sp.rol);
  const rol = (ROLES as readonly string[]).includes(rolParam ?? '') ? (rolParam as Rol) : undefined;
  const organizacionId = param(sp.organizacion);
  const estadoParam = param(sp.estado);
  const estado = ESTADOS.find((e) => e.valor === estadoParam)?.valor;

  const [usuarios, organizaciones] = await Promise.all([
    listarUsuariosAdmin(ctx.db, ctx.actor, { q, rol, organizacionId, estado }),
    listarOrganizacionesAdmin(ctx.db, ctx.actor),
  ]);

  const orgSeleccionada = organizaciones.find((o) => o.id === organizacionId);
  const filtros: Array<{ clave: string; texto: string }> = [
    ...(q ? [{ clave: 'q', texto: `Búsqueda: «${q}»` }] : []),
    ...(rol ? [{ clave: 'rol', texto: `Rol: ${ROL_ETIQUETA[rol]}` }] : []),
    ...(orgSeleccionada ? [{ clave: 'organizacion', texto: `Organización: ${nombreVisible(orgSeleccionada.nombre)}` }] : []),
    ...(estado ? [{ clave: 'estado', texto: `Estado: ${ESTADOS.find((e) => e.valor === estado)?.etiqueta}` }] : []),
  ];
  const sin = (clave: string) => {
    const u = new URLSearchParams();
    if (q && clave !== 'q') u.set('q', q);
    if (rol && clave !== 'rol') u.set('rol', rol);
    if (orgSeleccionada && clave !== 'organizacion') u.set('organizacion', orgSeleccionada.id);
    if (estado && clave !== 'estado') u.set('estado', estado);
    const s = u.toString();
    return s ? `/admin/usuarios?${s}` : '/admin/usuarios';
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Usuarios"
        descripcion="Las cuentas que pueden entrar (una por área, una por agencia y las de cada persona), con su rol y organización. Desactivar es lo normal y conserva lo que llenó; eliminar solo sirve para cuentas creadas por error que nunca trabajaron."
        acciones={
          <EnlaceBoton href="/admin/usuarios/nueva">
            <UserPlus aria-hidden className="size-4" />
            Crear cuenta
          </EnlaceBoton>
        }
      />

      <form method="get" action="/admin/usuarios" role="search" aria-label="Buscar usuarios" className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-borde-suave bg-superficie p-4 shadow-suave sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto] lg:items-end">
        <div className="col-span-2 space-y-1.5 lg:col-span-1">
          <Etiqueta htmlFor="f-q">Buscar</Etiqueta>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
            <Campo id="f-q" name="q" type="search" defaultValue={q ?? ''} placeholder="Nombre, usuario o área" className="pl-9" autoComplete="off" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="f-rol">Rol</Etiqueta>
          <Seleccion id="f-rol" name="rol" defaultValue={rol ?? ''}>
            <option value="">Todos</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROL_ETIQUETA[r]}
              </option>
            ))}
          </Seleccion>
        </div>
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Etiqueta htmlFor="f-org">Organización</Etiqueta>
          <Seleccion id="f-org" name="organizacion" defaultValue={orgSeleccionada?.id ?? ''}>
            <option value="">Todas</option>
            {organizaciones.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre}
              </option>
            ))}
          </Seleccion>
        </div>
        <div className="space-y-1.5">
          <Etiqueta htmlFor="f-estado">Estado</Etiqueta>
          <Seleccion id="f-estado" name="estado" defaultValue={estado ?? ''}>
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e.valor} value={e.valor}>
                {e.etiqueta}
              </option>
            ))}
          </Seleccion>
        </div>
        <Boton type="submit" variante="secundario" className="col-span-2 lg:col-span-1">
          Filtrar
        </Boton>
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2" aria-live="polite">
        <p className="text-sm font-semibold text-tinta">{usuarios.length === 1 ? '1 persona' : `${usuarios.length} personas`}</p>
        {filtros.map((f) => (
          <Link
            key={f.clave}
            href={sin(f.clave)}
            aria-label={`Quitar filtro. ${f.texto}`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-azul-200 bg-azul-50 px-3 text-sm font-semibold text-azul-900 hover:border-azul-700"
          >
            {f.texto}
            <X aria-hidden className="size-3.5" />
          </Link>
        ))}
        {filtros.length > 1 ? (
          <Link href="/admin/usuarios" className="text-sm font-semibold text-azul-500 underline underline-offset-2">
            Quitar todos
          </Link>
        ) : null}
      </div>

      <TablaDatos
        etiqueta="Usuarios"
        filas={usuarios}
        clave={(u) => u.id}
        hrefFila={(u) => `/admin/usuarios/${u.id}`}
        etiquetaEnlace={(u) => `Abrir a ${u.nombre}`}
        columnas={[
          { id: 'nombre', encabezado: 'Nombre', principal: true, celda: (u) => <span className="whitespace-normal">{nombreVisible(u.nombre)}</span> },
          { id: 'usuario', encabezado: 'Usuario', ocultarBajo: 'lg', celda: (u) => <span className="break-all font-mono text-sm text-tinta-suave">{u.username ?? 'sin usuario'}</span> },
          { id: 'rol', encabezado: 'Rol', celda: (u) => <InsigniaRol rol={u.rol} /> },
          { id: 'org', encabezado: 'Organización', ocultarBajo: 'md', celda: (u) => nombreVisible(u.organizacion) },
          { id: 'estado', encabezado: 'Estado', celda: (u) => <EstadosUsuario activo={u.activo} ultimoIngreso={u.ultimoIngreso} sinClave={u.sinClave} /> },
          { id: 'ingreso', encabezado: 'Último ingreso', ocultarBajo: 'lg', celda: (u) => <span className="text-sm text-tinta-suave">{hace(u.ultimoIngreso)}</span> },
        ]}
        tarjeta={(u) => (
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 break-words text-base font-semibold text-tinta">{nombreVisible(u.nombre)}</span>
              <InsigniaRol rol={u.rol} />
            </div>
            <p className="break-all font-mono text-sm text-tinta-suave">{u.username ?? 'sin usuario'}</p>
            <p className="text-sm text-tinta-suave">{nombreVisible(u.organizacion)}</p>
            <EstadosUsuario activo={u.activo} ultimoIngreso={u.ultimoIngreso} sinClave={u.sinClave} />
          </div>
        )}
        vacio={
          <EstadoVacio
            icono={Search}
            titulo={filtros.length > 0 ? 'No encontramos personas con esos filtros' : 'Todavía no hay usuarios'}
            descripcion={filtros.length > 0 ? 'Prueba con menos filtros o revisa cómo está escrito el nombre.' : entregaClaves ? 'Crea la primera cuenta y entrégale su usuario y contraseña.' : 'Crea la primera cuenta; el administrador le entrega su contraseña.'}
            accion={
              filtros.length > 0 ? (
                <EnlaceBoton href="/admin/usuarios" variante="secundario">
                  Quitar los filtros
                </EnlaceBoton>
              ) : (
                <EnlaceBoton href="/admin/usuarios/nueva">Crear cuenta</EnlaceBoton>
              )
            }
          />
        }
      />
    </>
  );
}
