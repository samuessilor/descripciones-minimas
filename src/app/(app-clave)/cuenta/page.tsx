import { LogOut } from 'lucide-react';
import type { Metadata } from 'next';
import { actualizarPreferenciasAccion, cambiarMiClaveAccion } from '@/app/acciones/cuenta';
import { cerrarSesionAccion, cerrarTodasLasSesionesAccion } from '@/app/acciones/sesion';
import { FormularioAccion } from '@/componentes/admin/acciones';
import { CampoAdmin } from '@/componentes/admin/campos';
import { fechaHora, hace } from '@/componentes/admin/formato';
import { Dato, Datos, InsigniaRol, InsigniaTipoOrg, Seccion } from '@/componentes/admin/piezas';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { Interruptor } from '@/componentes/ui/casilla';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { misPreferencias } from '@/server/politicas/cuenta';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Mi cuenta · Descripciones mínimas' };

export default async function Cuenta() {
  const { db, actor } = await exigirContexto({ claveInicial: true });
  const prefs = await misPreferencias(db, actor);
  const ahora = new Date();

  return (
    <ContenedorLectura>
      <EncabezadoPagina titulo="Mi cuenta" descripcion="Tus datos y tu contraseña." />

      <div className="space-y-6">
        <Seccion id="datos" titulo="Tus datos" descripcion="Si algo está mal, pídele el cambio a un administrador.">
          <div className="mb-5 flex items-center gap-4">
            <Avatar nombre={actor.nombre} tamano="lg" />
            <div className="min-w-0">
              <p className="break-words font-display text-xl font-extrabold leading-tight text-tinta">{nombreVisible(actor.nombre)}</p>
              <p className="break-all font-mono text-base text-tinta-suave">{actor.username ?? actor.email}</p>
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
            {prefs.encargado ? <Dato etiqueta="Encargado">{prefs.encargado}</Dato> : null}
            <Dato etiqueta="Último ingreso">{prefs.ultimoIngreso ? `${hace(prefs.ultimoIngreso, ahora)} · ${fechaHora(prefs.ultimoIngreso)}` : 'Es tu primera vez'}</Dato>
          </Datos>
        </Seccion>

        <Seccion id="clave" titulo="Contraseña" descripcion="Cámbiala cuando quieras. Al cambiarla cerramos tus otras sesiones.">
          <FormularioAccion accion={cambiarMiClaveAccion} enviar="Cambiar contraseña" enviando="Cambiando…" variante="secundario" className="space-y-5" reiniciar>
            <div className="grid gap-5 sm:max-w-sm">
              <CampoAdmin nombre="actual" etiqueta="Contraseña actual" control="clave" autoComplete="current-password" required />
              <CampoAdmin nombre="nueva" etiqueta="Contraseña nueva" ayuda="Mínimo 7 caracteres." control="clave" autoComplete="new-password" required />
              <CampoAdmin nombre="repetir" etiqueta="Repite la contraseña nueva" control="clave" autoComplete="new-password" required />
            </div>
          </FormularioAccion>
        </Seccion>

        <Seccion id="atajos" titulo="Atajos" descripcion="Se guarda al pulsar «Guardar preferencias».">
          <FormularioAccion accion={actualizarPreferenciasAccion} enviar="Guardar preferencias" enviando="Guardando…" variante="secundario" className="space-y-5">
            <Interruptor
              name="atajosTeclado"
              value="si"
              defaultChecked={prefs.atajosTeclado}
              etiqueta="Atajo «/» para buscar"
              descripcion="Pulsa «/» fuera de un campo y se abre el buscador. Ctrl+K funciona siempre."
            />
          </FormularioAccion>
        </Seccion>

        <Seccion id="salir" titulo="Salir" descripcion="Cierra solo esta sesión, o todas las que tengas abiertas, incluida esta.">
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
