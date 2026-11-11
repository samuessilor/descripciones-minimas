import { RotateCcw, Trash2 } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cambiarRolAccion, editarUsuarioAccion, eliminarCuentaAccion, reactivarUsuarioAccion } from '@/app/acciones/admin';
import { BotonAccion, FormularioAccion } from '@/componentes/admin/acciones';
import { CampoAdmin, RadiosAdmin } from '@/componentes/admin/campos';
import { fechaHora, hace, plural, ROL_DESCRIPCION, ROL_ETIQUETA } from '@/componentes/admin/formato';
import { Dato, Datos, EstadosUsuario, InsigniaRol, InsigniaTipoOrg, Seccion } from '@/componentes/admin/piezas';
import { PanelCambiarOrganizacion, PanelDesactivar } from '@/componentes/admin/ReasignacionUsuario';
import { TextoCopiable } from '@/componentes/admin/TextoCopiable';
import { RestablecerClave } from '@/componentes/admin/RestablecerClave';
import { VerClave } from '@/componentes/admin/VerClave';
import { Aviso } from '@/componentes/ui/aviso';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { AREAS, esArea, exigeArea } from '@/dominio/areas';
import { ROLES, puede, puedeAsignarRol, puedeTocarCuenta } from '@/dominio/permisos';
import {
  candidatosReasignacion,
  contarAdminsActivos,
  listarOrganizacionesAdmin,
  obtenerUsuarioAdmin,
  pendientesDeUsuario,
} from '@/server/politicas/administracion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { diagnosticoBorradoCuenta } from '@/server/acciones/usuarios';
import { contextoAdmin } from '../../_contexto';

export const metadata: Metadata = { title: 'Persona · Descripciones mínimas' };

export default async function AdminUsuario({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const { id } = await params;
  const u = await obtenerUsuarioAdmin(ctx.db, ctx.actor, id);
  if (!u) notFound();

  const encabezado = (
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
          <EstadosUsuario activo={u.activo} ultimoIngreso={u.ultimoIngreso} sinClave={u.sinClave} />
        </span>
      }
    />
  );

  // La supervisora gestiona todo menos las cuentas de administrador y de supervisora (ni la suya): ahi solo lee.
  if (!puedeTocarCuenta(ctx.actor, u.rol)) {
    return (
      <>
        {encabezado}
        <div className="space-y-6">
          <Seccion id="datos" titulo="Datos">
            <Datos>
              <Dato etiqueta="Organización">{nombreVisible(u.organizacion)}</Dato>
              <Dato etiqueta="Usuario">{u.username ? <TextoCopiable texto={u.username} etiqueta="usuario" /> : <span className="font-mono">sin usuario</span>}</Dato>
              <Dato etiqueta="Rol">{ROL_ETIQUETA[u.rol as keyof typeof ROL_ETIQUETA] ?? u.rol}</Dato>
              {u.area ? <Dato etiqueta="Área">{u.area}</Dato> : null}
              {u.encargado ? <Dato etiqueta="Encargado del área">{u.encargado}</Dato> : null}
              <Dato etiqueta="Creada">{fechaHora(u.creadoEn)}</Dato>
              <Dato etiqueta="Último ingreso">{u.ultimoIngreso ? `${hace(u.ultimoIngreso)} · ${fechaHora(u.ultimoIngreso)}` : 'Todavía no ha entrado'}</Dato>
            </Datos>
          </Seccion>
          <Aviso tipo="info" titulo="Solo lectura">
            Las cuentas de administrador y de supervisora general las gestiona un administrador.
          </Aviso>
        </div>
      </>
    );
  }

  const [organizaciones, pendientes, candidatos, admins, borrado] = await Promise.all([
    listarOrganizacionesAdmin(ctx.db, ctx.actor),
    pendientesDeUsuario(ctx.db, ctx.actor, u.id),
    candidatosReasignacion(ctx.db, ctx.actor, u.id),
    contarAdminsActivos(ctx.db, ctx.actor),
    diagnosticoBorradoCuenta(ctx.db, u.id),
  ]);

  const entregaClaves = puede(ctx.actor, 'administrar');
  const rolesAsignables = ROLES.filter((r) => puedeAsignarRol(ctx.actor, r));
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
      {encabezado}

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
                    opcional={!exigeArea(u.rol, u.organizacionTipo)}
                    control="seleccion"
                    defaultValue={esArea(u.area) ? u.area : ''}
                  >
                    <option value="">{exigeArea(u.rol, u.organizacionTipo) ? 'Elige el área…' : 'Sin área'}</option>
                    {AREAS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </CampoAdmin>
                )}
                {esAgencia ? null : (
                  <CampoAdmin
                    nombre="encargado"
                    etiqueta="Encargado del área"
                    ayuda="Opcional. Quién lleva hoy la cuenta; la cuenta sigue siendo del área."
                    opcional
                    defaultValue={u.encargado ?? ''}
                    maxLength={80}
                  />
                )}
              </div>
              <Datos>
                <Dato etiqueta="Organización">{nombreVisible(u.organizacion)}</Dato>
                <Dato etiqueta="Usuario">{u.username ? <TextoCopiable texto={u.username} etiqueta="usuario" /> : <span className="font-mono">sin usuario</span>}</Dato>
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
                  opciones={rolesAsignables.map((r) => ({ valor: r, etiqueta: ROL_ETIQUETA[r], descripcion: ROL_DESCRIPCION[r] }))}
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
        </div>

        <aside aria-label="Acceso y estado" className="space-y-6 lg:sticky lg:top-[calc(var(--alto-barra-superior)+1.5rem)]">
          <Seccion id="acceso" titulo="Acceso" descripcion={u.activo ? undefined : 'Desactivado: no puede entrar.'}>
            <div className="space-y-4">
              <Datos className="sm:grid-cols-[minmax(0,7rem)_minmax(0,1fr)]">
                <Dato etiqueta="Pendientes">{pendientes.length === 0 ? 'Ninguno' : plural(pendientes.length, 'referencia', 'referencias')}</Dato>
              </Datos>
              {entregaClaves && u.username ? <VerClave usuarioId={u.id} usuario={u.username} /> : null}
              {u.activo && entregaClaves ? (
                <div className="flex flex-col items-stretch gap-2">
                  <RestablecerClave usuarioId={u.id} nombre={nombreVisible(u.nombre)} variante={sinIngresar || u.sinClave ? 'primario' : 'secundario'} />
                  <p className="text-sm text-tinta-suave">
                    {u.sinClave
                      ? 'La cuenta no tiene contraseña y no puede entrar. Genera una temporal para entregársela.'
                      : sinIngresar
                      ? 'Nunca ha entrado. Entrégale el usuario y la contraseña de arriba, o genera una nueva.'
                      : 'Genera una contraseña nueva, cierra sus sesiones y te la muestra. La anterior deja de servir y la nueva queda guardada para volver a verla.'}
                  </p>
                </div>
              ) : null}
              {u.activo && !entregaClaves && u.sinClave ? (
                <p className="text-sm text-tinta-suave">La cuenta todavía no tiene contraseña y no puede entrar. El administrador la genera y la entrega.</p>
              ) : null}
            </div>
          </Seccion>

          {!u.activo ? (
            <Seccion id="reactivar" titulo="Reactivar">
              <div className="space-y-3">
                <p className="text-base text-tinta-suave">Vuelve a poder entrar con su usuario y contraseña. Si no la recuerda, {entregaClaves ? 'restablécela' : 'el administrador la restablece'}. Lo que llenó antes sigue ahí.</p>
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
            descripcion="Lo normal es desactivar: deja de entrar al instante y lo que llenó se conserva."
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

      <div className="mt-6">
        <Seccion id="eliminar" titulo="Eliminar" descripcion="Para una cuenta creada por error o que nunca se usó. Desactivar es lo normal: conserva lo que la persona hizo.">
          {esYo ? (
            <Aviso tipo="aviso" titulo="No puedes eliminarte a ti mismo">
              Pídele a otro administrador que lo haga.
            </Aviso>
          ) : unicoAdmin ? (
            <Aviso tipo="aviso" titulo="Es el único administrador activo">
              Para eliminarlo, primero dale el rol a otra persona.
            </Aviso>
          ) : borrado.conTrabajo ? (
            <Aviso tipo="info" titulo="No se puede eliminar">
              Ya trabajó en referencias (historial, comentarios o fichas que creó o cerró): borrarla perdería quién lo hizo. Desactívala en su lugar.
            </Aviso>
          ) : (
            <div className="space-y-3">
              <p className="max-w-[65ch] text-base text-tinta-suave">
                {borrado.borraLaAgencia ? `Es la única cuenta de ${nombreVisible(u.organizacion)}: se elimina también la agencia. ` : ''}
                {borrado.pendientes > 0 ? `Tiene ${plural(borrado.pendientes, 'referencia pendiente', 'referencias pendientes')}: se le quitan y quedan sin esa responsable. ` : ''}
                Se van también sus avisos, sesiones y contraseña. En la auditoría se conserva lo que hizo, con su usuario anotado. No se puede deshacer.
              </p>
              <BotonAccion
                accion={eliminarCuentaAccion}
                campos={{ usuarioId: u.id }}
                variante="peligro"
                tamano="md"
                confirmar={{
                  titulo: `Eliminar la cuenta ${u.username ?? nombreVisible(u.nombre)}`,
                  descripcion: `${borrado.borraLaAgencia ? `Se elimina también la agencia ${nombreVisible(u.organizacion)}. ` : ''}Esta cuenta deja de existir para siempre. No se puede deshacer.`,
                  confirmar: 'Eliminar cuenta',
                  cancelar: 'Todavía no',
                  peligro: true,
                }}
              >
                <Trash2 aria-hidden className="size-4" />
                Eliminar cuenta
              </BotonAccion>
            </div>
          )}
        </Seccion>
      </div>
    </>
  );
}
