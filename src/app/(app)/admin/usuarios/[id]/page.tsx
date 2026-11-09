import { Monitor, RotateCcw, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  cambiarRolAccion,
  cerrarSesionesUsuarioAccion,
  editarUsuarioAccion,
  reactivarUsuarioAccion,
} from '@/app/acciones/admin';
import { BotonAccion, FormularioAccion } from '@/componentes/admin/acciones';
import { CampoAdmin, RadiosAdmin } from '@/componentes/admin/campos';
import { describirNavegador, fechaHora, formatearIp, hace, plural, ROL_DESCRIPCION, ROL_ETIQUETA } from '@/componentes/admin/formato';
import { Dato, Datos, EstadosUsuario, InsigniaRol, InsigniaTipoOrg, Seccion } from '@/componentes/admin/piezas';
import { PanelCambiarOrganizacion, PanelDesactivar } from '@/componentes/admin/ReasignacionUsuario';
import { RestablecerClave } from '@/componentes/admin/RestablecerClave';
import { Aviso } from '@/componentes/ui/aviso';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { AREAS, esArea } from '@/dominio/areas';
import { ROLES } from '@/dominio/permisos';
import {
  candidatosReasignacion,
  contarAdminsActivos,
  listarOrganizacionesAdmin,
  listarSesionesDeUsuario,
  obtenerUsuarioAdmin,
  pendientesDeUsuario,
} from '@/server/politicas/administracion';
import { contextoAdmin } from '../../_contexto';

export const metadata: Metadata = { title: 'Persona · Descripciones mínimas' };

export default async function AdminUsuario({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const { id } = await params;
  const u = await obtenerUsuarioAdmin(ctx.db, ctx.actor, id);
  if (!u) notFound();

  const [organizaciones, pendientes, candidatos, sesiones, admins] = await Promise.all([
    listarOrganizacionesAdmin(ctx.db, ctx.actor),
    pendientesDeUsuario(ctx.db, ctx.actor, u.id),
    candidatosReasignacion(ctx.db, ctx.actor, u.id),
    listarSesionesDeUsuario(ctx.db, ctx.actor, u.id),
    contarAdminsActivos(ctx.db, ctx.actor),
  ]);

  const esYo = u.id === ctx.actor.usuarioId;
  const esAgencia = u.organizacionTipo === 'agencia';
  const unicoAdmin = u.rol === 'admin' && u.activo && admins <= 1;
  const ahora = new Date();
  const pendientesVista = pendientes.map((p) => ({
    referenciaId: p.referenciaId,
    codigo: p.codigo,
    nombreProducto: p.nombreProducto,
    pedido: p.pedido,
    deNombre: nombreVisible(p.deNombre),
    desde: hace(p.desde, ahora),
  }));
  const candidatosVista = candidatos.map((c) => ({ ...c }));
  const usuarioVista = { id: u.id, nombre: nombreVisible(u.nombre), organizacionId: u.organizacionId, organizacionTipo: u.organizacionTipo as 'interna' | 'agencia', rol: u.rol };
  const orgsActivas = organizaciones.filter((o) => o.activa || o.id === u.organizacionId);
  const sinIngresar = u.activo && u.ultimoIngreso === null;

  return (
    <>
      <EncabezadoPagina
        titulo={
          <span className="flex items-center gap-3">
            <Avatar nombre={u.nombre} tamano="lg" />
            <span className="min-w-0 break-words">{nombreVisible(u.nombre)}</span>
          </span>
        }
        descripcion={<span className="break-all font-mono">{u.username ?? 'sin usuario'}</span>}
        migas={[{ etiqueta: 'Usuarios', href: '/admin/usuarios' }, { etiqueta: nombreVisible(u.nombre) }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <InsigniaRol rol={u.rol} />
            <InsigniaTipoOrg tipo={u.organizacionTipo} />
            <EstadosUsuario activo={u.activo} ultimoIngreso={u.ultimoIngreso} />
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="space-y-6">
          <Seccion id="datos" titulo="Datos" descripcion="El usuario identifica a la cuenta y no se cambia.">
            <FormularioAccion accion={editarUsuarioAccion} enviar="Guardar datos" enviando="Guardando…" variante="secundario" className="space-y-5">
              <input type="hidden" name="usuarioId" value={u.id} />
              <div className="grid gap-5 sm:grid-cols-2">
                <CampoAdmin nombre="nombre" etiqueta="Nombre completo" defaultValue={u.nombre} maxLength={200} required />
                {esAgencia ? null : (
                  <CampoAdmin
                    nombre="area"
                    etiqueta="Área"
                    ayuda="Ve en «Para mí» las referencias de su área y recibe las solicitudes de la aduana sobre ellas."
                    opcional
                    control="seleccion"
                    defaultValue={esArea(u.area) ? u.area : ''}
                  >
                    <option value="">Sin área</option>
                    {AREAS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </CampoAdmin>
                )}
              </div>
              <Datos>
                <Dato etiqueta="Organización">{nombreVisible(u.organizacion)}</Dato>
                <Dato etiqueta="Usuario"><span className="font-mono">{u.username ?? 'sin usuario'}</span></Dato>
                <Dato etiqueta="Creada">{fechaHora(u.creadoEn)}</Dato>
                <Dato etiqueta="Último ingreso">{u.ultimoIngreso ? `${hace(u.ultimoIngreso)} · ${fechaHora(u.ultimoIngreso)}` : 'Todavía no ha entrado'}</Dato>
              </Datos>
            </FormularioAccion>
          </Seccion>

          <Seccion id="rol" titulo="Rol" descripcion="Qué puede hacer en la plataforma. El cambio rige desde su próxima petición.">
            {esAgencia ? (
              <Aviso tipo="info" titulo="Rol: Aduana">
                Las personas de una agencia solo pueden tener el rol de aduana. Para darle otro rol, primero muévela a un área interna.
              </Aviso>
            ) : (
              <FormularioAccion accion={cambiarRolAccion} enviar="Cambiar rol" enviando="Cambiando…" variante="secundario">
                <input type="hidden" name="usuarioId" value={u.id} />
                <RadiosAdmin
                  leyenda="Rol"
                  nombre="rol"
                  valorInicial={u.rol}
                  opciones={ROLES.map((r) => ({ valor: r, etiqueta: ROL_ETIQUETA[r], descripcion: ROL_DESCRIPCION[r] }))}
                />
                {unicoAdmin ? <p className="mt-3 text-sm text-tinta-suave">Es el único administrador activo: para quitarle el rol, primero dáselo a otra persona.</p> : null}
              </FormularioAccion>
            )}
          </Seccion>

          <Seccion id="organizacion" titulo="Organización" descripcion="Dónde trabaja. Mover a alguien entre un área y una agencia cambia lo que puede ver.">
            <PanelCambiarOrganizacion
              usuario={usuarioVista}
              organizaciones={orgsActivas.map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo }))}
              pendientes={pendientesVista}
              candidatos={candidatosVista}
            />
          </Seccion>

          <Seccion
            id="sesiones"
            titulo="Sesiones abiertas"
            descripcion={esYo ? 'Estas son tus sesiones. Para cerrarlas usa tu cuenta.' : 'Dónde tiene la plataforma abierta ahora. Cerrar una es inmediato.'}
            acciones={
              !esYo && sesiones.length > 0 ? (
                <BotonAccion
                  accion={cerrarSesionesUsuarioAccion}
                  campos={{ usuarioId: u.id }}
                  confirmar={{
                    titulo: 'Cerrar todas sus sesiones',
                    descripcion: `${nombreVisible(u.nombre)} tendrá que volver a entrar con su contraseña. Lo que ya llenó se conserva.`,
                    confirmar: 'Cerrar sesiones',
                    cancelar: 'Todavía no',
                    peligro: true,
                  }}
                >
                  Cerrar todas
                </BotonAccion>
              ) : undefined
            }
            sinPadding
          >
            {sesiones.length === 0 ? (
              <p className="px-5 py-4 text-base text-tinta-suave">No tiene sesiones abiertas.</p>
            ) : (
              <ul className="divide-y divide-borde-suave">
                {sesiones.map((s) => {
                  const movil = /iPhone|Android|iPad|Mobile/i.test(s.agente ?? '');
                  const Icono = movil ? Smartphone : Monitor;
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                      <Icono aria-hidden className="size-5 shrink-0 text-tinta-suave" strokeWidth={1.75} />
                      <div className="min-w-0 flex-1 basis-56">
                        <p className="text-base font-semibold text-tinta">{describirNavegador(s.agente)}</p>
                        <p className="text-sm text-tinta-suave">
                          Activa {hace(s.ultimaActividad, ahora)} · entró {fechaHora(s.creadaEn)}
                          {formatearIp(s.ip) ? ` · ${formatearIp(s.ip)}` : ''}
                        </p>
                      </div>
                      {!esYo ? (
                        <BotonAccion
                          accion={cerrarSesionesUsuarioAccion}
                          campos={{ usuarioId: u.id, sesionId: s.id }}
                          etiquetaAria={`Cerrar sesión de ${describirNavegador(s.agente)}`}
                        >
                          Cerrar sesión
                        </BotonAccion>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Seccion>
        </div>

        <aside aria-label="Acceso y estado" className="space-y-6 lg:sticky lg:top-[calc(var(--alto-barra-superior)+1.5rem)]">
          <Seccion id="acceso" titulo="Acceso" descripcion={u.activo ? undefined : 'Desactivado: no puede entrar.'}>
            <div className="space-y-4">
              <Datos className="sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)]">
                <Dato etiqueta="Pendientes">{pendientes.length === 0 ? 'Ninguno' : plural(pendientes.length, 'referencia', 'referencias')}</Dato>
                <Dato etiqueta="Sesiones">{plural(sesiones.length, 'abierta', 'abiertas')}</Dato>
              </Datos>
              {u.activo ? (
                <div className="flex flex-col items-stretch gap-2">
                  <RestablecerClave usuarioId={u.id} nombre={nombreVisible(u.nombre)} variante={sinIngresar ? 'primario' : 'secundario'} />
                  <p className="text-sm text-tinta-suave">
                    {sinIngresar
                      ? 'Nunca ha entrado. Genera una contraseña temporal para entregársela.'
                      : 'Genera una contraseña nueva, cierra sus sesiones y te la muestra una vez. La anterior deja de servir.'}
                  </p>
                </div>
              ) : null}
            </div>
          </Seccion>

          {!u.activo ? (
            <Seccion id="reactivar" titulo="Reactivar">
              <div className="space-y-3">
                <p className="text-base text-tinta-suave">Vuelve a poder entrar con su usuario y contraseña. Si no la recuerda, restablécela. Lo que llenó antes sigue ahí.</p>
                <BotonAccion
                  accion={reactivarUsuarioAccion}
                  campos={{ usuarioId: u.id }}
                  variante="primario"
                  tamano="md"
                  confirmar={{
                    titulo: `Reactivar a ${nombreVisible(u.nombre)}`,
                    descripcion: 'Podrá volver a entrar con su usuario y contraseña. Sus pendientes anteriores no regresan: ya fueron reasignados.',
                    confirmar: 'Reactivar',
                    cancelar: 'Todavía no',
                  }}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  Reactivar a {nombreVisible(u.nombre)}
                </BotonAccion>
              </div>
            </Seccion>
          ) : null}
        </aside>
      </div>

      {u.activo ? (
        <div className="mt-6">
          <Seccion
            id="desactivar"
            titulo="Desactivar"
            descripcion="Nunca se elimina a nadie: se desactiva. Deja de entrar al instante y lo que llenó se conserva."
          >
            {esYo ? (
              <Aviso tipo="aviso" titulo="No puedes desactivarte a ti mismo">
                Pídele a otro administrador que lo haga, así no te quedas fuera por error.
              </Aviso>
            ) : (
              <PanelDesactivar usuario={usuarioVista} pendientes={pendientesVista} candidatos={candidatosVista} unicoAdministrador={unicoAdmin} />
            )}
          </Seccion>
        </div>
      ) : null}
    </>
  );
}
