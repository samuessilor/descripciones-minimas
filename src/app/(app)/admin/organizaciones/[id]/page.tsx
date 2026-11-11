import { Ban, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cambiarEstadoOrganizacionAccion, editarOrganizacionAccion, eliminarOrganizacionAccion, retirarAccesoAgenciaAccion } from '@/app/acciones/admin';
import { BotonAccion, FormularioAccion } from '@/componentes/admin/acciones';
import { CampoAdmin } from '@/componentes/admin/campos';
import { fechaHora, hace, plural } from '@/componentes/admin/formato';
import { EstadosUsuario, InsigniaRol, InsigniaTipoOrg, Seccion } from '@/componentes/admin/piezas';
import { Aviso } from '@/componentes/ui/aviso';
import { nombreVisible } from '@/componentes/ui/avatar';
import { EnlaceBoton } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Insignia } from '@/componentes/ui/insignia';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { TablaDatos } from '@/componentes/ui/tabla';
import { puede } from '@/dominio/permisos';
import { accesosDeAgencia, listarUsuariosAdmin, obtenerOrganizacionAdmin } from '@/server/politicas/administracion';
import { diagnosticoBorradoOrganizacion } from '@/server/acciones/organizaciones';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin } from '../../_contexto';

export const metadata: Metadata = { title: 'Organización · Descripciones mínimas' };

export default async function AdminOrganizacion({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const { id } = await params;
  const org = await obtenerOrganizacionAdmin(ctx.db, ctx.actor, id);
  if (!org) notFound();

  const [personas, accesos, borrado] = await Promise.all([
    listarUsuariosAdmin(ctx.db, ctx.actor, { organizacionId: org.id }),
    org.tipo === 'agencia' ? accesosDeAgencia(ctx.db, ctx.actor, org.id) : Promise.resolve([]),
    diagnosticoBorradoOrganizacion(ctx.db, org.id, org.nombre, org.tipo),
  ]);
  const esAgencia = org.tipo === 'agencia';
  const entregaClaves = puede(ctx.actor, 'administrar');
  const ahora = new Date();
  const pendientesQuitados = borrado.cuentas.reduce((n, c) => n + c.pendientes, 0);

  return (
    <>
      <EncabezadoPagina
        titulo={org.nombre}
        migas={[{ etiqueta: 'Organizaciones', href: '/admin/organizaciones' }, { etiqueta: org.nombre }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <InsigniaTipoOrg tipo={org.tipo} />
            {org.activa ? <Insignia variante="azul">Activa</Insignia> : <Insignia variante="neutra">Inactiva</Insignia>}
            <span>
              {plural(org.usuariosActivos, 'persona activa', 'personas activas')}
              {esAgencia ? ` · ${plural(org.fichasConAcceso, 'referencia con acceso', 'referencias con acceso')}` : ''}
            </span>
          </span>
        }
        acciones={
          org.activa && (!esAgencia || personas.length === 0) ? (
            <EnlaceBoton href={`/admin/usuarios/nueva?organizacion=${org.id}`}>
              <UserPlus aria-hidden className="size-4" />
              Crear cuenta para esta {esAgencia ? 'agencia' : 'área'}
            </EnlaceBoton>
          ) : undefined
        }
      />

      <div className="space-y-6">
        {esAgencia ? (
          <Seccion
            id="accesos"
            titulo="Referencias con acceso"
            descripcion="Lo que esta agencia puede ver hoy. «Retirar acceso» corta a toda la agencia en esa referencia; lo que escribió se conserva."
            sinPadding
          >
            {accesos.length === 0 ? (
              <div className="p-5">
                <EstadoVacio compacto titulo="No tiene referencias abiertas" descripcion="Cuando le envíes una referencia, aparecerá aquí. Después de clasificada, la agencia conserva el acceso unos días." />
              </div>
            ) : (
              <ul className="divide-y divide-borde-suave">
                {accesos.map((a) => (
                  <li key={a.referenciaId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="flex flex-wrap items-center gap-2">
                        <Link href={`/referencias/${a.referenciaId}`} className="font-mono text-sm font-bold text-azul-700 underline-offset-2 hover:underline">
                          {a.codigo}
                        </Link>
                        {a.tipo === 'activo' ? <Insignia variante="azul">Trabajando en ella</Insignia> : <Insignia variante="contorno">Acceso temporal</Insignia>}
                      </p>
                      <p className="truncate text-base font-semibold text-tinta">{a.nombreProducto}</p>
                      <p className="text-sm text-tinta-suave">
                        {a.personas.map(nombreVisible).join(', ')}
                        {a.tipo === 'temporal' && a.accesoHasta ? ` · acceso hasta el ${fechaHora(a.accesoHasta)}` : ''}
                      </p>
                    </div>
                    <BotonAccion
                      accion={retirarAccesoAgenciaAccion}
                      campos={{ referenciaId: a.referenciaId, organizacionId: org.id }}
                      etiquetaAria={`Retirar acceso de ${org.nombre} a ${a.codigo}`}
                      confirmar={{
                        titulo: `Retirar el acceso a ${a.codigo}`,
                        descripcion: `${org.nombre} deja de ver esta referencia ahora mismo y sus pendientes en ella se cancelan. Lo que escribió se conserva en el historial. Puedes volver a enviársela cuando quieras.`,
                        confirmar: 'Retirar acceso',
                        cancelar: 'Todavía no',
                        peligro: true,
                      }}
                    >
                      <Ban aria-hidden className="size-4" />
                      Retirar acceso
                    </BotonAccion>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        ) : null}

        <Seccion id="personas" titulo="Personas" descripcion={`Quién trabaja en ${org.nombre}.`} sinPadding>
          <div className="p-5 pt-4">
            <TablaDatos
              etiqueta={`Personas de ${org.nombre}`}
              filas={personas}
              clave={(u) => u.id}
              hrefFila={(u) => `/admin/usuarios/${u.id}`}
              etiquetaEnlace={(u) => `Abrir a ${u.nombre}`}
              columnas={[
                { id: 'nombre', encabezado: 'Nombre', principal: true, celda: (u) => <span className="whitespace-normal">{nombreVisible(u.nombre)}</span> },
                { id: 'usuario', encabezado: 'Usuario', ocultarBajo: 'md', celda: (u) => <span className="break-all font-mono text-sm text-tinta-suave">{u.username ?? 'sin usuario'}</span> },
                { id: 'rol', encabezado: 'Rol', celda: (u) => <InsigniaRol rol={u.rol} /> },
                { id: 'estado', encabezado: 'Estado', celda: (u) => <EstadosUsuario activo={u.activo} ultimoIngreso={u.ultimoIngreso} sinClave={u.sinClave} /> },
                { id: 'ingreso', encabezado: 'Último ingreso', ocultarBajo: 'lg', celda: (u) => <span className="text-sm text-tinta-suave">{hace(u.ultimoIngreso, ahora)}</span> },
              ]}
              vacio={<EstadoVacio compacto titulo="Aún no hay personas" descripcion={entregaClaves ? 'Crea la primera cuenta y entrégale su usuario y contraseña.' : 'Crea la primera cuenta; el administrador le entrega su contraseña.'} />}
            />
          </div>
        </Seccion>

        <Seccion id="datos" titulo="Nombre y estado">
          <div className="space-y-6">
            <FormularioAccion accion={editarOrganizacionAccion} enviar="Guardar nombre" enviando="Guardando…" variante="secundario" className="max-w-xl">
              <input type="hidden" name="organizacionId" value={org.id} />
              <CampoAdmin nombre="nombre" etiqueta="Nombre" defaultValue={org.nombre} maxLength={120} required />
            </FormularioAccion>

            <div className="space-y-3 border-t border-borde-suave pt-5">
              {org.activa ? (
                org.usuariosActivos > 0 ? (
                  <Aviso tipo="info" titulo="No se puede desactivar todavía">
                    Tiene {plural(org.usuariosActivos, 'persona activa', 'personas activas')}. Desactívalas o muévelas a otra organización y vuelve aquí; así nadie se queda sin poder entrar sin que lo hayas decidido.
                  </Aviso>
                ) : (
                  <p className="max-w-[65ch] text-base text-tinta-suave">Desactivarla la oculta de las listas para crear cuentas. No se borra nada: el historial conserva a quién perteneció cada cambio.</p>
                )
              ) : (
                <p className="max-w-[65ch] text-base text-tinta-suave">Está desactivada: no aparece al crear cuentas y su gente no puede entrar. Reactívala para volver a usarla.</p>
              )}
              <BotonAccion
                accion={cambiarEstadoOrganizacionAccion}
                campos={{ organizacionId: org.id, activa: org.activa ? 'no' : 'si' }}
                variante={org.activa ? 'peligro' : 'primario'}
                tamano="md"
                deshabilitado={org.activa && org.usuariosActivos > 0}
                confirmar={{
                  titulo: org.activa ? `Desactivar ${org.nombre}` : `Reactivar ${org.nombre}`,
                  descripcion: org.activa
                    ? 'Dejará de ofrecerse al crear cuentas. Puedes reactivarla cuando quieras.'
                    : 'Volverá a ofrecerse al crear cuentas y su gente podrá entrar.',
                  confirmar: org.activa ? 'Desactivar' : 'Reactivar',
                  cancelar: 'Todavía no',
                  peligro: org.activa,
                }}
              >
                {org.activa ? <Ban aria-hidden className="size-4" /> : <RotateCcw aria-hidden className="size-4" />}
                {org.activa ? 'Desactivar organización' : 'Reactivar organización'}
              </BotonAccion>
            </div>

            <div className="space-y-3 border-t border-borde-suave pt-5">
              {borrado.impedimento ? (
                <Aviso tipo="info" titulo="No se puede borrar">
                  {borrado.impedimento}
                </Aviso>
              ) : (
                <p className="max-w-[65ch] text-base text-tinta-suave">
                  {esAgencia && borrado.cuentas.length > 0
                    ? `Se borra la agencia junto con ${borrado.cuentas.length === 1 ? 'su cuenta' : `sus ${borrado.cuentas.length} cuentas`} (${borrado.cuentas.map((c) => c.usuario ?? c.nombre).join(', ')}). `
                    : 'No tiene cuentas ni historial, así que puedes borrarla del todo (por ejemplo, una creada por error). '}
                  {pendientesQuitados > 0 ? `Tiene ${plural(pendientesQuitados, 'referencia pendiente', 'referencias pendientes')}: se le quitan y quedan sin esa agencia. ` : ''}
                  Esto no se puede deshacer.
                </p>
              )}
              <BotonAccion
                accion={eliminarOrganizacionAccion}
                campos={{ organizacionId: org.id }}
                variante="peligro"
                tamano="md"
                deshabilitado={borrado.impedimento !== null}
                confirmar={{
                  titulo: `Borrar ${org.nombre}`,
                  descripcion: `${esAgencia && borrado.cuentas.length > 0 ? `Se borra la agencia y ${borrado.cuentas.length === 1 ? 'su cuenta' : 'sus cuentas'} para siempre. ` : 'Se borra la organización para siempre y deja de aparecer en las listas. '}Queda anotado en la auditoría. No se puede deshacer.`,
                  confirmar: 'Borrar organización',
                  cancelar: 'Todavía no',
                  peligro: true,
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                Borrar organización
              </BotonAccion>
            </div>
          </div>
        </Seccion>
      </div>
    </>
  );
}
