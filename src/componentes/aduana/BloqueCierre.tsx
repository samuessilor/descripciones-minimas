'use client';

import { Archive, ArchiveRestore, LockOpen, ShieldCheck } from 'lucide-react';
import { useId, useState } from 'react';
import {
  archivarAccion,
  desarchivarAccion,
  finalizarAccion,
  reabrirAccion,
  solicitarReaperturaAccion,
} from '@/app/acciones/aduana';
import { guardarCampoAccion } from '@/app/acciones/ficha';
import { Estado } from '@/componentes/Estado';
import { Aviso } from '@/componentes/ui/aviso';
import { nombreVisible } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Dialogo, DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { AreaTexto, Seleccion } from '@/componentes/ui/input';
import { useAvisos } from '@/componentes/ui/toast';
import type { AvisoCierreVista, VistaAduana } from '@/server/politicas/aduana';
import { EncabezadoPaso, fechaCorta, fechaLarga, sinTexto } from './comun';

type Destino = 'partida' | 'descripciones' | 'restricciones';

export function BloqueCierre({
  vista,
  alCambiar,
  irA,
}: {
  vista: VistaAduana;
  alCambiar: () => void;
  /** Lleva a quien lee al bloque que hay que completar. */
  irA: (d: Destino) => void;
}) {
  const id = useId().replace(/:/g, '');
  const { avisar } = useAvisos();
  const [cerrando, setCerrando] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);
  const [solicitando, setSolicitando] = useState(false);
  const [archivando, setArchivando] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [eligiendo, setEligiendo] = useState<'' | 'SI' | 'NO'>('');
  const [nota, setNota] = useState('');
  const [guardandoNo, setGuardandoNo] = useState(false);
  const [errorNo, setErrorNo] = useState('');

  const cerrada = vista.estado === 'CLASIFICADA';
  const valorFinalizada = sinTexto(vista.finalizada?.valor);
  const { permisos } = vista;

  async function guardarNo() {
    setGuardandoNo(true);
    setErrorNo('');
    const r = await guardarCampoAccion({
      referenciaId: vista.referenciaId,
      campo: 'clasificacion_finalizada',
      valor: 'NO',
      versionEsperada: vista.finalizada?.version ?? 0,
      ...(nota.trim() ? { motivo: nota.trim() } : {}),
    });
    setGuardandoNo(false);
    if (!r.ok) {
      if (r.codigo === 'FALTA_MOTIVO') setErrorNo('Cuéntanos qué falta: otra persona ya había marcado este campo y recibirá un aviso.');
      else setErrorNo(r.mensaje);
      return;
    }
    setEligiendo('');
    setNota('');
    avisar({ tipo: 'info', titulo: 'Quedó pendiente de información', descripcion: 'Para pedirle al área lo que falta, usa «Enviar a…» con un mensaje.' });
    alCambiar();
  }

  return (
    <div className="space-y-5" role="group" aria-labelledby={`${id}-t`}>
      <EncabezadoPaso
        id={`${id}-t`}
        icono={ShieldCheck}
        titulo="Cierre de la clasificación"
        hecho={cerrada}
        ayuda={
          cerrada
            ? 'La clasificación está cerrada. Todo lo que se escribió sigue guardado en el historial.'
            : vista.permisos.cerrar
              ? 'Cuando la partida, las descripciones mínimas adicionales, las restricciones y las observaciones estén listas, cierra la clasificación. La referencia pasa a verde.'
              : 'La aduana cierra la clasificación cuando la partida, las descripciones mínimas adicionales, las restricciones y las observaciones están listas. La referencia pasa a verde.'
        }
      />

      {vista.archivada && vista.archivo ? (
        <Aviso tipo="aviso" titulo={`Archivada el ${fechaLarga(vista.archivo.en)} por ${nombreVisible(vista.archivo.por)}`}>
          {vista.archivo.motivo ? `Motivo: ${vista.archivo.motivo}. ` : ''}Nada se borró: un administrador puede restaurarla.
          {permisos.desarchivar ? (
            <span className="mt-2 block">
              <Boton variante="secundario" tamano="sm" onClick={() => setRestaurando(true)}>
                <ArchiveRestore aria-hidden className="size-4" /> Restaurar referencia
              </Boton>
            </span>
          ) : null}
        </Aviso>
      ) : null}

      {cerrada && vista.clasificada ? (
        <div className="space-y-3 rounded-xl border border-verde-solido/40 bg-verde-fondo/50 p-4" data-cierre="cerrada">
          <div className="flex flex-wrap items-center gap-3">
            <Estado color="verde" texto="Clasificada" tamano="lg" />
            <p className="text-base font-semibold text-tinta">
              Cerrada {vista.clasificada.por ? `por ${nombreVisible(vista.clasificada.por)} ` : ''}el {fechaLarga(vista.clasificada.en)}
            </p>
          </div>
          <p className="text-sm text-tinta-suave">
            {vista.diasEnGestion} {vista.diasEnGestion === 1 ? 'día' : 'días'} en gestión: el conteo quedó congelado al cerrar.
            {vista.clasificada.accesoHasta ? ` Tu agencia puede ver esta referencia hasta el ${fechaLarga(vista.clasificada.accesoHasta)}.` : ''}
          </p>
          {vista.solicitudReapertura ? (
            <Aviso tipo="info" titulo={`${nombreVisible(vista.solicitudReapertura.de)} pidió reabrirla`}>
              {vista.solicitudReapertura.motivo ?? ''} <span className="text-tinta-suave">· {fechaCorta(vista.solicitudReapertura.en)}</span>
            </Aviso>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {permisos.reabrir ? (
              <Boton variante="secundario" onClick={() => setReabriendo(true)}>
                <LockOpen aria-hidden className="size-4" /> Reabrir clasificación
              </Boton>
            ) : null}
            {permisos.solicitarReapertura ? (
              <Boton variante="secundario" onClick={() => setSolicitando(true)}>
                <LockOpen aria-hidden className="size-4" /> Solicitar reapertura
              </Boton>
            ) : null}
          </div>
        </div>
      ) : null}

      {!cerrada && !vista.archivada ? (
        <>
          {vista.reabierta ? (
            <Aviso tipo="info" titulo="Esta clasificación fue reabierta">
              La partida anterior sigue en el historial. Ajusta lo que haga falta y vuelve a cerrar.
            </Aviso>
          ) : null}

          {valorFinalizada === 'NO' ? (
            <Aviso tipo="aviso" titulo="Pendiente de información">
              Marcaste que falta información. El área ve esta referencia amarilla hasta que respondas y cierres.
            </Aviso>
          ) : null}

          {permisos.cerrar ? (
            <div className="space-y-3">
              <ResumenPrevio cierre={vista.cierre} irA={irA} />
              <CampoFormulario
                etiqueta="Clasificación finalizada"
                ayuda="Elige SÍ para cerrar la clasificación. Elige NO si todavía falta información."
              >
                {(p) => (
                  <Seleccion
                    {...p}
                    value={eligiendo}
                    onChange={(e) => {
                      const v = e.target.value as '' | 'SI' | 'NO';
                      setEligiendo(v);
                      setErrorNo('');
                      if (v === 'SI') setCerrando(true);
                    }}
                  >
                    <option value="">{valorFinalizada === 'NO' ? 'NO (pendiente de información)' : 'Elige SÍ o NO'}</option>
                    <option value="SI">SÍ: cerrar la clasificación</option>
                    <option value="NO">NO: falta información</option>
                  </Seleccion>
                )}
              </CampoFormulario>
              {eligiendo === 'NO' ? (
                <div className="space-y-3 rounded-lg border border-azul-300 bg-azul-50 p-3.5">
                  <CampoFormulario etiqueta="¿Qué falta?" opcional ayuda="Queda en el historial. Para pedirle datos al área, usa «Enviar a…» con un mensaje.">
                    {(p) => <AreaTexto {...p} rows={2} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} />}
                  </CampoFormulario>
                  {errorNo ? <p role="alert" className="text-sm font-medium text-error">{errorNo}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Boton tamano="sm" onClick={guardarNo} cargando={guardandoNo}>
                      {guardandoNo ? 'Guardando…' : 'Guardar como pendiente'}
                    </Boton>
                    <Boton tamano="sm" variante="terciario" onClick={() => setEligiendo('')} disabled={guardandoNo}>
                      Cancelar
                    </Boton>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-base text-tinta-suave">
              {vista.bloqueo === 'borrador'
                ? 'Esta referencia sigue en borrador. Cuando se envíe a la aduana podrás cerrarla.'
                : 'Solo la aduana o un administrador pueden cerrar la clasificación.'}
            </p>
          )}
        </>
      ) : null}

      {permisos.archivar && !vista.archivada ? (
        <div className="border-t border-borde-suave pt-3">
          <Boton variante="terciario" tamano="sm" onClick={() => setArchivando(true)}>
            <Archive aria-hidden className="size-4" /> Archivar referencia
          </Boton>
        </div>
      ) : null}

      {cerrando ? (
        <DialogoCierre
          vista={vista}
          irA={irA}
          onCerrar={() => {
            setCerrando(false);
            setEligiendo('');
          }}
          alCerrada={() => {
            setCerrando(false);
            setEligiendo('');
            avisar({ tipo: 'exito', titulo: `${vista.codigo} quedó clasificada`, descripcion: 'La referencia pasó a verde. El historial se conserva completo.' });
            alCambiar();
          }}
          alFallar={alCambiar}
        />
      ) : null}

      {reabriendo ? (
      <DialogoConfirmacion
        abierto
        onCerrar={() => setReabriendo(false)}
        titulo="Reabrir la clasificación"
        descripcion={`Vas a reabrir la clasificación de ${vista.codigo}. Escribe el motivo; la partida actual queda en el historial.`}
        confirmar="Reabrir"
        cancelar="Todavía no"
        pedirMotivo
        ayudaMotivo="Ejemplo: el proveedor cambió y hay que revisar la partida."
        onConfirmar={async (motivo) => {
          const r = await reabrirAccion({ referenciaId: vista.referenciaId, motivo });
          if (!r.ok) throw new Error(r.mensaje);
          avisar({ tipo: 'info', titulo: 'Clasificación reabierta', descripcion: 'La referencia volvió a amarillo. Quien la pidió recibió un aviso.' });
          alCambiar();
        }}
      />
      ) : null}
      {solicitando ? (
      <DialogoConfirmacion
        abierto
        onCerrar={() => setSolicitando(false)}
        titulo="Solicitar reapertura"
        descripcion="Cuéntale al administrador por qué hay que reabrirla."
        confirmar="Enviar solicitud"
        cancelar="Todavía no"
        pedirMotivo
        ayudaMotivo="La solicitud le llega a quien clasificó y a los administradores."
        onConfirmar={async (motivo) => {
          const r = await solicitarReaperturaAccion({ referenciaId: vista.referenciaId, motivo });
          if (!r.ok) throw new Error(r.mensaje);
          avisar({ tipo: 'exito', titulo: 'Enviamos tu solicitud', descripcion: 'No reabre la referencia por sí sola: quien clasificó decide.' });
          alCambiar();
        }}
      />
      ) : null}
      {archivando ? (
      <DialogoConfirmacion
        abierto
        onCerrar={() => setArchivando(false)}
        titulo="Archivar la referencia"
        descripcion="Nada se borra: puedes restaurarla desde el filtro Archivadas. El código sigue ocupado."
        confirmar="Archivar"
        cancelar="Todavía no"
        pedirMotivo
        onConfirmar={async (motivo) => {
          const r = await archivarAccion({ referenciaId: vista.referenciaId, motivo });
          if (!r.ok) throw new Error(r.mensaje);
          avisar({ tipo: 'info', titulo: 'Referencia archivada' });
          alCambiar();
        }}
      />
      ) : null}
      {restaurando ? (
      <DialogoConfirmacion
        abierto
        onCerrar={() => setRestaurando(false)}
        titulo="Restaurar la referencia"
        descripcion="Vuelve al estado en que estaba antes de archivarla."
        confirmar="Restaurar"
        cancelar="Todavía no"
        pedirMotivo
        onConfirmar={async (motivo) => {
          const r = await desarchivarAccion({ referenciaId: vista.referenciaId, motivo });
          if (!r.ok) throw new Error(r.mensaje);
          avisar({ tipo: 'exito', titulo: 'Referencia restaurada' });
          alCambiar();
        }}
      />
      ) : null}
    </div>
  );
}

/** Lo que falta hoy, antes de abrir el cierre: la aduana lo ve sin tener que intentar cerrar. */
function ResumenPrevio({ cierre, irA }: { cierre: VistaAduana['cierre']; irA: (d: Destino) => void }) {
  const faltas: AvisoCierreVista[] = cierre.ok ? cierre.advertencias : cierre.bloqueos;
  if (faltas.length === 0) {
    return <Aviso tipo="exito" titulo="Todo está listo para cerrar">La partida está escrita y no hay pendientes.</Aviso>;
  }
  return (
    <Aviso tipo="aviso" titulo={cierre.ok ? 'Esto sigue pendiente (puedes cerrar igual, con un motivo)' : 'Antes de cerrar'}>
      <ul className="mt-1 space-y-1">
        {faltas.map((f) => (
          <li key={`${f.regla}-${f.mensaje}`}>
            <span className="font-semibold">{f.mensaje}</span>
            {f.detalle.length > 0 ? `: ${f.detalle.join(', ')}` : ''}
            {destinoDe(f.regla) ? (
              <button type="button" onClick={() => irA(destinoDe(f.regla) as Destino)} className="ml-2 font-semibold text-azul-500 underline underline-offset-2">
                Ir allí
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </Aviso>
  );
}

function destinoDe(regla: string): Destino | null {
  if (regla === 'G1') return 'partida';
  if (regla === 'A2') return 'descripciones';
  if (regla === 'A3') return 'restricciones';
  return null;
}

// ---- Dialogo de cierre (G1/G6, A1-A3, "cerrar de todos modos") -------------------------------------------

function DialogoCierre({
  vista,
  irA,
  onCerrar,
  alCerrada,
  alFallar,
}: {
  vista: VistaAduana;
  irA: (d: Destino) => void;
  onCerrar: () => void;
  alCerrada: () => void;
  alFallar: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const { cierre } = vista;
  const bloqueado = !cierre.ok;
  const advertencias = cierre.ok ? cierre.advertencias : [];
  const conPendientes = advertencias.length > 0;
  const visible = motivo.replace(/[\s\p{Cc}\p{Cf}]/gu, '').length > 0;

  async function cerrar() {
    setEnviando(true);
    setError('');
    const r = await finalizarAccion({ referenciaId: vista.referenciaId, ...(conPendientes ? { motivoCerrarDeTodosModos: motivo } : {}) });
    setEnviando(false);
    if (r.ok) {
      alCerrada();
      return;
    }
    setError(r.mensaje);
    alFallar(); // la ficha pudo cambiar mientras tanto: se actualiza la lista de pendientes
  }

  return (
    <Dialogo
      abierto
      onCerrar={onCerrar}
      titulo="Cerrar la clasificación"
      descripcion="Vas a cerrar la clasificación. La referencia quedará en verde y cada campo seguirá guardado en el historial."
      tamano="md"
      bloquear={enviando}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={enviando} data-autofocus={bloqueado ? '' : undefined}>
            {bloqueado ? 'Entendido' : 'Todavía no'}
          </Boton>
          {!bloqueado ? (
            <Boton onClick={cerrar} cargando={enviando} disabled={conPendientes && !visible}>
              {enviando ? 'Cerrando…' : conPendientes ? 'Cerrar de todos modos' : 'Cerrar clasificación'}
            </Boton>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {bloqueado ? (
          <div className="space-y-3">
            {cierre.bloqueos.map((b) => (
              <Aviso
                key={`${b.regla}-${b.mensaje}`}
                tipo="error"
                titulo={b.mensaje}
                accion={
                  destinoDe(b.regla) ? (
                    <Boton
                      variante="secundario"
                      tamano="sm"
                      onClick={() => {
                        onCerrar();
                        irA(destinoDe(b.regla) as Destino);
                      }}
                    >
                      Ir a completarlo
                    </Boton>
                  ) : null
                }
              >
                {b.detalle.length > 0 ? b.detalle.join(', ') : cierre.modo === 'bloquear' && b.regla.startsWith('A') ? 'Esta plataforma exige que esté completo para cerrar.' : null}
              </Aviso>
            ))}
          </div>
        ) : conPendientes ? (
          <>
            <Aviso tipo="aviso" titulo="Antes de cerrar, esto sigue pendiente">
              <ul className="mt-1.5 space-y-2">
                {advertencias.map((a) => (
                  <li key={`${a.regla}-${a.mensaje}`}>
                    <p className="font-semibold">{a.mensaje}</p>
                    {a.detalle.length > 0 ? (
                      <ul className="ml-4 mt-0.5 list-disc text-sm">
                        {a.detalle.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Aviso>
            <CampoFormulario etiqueta="¿Por qué cierras con pendientes?" ayuda="Queda en el historial junto con esta lista. Ejemplo: la agencia ya despachó la mercancía.">
              {(p) => <AreaTexto {...p} rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} data-autofocus="" />}
            </CampoFormulario>
          </>
        ) : (
          <p className="text-base text-tinta">No hay nada pendiente: la partida, las descripciones mínimas adicionales, las restricciones y las observaciones están listas.</p>
        )}
        {error ? (
          <p role="alert" className="rounded-md border border-error/60 bg-error-fondo px-3 py-2 text-sm font-medium text-error">
            {error}
          </p>
        ) : null}
      </div>
    </Dialogo>
  );
}
