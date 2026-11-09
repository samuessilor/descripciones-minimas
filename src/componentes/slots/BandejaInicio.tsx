/**
 * SLOT: contenido de la pagina de inicio: 'Mis pendientes' y recientes
 * Dueno: colaboracion. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Componente de SERVIDOR (lee la bandeja del actor con las politicas de lectura): un resumen con lo mas urgente
 * y las pestañas «Para mi · Esperando a otros · Recientes» (10.3, F7).
 */
import { ArrowRight, CircleCheck, FileStack, Hourglass } from 'lucide-react';
import { AnillosLente } from '@/componentes/ui/decoracion';
import { EnlaceBoton } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Estado } from '@/componentes/Estado';
import { BandejaTabs } from '@/componentes/colaboracion/BandejaTabs';
import { FilaEsperandoUI, FilaPendienteUI, FilaRecienteUI } from '@/componentes/colaboracion/FilasBandeja';
import { nombreVisible } from '@/componentes/ui/avatar';
import { plural, tiempoRelativo } from '@/dominio/colaboracion';
import { puede } from '@/dominio/permisos';
import { esperandoDe, pendientesDe, recientesDe, resumenInicioDe } from '@/server/politicas/colaboracion';
import { exigirContexto } from '@/server/sesion';

export async function BandejaInicio() {
  const { db, actor } = await exigirContexto();
  const ahora = new Date();
  const [resumen, pendientes, esperando, recientes] = await Promise.all([
    resumenInicioDe(db, actor, ahora),
    pendientesDe(db, actor, ahora),
    esperandoDe(db, actor, ahora),
    recientesDe(db, actor, ahora, 8),
  ]);
  const puedeCrear = puede(actor, 'crear_referencia');
  const masAntigua = pendientes[0];
  // Quien lleva el proceso y el admin ven las asignaciones abiertas de todo el equipo, no solo las que enviaron.
  const veTodas = actor.rol === 'lector' || actor.rol === 'admin';
  // Una misma referencia enviada a dos personas son dos asignaciones, pero una sola referencia.
  const nReferenciasEsperando = new Set(esperando.map((f) => f.referenciaId)).size;
  const inicial = pendientes.length > 0 ? 'para-mi' : esperando.length > 0 ? 'esperando' : 'para-mi';

  return (
    <div className="space-y-8">
      {/* Lo primero: lo mas urgente, con la accion directa */}
      <section
        aria-label="Lo primero"
        className="superficie-oscura relative overflow-hidden rounded-2xl bg-azul-900 px-6 py-6 text-white sm:px-8 sm:py-7"
      >
        <AnillosLente className="absolute -right-24 top-1/2 w-[34rem] max-w-none -translate-y-1/2 opacity-90 max-sm:hidden" />
        <div className="relative flex flex-wrap items-center justify-between gap-x-10 gap-y-5">
          <div className="min-w-0 max-w-xl space-y-3">
            {masAntigua ? (
              <>
                <Estado color="amarillo" texto={`${plural(pendientes.length, 'pendiente', 'pendientes')} para ti`} tamano="md" />
                <h2 className="font-display text-2xl font-extrabold leading-tight text-balance sm:text-[1.75rem]">
                  {pendientes.length === 1
                    ? `${masAntigua.nombreProducto} te está esperando`
                    : `La más antigua es ${masAntigua.nombreProducto}`}
                </h2>
                <p className="text-base text-azul-200">
                  {masAntigua.delArea
                    ? `Es de tu área (${masAntigua.delArea}) y nadie la tiene asignada`
                    : `${nombreVisible(masAntigua.deUsuario)} te la envió ${tiempoRelativo(masAntigua.desde, ahora)}`}
                  {masAntigua.falta ? ` · ${masAntigua.falta}` : ''}.
                </p>
              </>
            ) : (
              <>
                <Estado color="verde" texto="Estás al día" tamano="md" />
                <h2 className="font-display text-2xl font-extrabold leading-tight text-balance sm:text-[1.75rem]">
                  No tienes referencias pendientes
                </h2>
                <p className="text-base text-azul-200">
                  {esperando.length === 0
                    ? 'Cuando alguien te envíe una referencia, aparece aquí y en la campana.'
                    : veTodas
                      ? `El equipo tiene ${plural(esperando.length, 'asignación abierta', 'asignaciones abiertas')}; abajo ves a quién espera cada una.`
                      : `Esperas respuesta de ${plural(nReferenciasEsperando, 'referencia', 'referencias')}; abajo ves cómo va cada una.`}
                </p>
              </>
            )}
            {resumen.esperandoAOtros + resumen.listas + (resumen.sinResponsable ?? 0) > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1 text-sm text-azul-100" aria-label="Resumen">
                {resumen.esperandoAOtros > 0 ? (
                  <li className="rounded-full bg-white/10 px-3 py-1">
                    <Hourglass aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
                    {resumen.esperandoAOtros} esperando a otros
                  </li>
                ) : null}
                {resumen.listas > 0 ? (
                  <li className="rounded-full bg-white/10 px-3 py-1">
                    <CircleCheck aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
                    {plural(resumen.listas, 'clasificada', 'clasificadas')}
                  </li>
                ) : null}
                {resumen.sinResponsable ? (
                  <li className="rounded-full bg-white/10 px-3 py-1">
                    <FileStack aria-hidden className="mr-1.5 inline size-3.5 align-[-2px]" />
                    {resumen.sinResponsable} sin responsable
                  </li>
                ) : null}
              </ul>
            ) : null}
          </div>
          {masAntigua ? (
            <div className="flex shrink-0 flex-wrap gap-3 max-sm:w-full max-sm:[&>*]:flex-1">
              <EnlaceBoton href={`/referencias/${masAntigua.referenciaId}`} variante="claro" tamano="lg">
                Abrir {masAntigua.codigo}
                <ArrowRight aria-hidden className="size-4" />
              </EnlaceBoton>
            </div>
          ) : null}
        </div>
      </section>

      <BandejaTabs
        inicial={inicial}
        contadores={{ paraMi: pendientes.length, esperando: esperando.length }}
        paraMi={
          pendientes.length === 0 ? (
            <EstadoVacio
              icono={CircleCheck}
              titulo="Estás al día. No tienes referencias pendientes."
              descripcion={
                actor.organizacionTipo === 'agencia'
                  ? 'Lo que te envíen con «Enviar a…» aparece aquí, con qué falta y desde cuándo.'
                  : 'Lo que te envíen con «Enviar a…» y lo de tu área que nadie tenga asignado aparece aquí, con qué falta y desde cuándo.'
              }
              accion={
                <EnlaceBoton href="/referencias" variante="secundario">
                  Ver todas las referencias
                </EnlaceBoton>
              }
            />
          ) : (
            <ul className="space-y-3" aria-label="Referencias pendientes para ti, de la más antigua a la más reciente">
              {pendientes.map((f) => (
                <FilaPendienteUI key={f.asignacionId ?? `area-${f.referenciaId}`} f={f} ahora={ahora} />
              ))}
            </ul>
          )
        }
        esperando={
          esperando.length === 0 ? (
            veTodas ? (
              <EstadoVacio
                icono={Hourglass}
                titulo="No hay asignaciones abiertas"
                descripcion="Lo que el equipo envíe con «Enviar a…» aparece aquí con su estado, si ya la abrió y un botón para recordar."
              />
            ) : (
              <EstadoVacio
                icono={Hourglass}
                titulo="No esperas respuesta de nadie"
                descripcion="Cuando envíes una referencia con «Enviar a…», la verás aquí con su estado, si ya la abrió y un botón para recordar."
              />
            )
          ) : (
            <ul className="space-y-3" aria-label={veTodas ? 'Asignaciones abiertas de todo el equipo' : 'Referencias que enviaste y siguen abiertas'}>
              {esperando.map((f) => (
                <FilaEsperandoUI key={f.asignacionId} f={f} />
              ))}
            </ul>
          )
        }
        recientes={
          recientes.length === 0 ? (
            <EstadoVacio
              icono={FileStack}
              titulo="Aún no hay referencias"
              descripcion="Crea la primera y empezamos la base."
              accion={
                puedeCrear ? (
                  <EnlaceBoton href="/referencias/nueva" variante="primario">
                    Nueva referencia
                  </EnlaceBoton>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-3" aria-label="Referencias con actividad reciente">
              {recientes.map((f) => (
                <FilaRecienteUI key={f.id} f={f} />
              ))}
            </ul>
          )
        }
      />
    </div>
  );
}
