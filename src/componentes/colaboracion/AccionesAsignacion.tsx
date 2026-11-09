'use client';

import { BellRing, Ellipsis, Repeat2, Ban } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cancelarAsignacionAccion, recordarAccion, reasignarAccion } from '@/app/acciones/colaboracion';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { Dialogo, DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { Esqueleto, EsqueletoZona } from '@/componentes/ui/esqueleto';
import { ItemMenu, MenuDesplegable, SeparadorMenu } from '@/componentes/ui/menu-desplegable';
import { useAvisos } from '@/componentes/ui/toast';
import { nombreVisible } from '@/componentes/ui/avatar';
import type { CandidatoDestino } from '@/server/politicas/colaboracion';
import { avisarCambioDeFicha } from './api';
import { SelectorPersonas } from './EnviarA';
import { useLectura } from './usar-lectura';

export interface DatosAsignacion {
  asignacionId: string;
  referenciaId: string;
  codigo: string;
  /** A quien esta enviada (nombre visible). */
  nombreDestino: string;
  /** Id de la persona actual (para no ofrecerla al reasignar). */
  destinoId?: string | null;
  puedeRecordar: boolean;
  puedeGestionar: boolean;
  recordadaHoy: boolean;
}

/**
 * Acciones sobre una asignacion abierta: Recordar (con tope diario), Reasignar y Cancelar el envio.
 * Cada una dice el resultado (toast) o el error con salida; nada se hace en silencio.
 */
export function AccionesAsignacion({
  a,
  onCambio,
  etiquetaCompleta = false,
}: {
  a: DatosAsignacion;
  onCambio?: () => void;
  /** Muestra «Recordar a Brian» en lugar de solo «Recordar» (listas largas). */
  etiquetaCompleta?: boolean;
}) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [recordando, setRecordando] = useState(false);
  const [reasignando, setReasignando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [yaRecordada, setYaRecordada] = useState(a.recordadaHoy);
  const nombre = nombreVisible(a.nombreDestino);

  function cambio() {
    avisarCambioDeFicha(a.referenciaId);
    router.refresh();
    onCambio?.();
  }

  async function recordar() {
    setRecordando(true);
    const r = await recordarAccion({ asignacionId: a.asignacionId });
    setRecordando(false);
    if (r.ok) {
      setYaRecordada(true);
      avisar({
        tipo: 'exito',
        titulo: `Le recordamos a ${nombre}`,
        descripcion:
          r.data.canal === 'correo'
            ? 'Le llegó un aviso y el correo va en camino.'
            : r.data.canal === 'correo_invalido'
              ? 'Le llegó un aviso en la plataforma; su correo está marcado como inválido, avísale por otro medio.'
              : 'Le llegó un aviso en la plataforma.',
      });
      cambio();
    } else {
      if (r.codigo === 'LIMITE_TASA') setYaRecordada(true);
      avisar({
        tipo: r.codigo === 'LIMITE_TASA' ? 'info' : 'error',
        titulo: r.codigo === 'LIMITE_TASA' ? 'Ya le recordaste hoy' : 'No pudimos enviar el recordatorio',
        descripcion: r.mensaje,
        ...(r.codigo === 'LIMITE_TASA' ? {} : { accion: { etiqueta: 'Reintentar', onClick: () => void recordar() } }),
      });
    }
  }

  return (
    <div className="relative z-10 flex items-center gap-1.5">
      {a.puedeRecordar ? (
        <Boton
          variante="secundario"
          tamano="sm"
          onClick={() => void recordar()}
          cargando={recordando}
          disabled={yaRecordada}
          title={yaRecordada ? 'Ya le recordaste hoy. Puedes volver a hacerlo mañana.' : undefined}
          aria-label={yaRecordada ? `Recordado hoy (ya le recordaste a ${nombre})` : `Recordar a ${nombre}`}
        >
          <BellRing aria-hidden className="size-4" />
          {yaRecordada ? 'Recordado hoy' : etiquetaCompleta ? `Recordar a ${nombre.split(' ')[0]}` : 'Recordar'}
        </Boton>
      ) : null}
      {a.puedeGestionar ? (
        <MenuDesplegable
          etiqueta={`Más acciones para ${nombre}`}
          alinear="fin"
          disparador={(p) => (
            <Boton {...p} variante="terciario" tamano="icono-sm" aria-label={`Más acciones para ${nombre}`}>
              <Ellipsis aria-hidden className="size-5" />
            </Boton>
          )}
        >
          <ItemMenu onClick={() => setReasignando(true)}>
            <Repeat2 aria-hidden />
            Reasignar a otra persona…
          </ItemMenu>
          <SeparadorMenu />
          <ItemMenu onClick={() => setCancelando(true)}>
            <Ban aria-hidden />
            Cancelar el envío
          </ItemMenu>
        </MenuDesplegable>
      ) : null}

      {reasignando ? (
        <DialogoReasignar
          a={a}
          onCerrar={() => setReasignando(false)}
          onHecho={() => {
            setReasignando(false);
            cambio();
          }}
        />
      ) : null}
      <DialogoConfirmacion
        abierto={cancelando}
        onCerrar={() => setCancelando(false)}
        titulo={`Cancelar lo que le enviaste a ${nombre}`}
        descripcion={`${nombre} dejará de tener ${a.codigo} como pendiente. Si el correo aún no salió, tampoco saldrá. La referencia y su historial no se tocan.`}
        confirmar="Cancelar el envío"
        cancelar="Todavía no"
        peligro
        onConfirmar={async () => {
          const r = await cancelarAsignacionAccion({ asignacionId: a.asignacionId });
          if (!r.ok) throw new Error(r.mensaje);
          avisar({ tipo: 'exito', titulo: `Cancelaste el envío a ${nombre}` });
          cambio();
        }}
      />
    </div>
  );
}

function DialogoReasignar({ a, onCerrar, onHecho }: { a: DatosAsignacion; onCerrar: () => void; onHecho: () => void }) {
  const { avisar } = useAvisos();
  const lectura = useLectura<CandidatoDestino[]>(`/api/colaboracion/ficha/${a.referenciaId}/destinatarios`);
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidatos = (lectura.estado.tipo === 'ok' ? lectura.estado.data : []).filter((c) => c.id !== a.destinoId);
  const persona = candidatos.find((c) => c.id === elegido);

  async function reasignar() {
    if (!elegido) return;
    setEnviando(true);
    setError(null);
    const r = await reasignarAccion({ asignacionId: a.asignacionId, aUsuarioId: elegido });
    setEnviando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    avisar({ tipo: 'exito', titulo: `Reasignaste ${a.codigo} a ${nombreVisible(r.data.nueva.nombre)}`, descripcion: `${nombreVisible(a.nombreDestino)} ya no la tiene pendiente.` });
    onHecho();
  }

  return (
    <Dialogo
      abierto
      onCerrar={onCerrar}
      titulo={`Reasignar ${a.codigo}`}
      descripcion={`Hoy la tiene ${nombreVisible(a.nombreDestino)}. Elige a quién se la pasas: recibirá el aviso y ${nombreVisible(a.nombreDestino)} dejará de tenerla pendiente.`}
      bloquear={enviando}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton onClick={() => void reasignar()} cargando={enviando} disabled={!elegido}>
            {enviando ? 'Reasignando…' : persona ? `Reasignar a ${nombreVisible(persona.nombre).split(' ')[0]}` : 'Reasignar'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Aviso tipo="error" titulo="No pudimos reasignarla">
            {error}
          </Aviso>
        ) : null}
        {lectura.estado.tipo === 'cargando' ? (
          <EsqueletoZona etiqueta="Cargando personas…" className="space-y-3">
            <Esqueleto className="h-11" />
            <Esqueleto className="h-32" />
          </EsqueletoZona>
        ) : lectura.estado.tipo === 'error' ? (
          <Aviso
            tipo="error"
            titulo="No pudimos cargar a las personas"
            accion={
              <Boton variante="secundario" tamano="sm" onClick={lectura.recargar}>
                Reintentar
              </Boton>
            }
          >
            {lectura.estado.mensaje}
          </Aviso>
        ) : (
          <SelectorPersonas
            unico
            candidatos={candidatos}
            seleccion={new Set(elegido ? [elegido] : [])}
            q={q}
            onQ={setQ}
            onAlternar={(c) => setElegido((actual) => (actual === c.id ? null : c.id))}
          />
        )}
      </div>
    </Dialogo>
  );
}
