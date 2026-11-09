import { LogOut, Monitor, Smartphone } from 'lucide-react';
import type { Metadata } from 'next';
import { actualizarPreferenciasAccion, cerrarOtrasSesionesAccion, cerrarSesionPropiaAccion } from '@/app/acciones/cuenta';
import { cerrarSesionAccion, cerrarTodasLasSesionesAccion } from '@/app/acciones/sesion';
import { BotonAccion, FormularioAccion } from '@/componentes/admin/acciones';
import { RadiosAdmin } from '@/componentes/admin/campos';
import { describirNavegador, fechaHora, formatearIp, hace } from '@/componentes/admin/formato';
import { Dato, Datos, InsigniaRol, InsigniaTipoOrg, Seccion } from '@/componentes/admin/piezas';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { Interruptor } from '@/componentes/ui/casilla';
import { Insignia } from '@/componentes/ui/insignia';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { getConfig } from '@/server/config';
import { misPreferencias, misSesiones } from '@/server/politicas/cuenta';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Mi cuenta · Descripciones mínimas' };

export default async function Cuenta() {
  const { db, actor } = await exigirContexto();
  const [prefs, sesiones] = await Promise.all([misPreferencias(db, actor), misSesiones(db, actor)]);
  const ahora = new Date();
  const otras = sesiones.filter((s) => !s.esActual);
  const avisosPorCorreo = getConfig().AVISOS_POR_CORREO;

  return (
    <ContenedorLectura>
      <EncabezadoPagina titulo="Mi cuenta" descripcion="Tus datos, cómo quieres que te avisemos y dónde tienes abierta la plataforma." />

      <div className="space-y-6">
        <Seccion id="datos" titulo="Tus datos" descripcion="Si algo está mal, pídele el cambio a un administrador.">
          <div className="mb-5 flex items-center gap-4">
            <Avatar nombre={actor.nombre} tamano="lg" />
            <div className="min-w-0">
              <p className="break-words font-display text-xl font-extrabold leading-tight text-tinta">{nombreVisible(actor.nombre)}</p>
              <p className="break-all text-base text-tinta-suave">{actor.email}</p>
            </div>
          </div>
          <Datos>
            <Dato etiqueta="Rol">
              <InsigniaRol rol={actor.rol} />
            </Dato>
            <Dato etiqueta="Organización">
              <span className="flex flex-wrap items-center gap-2">
                {nombreVisible(actor.organizacionNombre)}
                <InsigniaTipoOrg tipo={actor.organizacionTipo} />
              </span>
            </Dato>
            {actor.area ? <Dato etiqueta="Área">{actor.area}</Dato> : null}
            <Dato etiqueta="Último ingreso">{prefs.ultimoIngreso ? `${hace(prefs.ultimoIngreso, ahora)} · ${fechaHora(prefs.ultimoIngreso)}` : 'Es tu primera vez'}</Dato>
          </Datos>
        </Seccion>

        <Seccion id="avisos" titulo="Avisos y atajos" descripcion="Se guardan al pulsar «Guardar preferencias».">
          <FormularioAccion accion={actualizarPreferenciasAccion} enviar="Guardar preferencias" enviando="Guardando…" variante="secundario" className="space-y-5">
            {avisosPorCorreo ? (
              <RadiosAdmin
                leyenda="Cuando te envían una referencia"
                nombre="preferenciaAviso"
                valorInicial={prefs.preferenciaAviso}
                opciones={[
                  { valor: 'inmediato', etiqueta: 'Avísame por correo', descripcion: 'Te llega un correo con el enlace directo, además de verlo en la campana.' },
                  { valor: 'solo_bandeja', etiqueta: 'Solo en la plataforma', descripcion: 'Lo ves en la campana y en tus pendientes, sin correos. El enlace para entrar siempre llega por correo.' },
                ]}
              />
            ) : (
              <div>
                {/* Con el correo de avisos apagado la preferencia no tiene efecto: se conserva tal cual sin ofrecerla */}
                <input type="hidden" name="preferenciaAviso" value={prefs.preferenciaAviso} />
                <p className="mb-1 text-sm font-semibold text-tinta">Cuando te envían una referencia</p>
                <p className="text-sm text-tinta-suave">Los avisos llegan a la campana y a «Para mí». El enlace para entrar siempre llega por correo.</p>
              </div>
            )}
            <Interruptor
              name="atajosTeclado"
              value="si"
              defaultChecked={prefs.atajosTeclado}
              etiqueta="Atajo «/» para buscar"
              descripcion="Pulsa «/» fuera de un campo y se abre el buscador. Ctrl+K funciona siempre."
            />
          </FormularioAccion>
        </Seccion>

        <Seccion
          id="sesiones"
          titulo="Sesiones abiertas"
          descripcion="Cada navegador donde entraste. Si no reconoces alguna, ciérrala."
          acciones={
            otras.length > 0 ? (
              <BotonAccion
                accion={cerrarOtrasSesionesAccion}
                campos={{}}
                confirmar={{
                  titulo: 'Cerrar las otras sesiones',
                  descripcion: 'Esta sesión sigue abierta. En los demás dispositivos tendrás que volver a pedir tu enlace.',
                  confirmar: 'Cerrar las otras',
                  cancelar: 'Todavía no',
                  peligro: true,
                }}
              >
                Cerrar las otras ({otras.length})
              </BotonAccion>
            ) : undefined
          }
          sinPadding
        >
          <ul className="divide-y divide-borde-suave">
            {sesiones.map((s) => {
              const Icono = /iPhone|Android|iPad|Mobile/i.test(s.agente ?? '') ? Smartphone : Monitor;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                  <Icono aria-hidden className="size-5 shrink-0 text-tinta-suave" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1 basis-52">
                    <p className="flex flex-wrap items-center gap-2 text-base font-semibold text-tinta">
                      {describirNavegador(s.agente)}
                      {s.esActual ? <Insignia variante="oscura">Esta sesión</Insignia> : null}
                    </p>
                    <p className="text-sm text-tinta-suave">
                      {s.esActual ? 'En uso ahora' : `Activa ${hace(s.ultimaActividad, ahora)}`} · entró {fechaHora(s.creadaEn)}
                      {formatearIp(s.ip) ? ` · ${formatearIp(s.ip)}` : ''}
                    </p>
                  </div>
                  {!s.esActual ? (
                    <BotonAccion accion={cerrarSesionPropiaAccion} campos={{ sesionId: s.id }} etiquetaAria={`Cerrar sesión de ${describirNavegador(s.agente)}`}>
                      Cerrar sesión
                    </BotonAccion>
                  ) : null}
                </li>
              );
            })}
            {sesiones.length === 0 ? <li className="px-5 py-4 text-base text-tinta-suave">No encontramos sesiones abiertas.</li> : null}
          </ul>
        </Seccion>

        <Seccion id="salir" titulo="Salir" descripcion="Cierra solo esta sesión, o todas, incluida esta.">
          <div className="flex flex-wrap gap-3">
            <form action={cerrarSesionAccion}>
              <Boton type="submit" variante="primario">
                <LogOut aria-hidden className="size-4" />
                Cerrar sesión
              </Boton>
            </form>
            <form action={cerrarTodasLasSesionesAccion}>
              <Boton type="submit" variante="secundario">
                Cerrar todas mis sesiones
              </Boton>
            </form>
          </div>
        </Seccion>
      </div>
    </ContenedorLectura>
  );
}
