'use client';

import { Eye, History, Lock, MessageSquareText, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { abrirFichaAccion, comentarAccion } from '@/app/acciones/colaboracion';
import { Avatar, nombreVisible, Persona } from '@/componentes/ui/avatar';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Cajon } from '@/componentes/ui/dialogo';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Esqueleto, EsqueletoZona } from '@/componentes/ui/esqueleto';
import { AreaTexto, Seleccion } from '@/componentes/ui/input';
import { Insignia } from '@/componentes/ui/insignia';
import { Pestanas } from '@/componentes/ui/pestanas';
import { GrupoRadios } from '@/componentes/ui/casilla';
import { useAvisos } from '@/componentes/ui/toast';
import { plural } from '@/dominio/colaboracion';
import type { ComentarioVista, ContextoEnvio, HistorialFicha, SeguimientoAsignacion } from '@/server/politicas/colaboracion';
import { AccionesAsignacion } from './AccionesAsignacion';
import {
  avisarCambioDeFicha,
  EVENTO_ABRIR_ACTIVIDAD,
  fechaHora,
  hace,
  leer,
  type DetalleAbrirActividad,
} from './api';
import { DialogoRestaurar, LineaDeTiempo, type ObjetivoRestaurar } from './Historial';
import { InsigniaPedido } from './piezas';
import { useLectura } from './usar-lectura';

type IdPestana = 'historial' | 'comentarios' | 'envios';

/**
 * Panel lateral de la ficha (10.2): Historial (linea de tiempo por campo con restaurar), Comentarios (con
 * alcance) y Envios (a quien esta enviada, desde cuando, si ya la abrio, recordar). Es un cajon
 * superpuesto: no ensancha el formulario; en movil es una hoja inferior.
 *
 * Al montarse tambien registra que la persona abrio la ficha (`pendiente` -> `en_curso`) y marca leidos
 * los avisos de esa ficha. Se puede abrir desde fuera con el evento `dm:abrir-actividad`
 * (`abrirActividad({ referenciaId, pestana, campo })` de `./api`): por ejemplo, el icono de comentario de un campo.
 */
export function PanelActividadCliente({ referenciaId }: { referenciaId: string }) {
  const [abierto, setAbierto] = useState(false);
  const [pestana, setPestana] = useState<IdPestana>('historial');
  const [campo, setCampo] = useState<string | null>(null);

  // Abrir la ficha: su pendiente pasa a "en curso" y sus avisos quedan leidos (una vez por montaje).
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      if (vivo) void abrirFichaAccion({ referenciaId });
    }, 600);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [referenciaId]);

  useEffect(() => {
    const alPedir = (e: Event) => {
      const d = (e as CustomEvent<DetalleAbrirActividad>).detail;
      if (!d || d.referenciaId !== referenciaId) return;
      setPestana(d.pestana ?? 'historial');
      setCampo(d.campo ?? null);
      setAbierto(true);
    };
    window.addEventListener(EVENTO_ABRIR_ACTIVIDAD, alPedir);
    return () => window.removeEventListener(EVENTO_ABRIR_ACTIVIDAD, alPedir);
  }, [referenciaId]);

  return (
    <>
      <Boton
        variante="secundario"
        onClick={() => {
          setCampo(null);
          setAbierto(true);
        }}
        aria-haspopup="dialog"
      >
        <History aria-hidden className="size-4" />
        Historial y comentarios
      </Boton>
      <Cajon abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Actividad de la referencia" descripcion="Quién cambió qué, qué se comentó y a quién está enviada.">
        {abierto ? <ContenidoPanel referenciaId={referenciaId} pestana={pestana} onPestana={setPestana} campo={campo} onCampo={setCampo} /> : null}
      </Cajon>
    </>
  );
}

function ContenidoPanel({
  referenciaId,
  pestana,
  onPestana,
  campo,
  onCampo,
}: {
  referenciaId: string;
  pestana: IdPestana;
  onPestana: (p: IdPestana) => void;
  campo: string | null;
  onCampo: (c: string | null) => void;
}) {
  const envios = useLectura<SeguimientoAsignacion[]>(`/api/colaboracion/ficha/${referenciaId}/seguimiento`, { referenciaId, intervaloMs: 15_000 });
  const activas = envios.estado.tipo === 'ok' ? envios.estado.data.filter((s) => s.activa).length : undefined;

  return (
    <Pestanas
      etiqueta="Actividad"
      valor={pestana}
      onCambio={(id) => onPestana(id as IdPestana)}
      items={[
        { id: 'historial', etiqueta: 'Historial', contenido: <PestanaHistorial referenciaId={referenciaId} campo={campo} onCampo={onCampo} /> },
        { id: 'comentarios', etiqueta: 'Comentarios', contenido: <PestanaComentarios referenciaId={referenciaId} campo={campo} onCampo={onCampo} /> },
        {
          id: 'envios',
          etiqueta: 'Envíos',
          ...(activas !== undefined ? { contador: activas } : {}),
          contenido: <PestanaEnvios referenciaId={referenciaId} lectura={envios} />,
        },
      ]}
    />
  );
}

// ---- Historial ---------------------------------------------------------------------------------------------------

function PestanaHistorial({ referenciaId, campo, onCampo }: { referenciaId: string; campo: string | null; onCampo: (c: string | null) => void }) {
  const url = `/api/colaboracion/ficha/${referenciaId}/historial${campo ? `?campo=${encodeURIComponent(campo)}` : ''}`;
  const lectura = useLectura<HistorialFicha>(url, { referenciaId });
  const [extra, setExtra] = useState<{ clave: string; items: HistorialFicha['items']; siguiente: number | null } | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [objetivo, setObjetivo] = useState<ObjetivoRestaurar | null>(null);

  const datos = lectura.estado.tipo === 'ok' ? lectura.estado.data : null;
  const claveExtra = `${referenciaId}|${campo ?? ''}`;
  const extraVigente = extra && extra.clave === claveExtra ? extra : null;
  const items = datos ? [...datos.items, ...(extraVigente?.items ?? [])] : [];
  const siguiente = extraVigente ? extraVigente.siguiente : (datos?.siguiente ?? null);

  async function masAntiguos() {
    if (!siguiente) return;
    setCargandoMas(true);
    const r = await leer<HistorialFicha>(`${url}${campo ? '&' : '?'}antes=${siguiente}`);
    setCargandoMas(false);
    if (r.ok) setExtra({ clave: claveExtra, items: [...(extraVigente?.items ?? []), ...r.data.items], siguiente: r.data.siguiente });
  }

  return (
    <div className="space-y-4">
      {datos && datos.campos.length > 1 ? (
        <CampoFormulario etiqueta="Ver el historial de">
          {(p) => (
            <Seleccion {...p} value={campo ?? ''} onChange={(e) => onCampo(e.target.value || null)}>
              <option value="">Todos los campos</option>
              {datos.campos.map((c) => (
                <option key={c.clave} value={c.clave}>
                  {c.etiqueta}
                </option>
              ))}
            </Seleccion>
          )}
        </CampoFormulario>
      ) : null}

      {lectura.estado.tipo === 'cargando' ? (
        <EsqueletoZona etiqueta="Cargando el historial…" className="space-y-3">
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
        </EsqueletoZona>
      ) : lectura.estado.tipo === 'error' ? (
        <Aviso
          tipo="error"
          titulo="No pudimos cargar el historial"
          accion={
            <Boton variante="secundario" tamano="sm" onClick={lectura.recargar}>
              Reintentar
            </Boton>
          }
        >
          {lectura.estado.mensaje}
        </Aviso>
      ) : items.length === 0 ? (
        <EstadoVacio compacto icono={History} titulo="Todavía no hay cambios" descripcion="Cada vez que alguien escriba un campo, queda aquí con su autor, la fecha y el motivo si lo hubo." />
      ) : (
        <>
          <LineaDeTiempo
            items={items}
            mostrarCampo
            onRestaurar={(e) => setObjetivo({ referenciaId, historialId: e.id, campo: e.campo, etiqueta: e.etiqueta, valor: e.tipoEvento === 'vaciar' ? 'Vacío' : e.valor })}
          />
          {siguiente ? (
            <Boton variante="secundario" onClick={() => void masAntiguos()} cargando={cargandoMas} className="w-full">
              Mostrar cambios más antiguos
            </Boton>
          ) : null}
        </>
      )}
      <DialogoRestaurar
        objetivo={objetivo}
        onCerrar={() => setObjetivo(null)}
        onHecho={() => {
          setObjetivo(null);
          setExtra(null);
          lectura.recargar();
        }}
      />
    </div>
  );
}

// ---- Comentarios -----------------------------------------------------------------------------------------------

function PestanaComentarios({ referenciaId, campo, onCampo }: { referenciaId: string; campo: string | null; onCampo: (c: string | null) => void }) {
  const url = `/api/colaboracion/ficha/${referenciaId}/comentarios${campo ? `?campo=${encodeURIComponent(campo)}` : ''}`;
  const lectura = useLectura<ComentarioVista[]>(url, { referenciaId, intervaloMs: 20_000 });
  const contexto = useLectura<ContextoEnvio>(`/api/colaboracion/ficha/${referenciaId}/contexto`);
  const fin = useRef<HTMLDivElement | null>(null);
  const comentarios = lectura.estado.tipo === 'ok' ? lectura.estado.data : [];

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [comentarios.length]);

  return (
    <div className="space-y-4">
      {campo ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-azul-50 px-3 py-2 text-sm text-azul-900">
          <span>
            Mostrando solo los comentarios de <strong>{comentarios.find((c) => c.campo === campo)?.campoEtiqueta ?? 'un campo'}</strong>.
          </span>
          <Boton variante="terciario" tamano="sm" onClick={() => onCampo(null)}>
            Ver todos
          </Boton>
        </div>
      ) : null}

      {lectura.estado.tipo === 'cargando' ? (
        <EsqueletoZona etiqueta="Cargando comentarios…" className="space-y-3">
          <Esqueleto className="h-16" />
          <Esqueleto className="h-16" />
        </EsqueletoZona>
      ) : lectura.estado.tipo === 'error' ? (
        <Aviso
          tipo="error"
          titulo="No pudimos cargar los comentarios"
          accion={
            <Boton variante="secundario" tamano="sm" onClick={lectura.recargar}>
              Reintentar
            </Boton>
          }
        >
          {lectura.estado.mensaje}
        </Aviso>
      ) : comentarios.length === 0 ? (
        <EstadoVacio
          compacto
          icono={MessageSquareText}
          titulo="Aún no hay comentarios"
          descripcion="Úsalos para aclarar algo sin cambiar el campo. Los comentarios no se editan ni se borran."
        />
      ) : (
        <ul className="space-y-3" aria-label="Comentarios">
          {comentarios.map((c) => (
            <li key={c.id} className="flex gap-3" data-testid="comentario">
              <Avatar nombre={c.autor} tamano="sm" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-bold text-tinta">{c.autorEsPropio ? 'Tú' : nombreVisible(c.autor)}</span>
                  <time dateTime={c.creadoEn} title={fechaHora(c.creadoEn)} className="text-xs text-tinta-suave">
                    {hace(c.creadoEn)}
                  </time>
                  {c.visibilidad === 'interno' ? (
                    <Insignia variante="contorno" icono={<Lock aria-hidden className="size-3" />}>
                      Solo equipo interno
                    </Insignia>
                  ) : (
                    <Insignia variante="azul" icono={<Eye aria-hidden className="size-3" />}>
                      Visible para la aduana
                    </Insignia>
                  )}
                </p>
                {c.campoEtiqueta ? <p className="text-xs text-tinta-suave">Sobre «{c.campoEtiqueta}»</p> : null}
                <p className="mt-1 whitespace-pre-wrap break-words rounded-lg rounded-tl-sm border border-borde-suave bg-superficie-2 px-3 py-2 text-sm text-tinta">{c.texto}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div ref={fin} />

      <FormularioComentario
        referenciaId={referenciaId}
        campo={campo}
        puedeEscribir={contexto.estado.tipo !== 'ok' || contexto.estado.data.puedeComentar}
        soloParaTodos={contexto.estado.tipo === 'ok' && contexto.estado.data.comentaSoloParaTodos}
        alPublicar={lectura.recargar}
      />
    </div>
  );
}

function FormularioComentario({
  referenciaId,
  campo,
  puedeEscribir,
  soloParaTodos,
  alPublicar,
}: {
  referenciaId: string;
  campo: string | null;
  puedeEscribir: boolean;
  soloParaTodos: boolean;
  alPublicar: () => void;
}) {
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState('');
  const [visibilidad, setVisibilidad] = useState<'interno' | 'todos'>('interno');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!puedeEscribir) {
    return <Aviso>Tu rol puede leer los comentarios, pero no escribirlos.</Aviso>;
  }

  async function publicar() {
    const limpio = texto.trim();
    if (!limpio) {
      setError('Escribe el comentario antes de enviarlo.');
      return;
    }
    setEnviando(true);
    setError(null);
    // La aduana solo escribe «para todos» (el servidor lo impone; aqui solo se oculta la eleccion).
    const r = await comentarAccion({ referenciaId, texto: limpio, visibilidad: soloParaTodos ? 'todos' : visibilidad, ...(campo ? { campo } : {}) });
    setEnviando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    setTexto('');
    avisar({ tipo: 'exito', titulo: 'Comentario publicado', descripcion: r.data.notificados > 0 ? `Avisamos a ${plural(r.data.notificados, 'persona', 'personas')}.` : undefined });
    avisarCambioDeFicha(referenciaId);
    alPublicar();
  }

  return (
    <form
      className="sticky bottom-0 -mx-1 space-y-3 border-t border-borde-suave bg-superficie px-1 pb-1 pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        void publicar();
      }}
    >
      {error ? (
        <Aviso tipo="error" titulo="No pudimos publicar el comentario">
          {error}
        </Aviso>
      ) : null}
      <CampoFormulario etiqueta="Nuevo comentario" ayuda="Se queda como está: no se edita ni se borra.">
        {(p) => <AreaTexto {...p} rows={3} value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 2000))} maxLength={2000} placeholder="Brian, el fabricante cambió de nombre en la última factura." />}
      </CampoFormulario>
      {!soloParaTodos ? (
        <GrupoRadios
          leyenda="¿Quién lo ve?"
          nombre="visibilidad-comentario"
          orientacion="horizontal"
          valor={visibilidad}
          onCambio={(v) => setVisibilidad(v as 'interno' | 'todos')}
          opciones={[
            { valor: 'interno', etiqueta: 'Solo el equipo interno' },
            { valor: 'todos', etiqueta: 'También la aduana' },
          ]}
        />
      ) : (
        <p className="text-sm text-tinta-suave">Lo ve el equipo interno y tu agencia.</p>
      )}
      <Boton type="submit" cargando={enviando} disabled={texto.trim() === ''} className="w-full">
        <Send aria-hidden className="size-4" />
        {enviando ? 'Publicando…' : 'Publicar comentario'}
      </Boton>
    </form>
  );
}

// ---- Envios -----------------------------------------------------------------------------------------------------

function textoEstadoEnvio(s: SeguimientoAsignacion): string {
  if (s.estado === 'pendiente') return `Pendiente desde ${hace(s.creadaEn)}`;
  if (s.estado === 'en_curso') return `Ya la abrió${s.vistaEn ? ` ${hace(s.vistaEn)}` : ''}`;
  if (s.estado === 'hecha') return `Terminó su parte ${s.completadaEn ? hace(s.completadaEn) : ''}`.trim();
  if (s.estado === 'reasignada') return `Se la pasaron a otra persona ${s.completadaEn ? hace(s.completadaEn) : ''}`.trim();
  return `Se canceló ${s.completadaEn ? hace(s.completadaEn) : ''}`.trim();
}

function PestanaEnvios({ referenciaId, lectura }: { referenciaId: string; lectura: ReturnType<typeof useLectura<SeguimientoAsignacion[]>> }) {
  void referenciaId;
  if (lectura.estado.tipo === 'cargando') {
    return (
      <EsqueletoZona etiqueta="Cargando envíos…" className="space-y-3">
        <Esqueleto className="h-24" />
        <Esqueleto className="h-24" />
      </EsqueletoZona>
    );
  }
  if (lectura.estado.tipo === 'error') {
    return (
      <Aviso
        tipo="error"
        titulo="No pudimos cargar los envíos"
        accion={
          <Boton variante="secundario" tamano="sm" onClick={lectura.recargar}>
            Reintentar
          </Boton>
        }
      >
        {lectura.estado.mensaje}
      </Aviso>
    );
  }
  const todas = lectura.estado.data;
  const activas = todas.filter((s) => s.activa);
  const anteriores = todas.filter((s) => !s.activa);

  return (
    <div className="space-y-5">
      {activas.length === 0 ? (
        <EstadoVacio
          compacto
          icono={Send}
          titulo="Nadie la tiene pendiente"
          descripcion="Cuando envíes esta referencia a alguien con «Enviar a…», verás aquí desde cuándo la tiene y si ya la abrió."
        />
      ) : (
        <ul className="space-y-3" aria-label="Envíos abiertos">
          {activas.map((s) => (
            <li key={s.asignacionId} className="space-y-2.5 rounded-xl border border-borde-suave bg-superficie p-3.5" data-testid="envio-abierto">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Persona nombre={s.a.nombre} organizacion={s.a.organizacion || undefined} esExterno={s.a.esAgencia && !s.a.enmascarada} tamano="sm" />
                <InsigniaPedido pedido={s.pedido} />
              </div>
              <p className="text-sm text-tinta">{textoEstadoEnvio(s)}</p>
              {s.mensaje ? <p className="rounded-md bg-superficie-2 px-2.5 py-1.5 text-sm text-tinta">«{s.mensaje}»</p> : null}
              <p className="text-xs text-tinta-suave">
                Enviada por {s.esMia ? 'ti' : nombreVisible(s.de.nombre)}
                {s.nRecordatorios > 0 ? ` · ${plural(s.nRecordatorios, 'recordatorio', 'recordatorios')}` : ''}
              </p>
              {s.puedeRecordar || s.puedeCancelar || s.puedeReasignar ? (
                <AccionesAsignacion
                  onCambio={lectura.recargar}
                  a={{
                    asignacionId: s.asignacionId,
                    referenciaId: s.referenciaId,
                    codigo: s.codigo,
                    nombreDestino: s.a.nombre,
                    destinoId: s.a.id,
                    puedeRecordar: s.puedeRecordar,
                    puedeGestionar: s.puedeCancelar || s.puedeReasignar,
                    recordadaHoy: s.recordadaHoy,
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {anteriores.length > 0 ? (
        <details className="rounded-xl border border-borde-suave bg-superficie-2">
          <summary className="min-h-11 cursor-pointer list-none px-3.5 py-3 text-sm font-semibold text-tinta">
            Anteriores ({anteriores.length})
          </summary>
          <ul className="divide-y divide-borde-suave border-t border-borde-suave">
            {anteriores.map((s) => (
              <li key={s.asignacionId} className="space-y-1 px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Persona nombre={s.a.nombre} tamano="sm" />
                  <InsigniaPedido pedido={s.pedido} />
                </div>
                <p className="pl-9 text-sm text-tinta-suave">{textoEstadoEnvio(s)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

