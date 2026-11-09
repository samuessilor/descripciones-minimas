'use client';

import { Bell, CircleCheck, Info, Search, Send, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { enviarAAccion, enviarALoteAccion, marcarListoAccion } from '@/app/acciones/colaboracion';
import { Aviso } from '@/componentes/ui/aviso';
import { Avatar, nombreVisible, Persona } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Casilla } from '@/componentes/ui/casilla';
import { Dialogo } from '@/componentes/ui/dialogo';
import { EsqueletoZona, Esqueleto } from '@/componentes/ui/esqueleto';
import { AreaTexto, Campo, Seleccion } from '@/componentes/ui/input';
import { Insignia } from '@/componentes/ui/insignia';
import { useAvisos } from '@/componentes/ui/toast';
import { ETIQUETA_SECCION, SECCIONES, type Seccion } from '@/dominio/campos';
import { ETIQUETA_PEDIDO, VERBO_PEDIDO, listaHumana, plural, type Pedido } from '@/dominio/colaboracion';
import { normalizarTexto } from '@/dominio/normalizacion';
import type { ResultadoEnviarA, ResumenDestinatario } from '@/server/acciones/asignaciones';
import type { CandidatoDestino, ContextoEnvio } from '@/server/politicas/colaboracion';
import { abrirActividad, avisarCambioDeFicha } from './api';
import { SONDEO } from './sondeo';
import { useLectura } from './usar-lectura';

const MAX_MENSAJE = 500;

function coincide(c: CandidatoDestino, q: string): boolean {
  const tokens = normalizarTexto(q).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const pajar = normalizarTexto(`${c.nombre} ${c.organizacion} ${c.area ?? ''} ${c.encargado ?? ''}`);
  return tokens.every((t) => pajar.includes(t));
}

function primerNombre(nombre: string): string {
  return nombreVisible(nombre).split(/\s+/)[0] ?? nombre;
}

/** Texto del boton principal: dice a quien y cuantas. */
function textoEnviar(seleccionados: CandidatoDestino[], fichas: number): string {
  const quien = seleccionados.length === 1 ? primerNombre(seleccionados[0]!.nombre) : plural(seleccionados.length, 'persona', 'personas');
  if (seleccionados.length === 0) return fichas > 1 ? `Enviar ${fichas} referencias` : 'Enviar';
  return fichas > 1 ? `Enviar ${fichas} referencias a ${quien}` : `Enviar a ${quien}`;
}

// ---- Selector de personas ---------------------------------------------------------------------------------

export function SelectorPersonas({
  candidatos,
  seleccion,
  q,
  onQ,
  onAlternar,
  onAgregarGrupo,
  unico = false,
  agentesPrimero = false,
}: {
  candidatos: CandidatoDestino[];
  seleccion: ReadonlySet<string>;
  q: string;
  onQ: (v: string) => void;
  onAlternar: (c: CandidatoDestino) => void;
  onAgregarGrupo?: (lista: CandidatoDestino[]) => void;
  unico?: boolean;
  /** Los agentes aduaneros van antes que las areas (la ficha ya tiene las tres secciones del area completas). */
  agentesPrimero?: boolean;
}) {
  const visibles = useMemo(() => candidatos.filter((c) => coincide(c, q)), [candidatos, q]);
  // Dos bloques con encabezado: cada agente es una cuenta de su empresa (el nombre de la empresa, bajo el de la cuenta, los
  // distingue entre si; el encabezado ya dice que es una agencia); las areas son las personas de EssilorLuxottica.
  const bloques = useMemo(() => {
    const agentes = { clave: 'agentes', titulo: 'Agentes aduaneros', lista: visibles.filter((c) => c.esAgencia) };
    const areas = { clave: 'areas', titulo: 'Áreas de EssilorLuxottica', lista: visibles.filter((c) => !c.esAgencia) };
    return (agentesPrimero ? [agentes, areas] : [areas, agentes]).filter((b) => b.lista.length > 0);
  }, [visibles, agentesPrimero]);
  const grupos = useMemo(() => {
    const mapa = new Map<string, CandidatoDestino[]>();
    for (const c of candidatos) {
      // «Agregar a todos» es solo para las areas: a la agencia se le envia a UNA cuenta, la que se elige.
      if (c.noDisponible || c.esAgencia) continue;
      mapa.set(c.organizacionId, [...(mapa.get(c.organizacionId) ?? []), c]);
    }
    return [...mapa.values()].filter((g) => g.length >= 2 && g.some((c) => !seleccion.has(c.id)));
  }, [candidatos, seleccion]);

  return (
    <div className="space-y-3">
      <CampoFormulario etiqueta={unico ? 'Buscar a la persona' : '¿A quién?'} ayuda="Escribe un nombre, un área o una agencia.">
        {(p) => (
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4.5 -translate-y-1/2 text-tinta-suave" />
            <Campo
              {...p}
              type="search"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.preventDefault();
              }}
              placeholder="Nombre, área o agencia…"
              autoComplete="off"
              className="pl-10"
              data-autofocus=""
            />
          </div>
        )}
      </CampoFormulario>

      {!unico && onAgregarGrupo && grupos.length > 0 && q.trim() === '' ? (
        <div className="flex flex-wrap gap-2" aria-label="Atajos por equipo">
          {grupos.map((g) => (
            <Boton key={g[0]!.organizacionId} variante="secundario" tamano="sm" onClick={() => onAgregarGrupo(g)}>
              <Users aria-hidden className="size-4" />
              Agregar a todos de {g[0]!.organizacion} ({g.length})
            </Boton>
          ))}
        </div>
      ) : null}

      <div
        role="group"
        aria-label="Personas a las que puedes enviar"
        className="max-h-56 overflow-y-auto rounded-lg border border-borde-suave bg-superficie p-1"
      >
        {visibles.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-tinta-suave">
            {candidatos.length === 0
              ? 'No hay a quién enviarla desde tu cuenta. Pide ayuda a un administrador.'
              : `No encontramos a «${q}». Revisa cómo lo escribiste o prueba con una parte del nombre.`}
          </p>
        ) : (
          <div className="space-y-1">
            {bloques.map((b) => (
              <section key={b.clave} aria-labelledby={`bloque-destino-${b.clave}`}>
                <h3 id={`bloque-destino-${b.clave}`} className="px-3 pb-0.5 pt-2 text-xs font-bold uppercase tracking-wide text-tinta-suave">
                  {b.titulo}
                </h3>
                <ul>
                  {b.lista.map((c) => {
                    const marcado = seleccion.has(c.id);
                    return (
                      <li key={c.id}>
                        <Casilla
                          checked={marcado}
                          disabled={!!c.noDisponible && !marcado}
                          onChange={() => onAlternar(c)}
                          aria-label={`${c.nombre}, ${c.organizacion}`}
                          etiqueta={
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <Persona
                                nombre={c.nombre}
                                organizacion={c.organizacion}
                                detalle={c.area ? (c.encargado ? `${c.area} · encargado: ${c.encargado}` : c.area) : undefined}
                                tamano="sm"
                              />
                              {c.yaTiene ? <Insignia variante="azul">Ya la tiene pendiente</Insignia> : null}
                            </span>
                          }
                          descripcion={c.noDisponible ?? undefined}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Dialogo "Enviar a" -------------------------------------------------------------------------------------

export interface PropsDialogoEnviarA {
  /** Una ficha (envio normal) o varias (lote desde el listado, hasta 25). */
  referenciaIds: string[];
  abierto: boolean;
  onCerrar: () => void;
  /** Se llama tras un envio exitoso (el listado limpia su seleccion). */
  onEnviado?: (r: ResultadoEnviarA) => void;
  /** Partes que ya vienen marcadas (p. ej. «Dejar pendiente a…» desde una seccion). */
  seccionesIniciales?: Seccion[];
}

export function DialogoEnviarA(props: PropsDialogoEnviarA) {
  // El contenido se monta solo mientras esta abierto: cada apertura empieza limpia.
  if (!props.abierto) return null;
  return <ContenidoEnviarA {...props} />;
}

function ContenidoEnviarA({ referenciaIds, abierto, onCerrar, onEnviado, seccionesIniciales }: PropsDialogoEnviarA) {
  const router = useRouter();
  const [actualizando, iniciarActualizacion] = useTransition();
  const lote = referenciaIds.length > 1;
  const baseId = referenciaIds[0] ?? '';
  const candidatosLectura = useLectura<CandidatoDestino[]>(baseId ? `/api/colaboracion/ficha/${baseId}/destinatarios` : null);
  const contextoLectura = useLectura<ContextoEnvio>(!lote && baseId ? `/api/colaboracion/ficha/${baseId}/contexto` : null);

  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Record<string, Pedido>>({});
  const [mensaje, setMensaje] = useState('');
  const [elegidas, setElegidas] = useState<Seccion[] | null>(null);
  const [fase, setFase] = useState<'editando' | 'enviando' | 'listo'>('editando');
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoEnviarA | null>(null);

  const candidatos = candidatosLectura.estado.tipo === 'ok' ? candidatosLectura.estado.data : [];
  const contexto = contextoLectura.estado.tipo === 'ok' ? contextoLectura.estado.data : null;
  const seleccionados = candidatos.filter((c) => sel[c.id]);
  const idsSel = useMemo(() => new Set(Object.keys(sel)), [sel]);
  // Partes del area: lo elegido; si no, lo que pidio quien abrio el dialogo; si no, lo que sigue en amarillo; si no, todo.
  const partesEfectivas: Seccion[] =
    elegidas ??
    (seccionesIniciales?.length
      ? seccionesIniciales
      : contexto?.seccionesPendientes.length
        ? contexto.seccionesPendientes
        : [...SECCIONES]);
  const ofrecePartes = !lote && seleccionados.some((c) => c.rol !== 'aduana');
  // Con las tres secciones del area completas lo que sigue es clasificar: los agentes aduaneros van primero. Si falta algo,
  // lo siguiente es completar: primero las areas. (Un lote no tiene una sola ficha que mirar: areas primero.)
  const agentesPrimero = contexto !== null && contexto.seccionesPendientes.length === 0;

  function alternar(c: CandidatoDestino) {
    setSel((s) => {
      const copia = { ...s };
      if (copia[c.id]) delete copia[c.id];
      else copia[c.id] = c.pedidoPorDefecto;
      return copia;
    });
  }

  function agregarGrupo(lista: CandidatoDestino[]) {
    setSel((s) => {
      const copia = { ...s };
      for (const c of lista) if (!copia[c.id]) copia[c.id] = c.pedidoPorDefecto;
      return copia;
    });
  }

  async function enviar() {
    if (seleccionados.length === 0) return;
    setFase('enviando');
    setError(null);
    const destinatarios = seleccionados.map((c) => ({
      usuarioId: c.id,
      pedido: sel[c.id],
      ...(ofrecePartes && c.rol !== 'aduana' ? { secciones: partesEfectivas } : {}),
    }));
    const texto = mensaje.trim();
    const r = lote
      ? await enviarALoteAccion({
          referenciaIds,
          destinatarios,
          ...(texto ? { mensaje: texto } : {}),
        })
      : await enviarAAccion({
          referenciaId: baseId,
          destinatarios,
          ...(texto ? { mensaje: texto } : {}),
        });
    if (!r.ok) {
      setFase('editando');
      setError(r.mensaje);
      return;
    }
    setResultado(r.data);
    setFase('listo');
    for (const id of referenciaIds) avisarCambioDeFicha(id);
    iniciarActualizacion(() => router.refresh());
    onEnviado?.(r.data);
  }

  const cargandoDatos = candidatosLectura.estado.tipo === 'cargando';
  const titulo =
    fase === 'listo'
      ? resultado && sinCambios(resultado)
        ? 'Sin cambios'
        : 'Enviado'
      : lote
        ? `Enviar ${referenciaIds.length} referencias a…`
        : contexto
          ? `Enviar ${contexto.codigo} a…`
          : 'Enviar a…';

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo={titulo}
      tamano="md"
      bloquear={fase === 'enviando'}
      descripcion={fase === 'listo' ? undefined : 'Le queda como pendiente en la plataforma, con aviso en la campana.'}
      pie={
        fase === 'listo' ? (
          <>
            {actualizando ? (
              <span role="status" className="mr-auto self-center text-sm text-tinta-suave">
                Actualizando la ficha…
              </span>
            ) : null}
            {!lote && resultado ? (
              <Boton
                variante="secundario"
                onClick={() => {
                  onCerrar();
                  abrirActividad({ referenciaId: baseId, pestana: 'envios' });
                }}
              >
                Ver seguimiento
              </Boton>
            ) : null}
            <Boton onClick={onCerrar} data-autofocus="">
              Listo
            </Boton>
          </>
        ) : (
          <>
            <Boton variante="secundario" onClick={onCerrar} disabled={fase === 'enviando'}>
              Cancelar
            </Boton>
            <Boton onClick={() => void enviar()} cargando={fase === 'enviando'} disabled={seleccionados.length === 0}>
              <Send aria-hidden className="size-4" />
              {fase === 'enviando' ? 'Enviando…' : textoEnviar(seleccionados, referenciaIds.length)}
            </Boton>
          </>
        )
      }
    >
      {fase === 'listo' && resultado ? (
        <ResultadoEnvio resultado={resultado} lote={lote} fichas={referenciaIds.length} />
      ) : (
        <div className="space-y-5">
          {error ? (
            <Aviso
              tipo="error"
              titulo="No pudimos enviar el aviso"
              accion={
                <Boton variante="secundario" tamano="sm" onClick={() => void enviar()} disabled={seleccionados.length === 0}>
                  Reintentar
                </Boton>
              }
            >
              {error} La referencia sigue guardada.
            </Aviso>
          ) : null}

          {contexto && contexto.faltanDelArea > 0 ? (
            <Aviso>
              Faltan {plural(contexto.faltanDelArea, 'campo', 'campos')} del área. Puedes enviarla igual; la otra persona ve qué falta.
            </Aviso>
          ) : null}
          {contexto?.agenciaActual ? <Aviso tipo="aviso">Esta referencia ya está con {contexto.agenciaActual}.</Aviso> : null}
          {lote ? (
            <Aviso>
              Vas a enviar {referenciaIds.length} referencias a las mismas personas. A cada una le quedan como pendientes en la plataforma.
            </Aviso>
          ) : null}

          {cargandoDatos ? (
            <EsqueletoZona etiqueta="Cargando personas…" className="space-y-3">
              <Esqueleto className="h-11" />
              <Esqueleto className="h-40" />
            </EsqueletoZona>
          ) : candidatosLectura.estado.tipo === 'error' ? (
            <Aviso
              tipo="error"
              titulo="No pudimos cargar a las personas"
              accion={
                <Boton variante="secundario" tamano="sm" onClick={candidatosLectura.recargar}>
                  Reintentar
                </Boton>
              }
            >
              {candidatosLectura.estado.mensaje}
            </Aviso>
          ) : (
            <SelectorPersonas
              candidatos={candidatos}
              seleccion={idsSel}
              q={q}
              onQ={setQ}
              onAlternar={alternar}
              onAgregarGrupo={agregarGrupo}
              agentesPrimero={agentesPrimero}
            />
          )}

          {seleccionados.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold text-tinta">¿Qué le pides?</legend>
              <ul className="space-y-2">
                {seleccionados.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-borde-suave bg-superficie-2 px-3 py-2"
                  >
                    <Avatar nombre={c.nombre} tamano="sm" />
                    <span className="min-w-0 flex-1 basis-32 truncate text-sm font-semibold text-tinta">
                      {nombreVisible(c.nombre)}
                      {c.esAgencia ? <span className="font-normal text-tinta-suave"> · {c.organizacion}</span> : null}
                    </span>
                    <label className="sr-solo" htmlFor={`pedido-${c.id}`}>
                      Qué le pides a {nombreVisible(c.nombre)}
                    </label>
                    <Seleccion
                      id={`pedido-${c.id}`}
                      value={sel[c.id]}
                      onChange={(e) =>
                        setSel((s) => ({
                          ...s,
                          [c.id]: e.target.value as Pedido,
                        }))
                      }
                      className="min-h-10 w-auto min-w-[10.5rem] max-w-[14rem] py-1.5 pr-9 text-sm"
                    >
                      {c.pedidosPermitidos.map((p) => (
                        <option key={p} value={p}>
                          {ETIQUETA_PEDIDO[p]}
                        </option>
                      ))}
                    </Seleccion>
                    <Boton
                      variante="terciario"
                      tamano="icono-sm"
                      aria-label={`Quitar a ${nombreVisible(c.nombre)}`}
                      onClick={() => alternar(c)}
                    >
                      <X aria-hidden className="size-4" />
                    </Boton>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          {ofrecePartes ? (
            <fieldset className="space-y-1" data-testid="partes-pendientes">
              <legend className="text-sm font-semibold text-tinta">¿Qué parte le dejas pendiente?</legend>
              <p className="text-sm text-tinta-suave">Marca las partes que le tocan; el resto queda para otra persona.</p>
              <div className="flex flex-wrap gap-x-2">
                {SECCIONES.map((s) => (
                  <Casilla
                    key={s}
                    checked={partesEfectivas.includes(s)}
                    onChange={() => {
                      const ahora = partesEfectivas.includes(s) ? partesEfectivas.filter((x) => x !== s) : [...partesEfectivas, s];
                      setElegidas(ahora.length === 0 ? partesEfectivas : ahora);
                    }}
                    etiqueta={ETIQUETA_SECCION[s]}
                    descripcion={contexto?.seccionesPendientes.includes(s) ? 'Pendiente' : 'Completa'}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}

          <CampoFormulario
            etiqueta="Mensaje"
            opcional
            ayuda="Lo ve en la plataforma al abrir la referencia."
            acciones={
              <span className="text-xs tabular-nums text-tinta-suave" aria-live="off">
                {mensaje.length}/{MAX_MENSAJE}
              </span>
            }
          >
            {(p) => (
              <AreaTexto
                {...p}
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value.slice(0, MAX_MENSAJE))}
                rows={2}
                placeholder="Falta la partida; el resto está listo."
                maxLength={MAX_MENSAJE}
              />
            )}
          </CampoFormulario>

          <VistaPreviaAviso
            contexto={contexto}
            destino={seleccionados[0] ?? null}
            pedido={seleccionados[0] ? sel[seleccionados[0].id] : undefined}
            lote={lote}
            fichas={referenciaIds.length}
            partes={ofrecePartes ? partesEfectivas : []}
          />
        </div>
      )}
    </Dialogo>
  );
}

/** Lo que le va a llegar a la persona, tal cual. */
function VistaPreviaAviso({
  contexto,
  destino,
  pedido,
  lote,
  fichas,
  partes,
}: {
  contexto: ContextoEnvio | null;
  destino: CandidatoDestino | null;
  pedido: Pedido | undefined;
  lote: boolean;
  fichas: number;
  partes: Seccion[];
}) {
  const quien = contexto?.quien ?? 'Tu nombre';
  const nombre = destino ? primerNombre(destino.nombre) : 'la persona';
  const verbo = VERBO_PEDIDO[pedido ?? destino?.pedidoPorDefecto ?? 'completar'];
  return (
    <section aria-label="Vista previa de lo que recibirá" className="rounded-xl border border-borde-suave bg-superficie-2 p-3.5">
      <h3 className="mb-2 text-sm font-semibold text-tinta">Lo que recibirá {destino ? nombre : 'la persona'}</h3>
      <ul className="space-y-2.5 text-sm">
        <li className="flex gap-2.5">
          <Bell aria-hidden className="mt-0.5 size-4 shrink-0 text-azul-700" />
          <span>
            <span className="font-semibold text-tinta">En la plataforma: </span>
            <span className="text-tinta">
              {lote
                ? `${quien} te envió ${plural(fichas, 'referencia', 'referencias')}`
                : `${quien} te envió ${contexto?.codigo ?? 'una referencia'} para ${verbo}${partes.length > 0 && partes.length < SECCIONES.length ? `: ${listaHumana(SECCIONES.filter((s) => partes.includes(s)).map((s) => ETIQUETA_SECCION[s]))}` : ''}`}
            </span>
          </span>
        </li>
      </ul>
    </section>
  );
}

// ---- Resultado ------------------------------------------------------------------------------------------------

/** Nadie recibio nada nuevo: todos ya lo tenian pendiente con lo mismo. */
function sinCambios(r: ResultadoEnviarA): boolean {
  return r.destinatarios.every((d) => d.creadas + d.actualizadas === 0);
}

function ResultadoEnvio({ resultado, lote, fichas }: { resultado: ResultadoEnviarA; lote: boolean; fichas: number }) {
  const total = resultado.destinatarios.length;
  const ya = resultado.yaTenianPendiente.length;
  const nombres = resultado.destinatarios.map((d) => primerNombre(d.nombre));
  // Un reenvio identico no crea ni cambia nada: el titular no puede decir «Enviado».
  const nada = sinCambios(resultado);
  const yaLa = lote ? 'ya las tenía pendientes' : 'ya la tenía pendiente';
  const resumen = nada
    ? total === 1
      ? `${nombres[0]} ${yaLa}`
      : lote
        ? 'Ya las tenían pendientes'
        : 'Ya la tenían pendiente'
    : total === 1
      ? `Enviado a ${nombres[0]}`
      : `Enviado a ${total}${ya > 0 ? ` · ya tenían pendiente: ${ya}` : ''}`;

  return (
    <div className="space-y-4" data-testid="resultado-envio">
      <p className="flex items-center gap-2 text-base font-semibold text-tinta" role="status">
        {nada ? <Info aria-hidden className="size-5 text-tinta-suave" /> : <CircleCheck aria-hidden className="size-5 text-azul-700" />}
        {resumen}
        {lote ? <span className="font-normal text-tinta-suave"> · {plural(fichas, 'referencia', 'referencias')}</span> : null}
      </p>
      <ul className="divide-y divide-borde-suave rounded-xl border border-borde-suave">
        {resultado.destinatarios.map((d) => (
          <FilaResultado key={d.usuarioId} d={d} lote={lote} />
        ))}
      </ul>
    </div>
  );
}

function FilaResultado({ d, lote }: { d: ResumenDestinatario; lote: boolean }) {
  let linea: string;
  if (d.creadas > 0 && d.actualizadas === 0)
    linea = lote ? `Ya tiene ${plural(d.creadas, 'pendiente', 'pendientes')} en su bandeja.` : 'Ya tiene el pendiente en su bandeja.';
  else if (d.actualizadas > 0) linea = 'Ya la tenía pendiente; actualizamos lo que le pides y le avisamos.';
  else linea = 'Ya la tenía pendiente con lo mismo, así que no le avisamos otra vez.';

  return (
    <li className="space-y-1.5 px-3.5 py-3">
      <Persona nombre={d.nombre} organizacion={d.organizacion} tamano="sm" />
      <p className="pl-9 text-sm text-tinta">{linea}</p>
    </li>
  );
}

// ---- Boton "Enviar a…" + "Listo por mi parte" -----------------------------------------------------------------

export function BotonEnviarACliente({ referenciaId }: { referenciaId: string }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [abierto, setAbierto] = useState(false);
  const [seccionesIni, setSeccionesIni] = useState<Seccion[] | undefined>(undefined);
  const [marcando, setMarcando] = useState(false);
  /** Asignacion ya marcada como lista: el boton se oculta en el acto, sin esperar la recarga del contexto. */
  const [marcadaId, setMarcadaId] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const contexto = useLectura<ContextoEnvio>(`/api/colaboracion/ficha/${referenciaId}/contexto`, { referenciaId, intervaloMs: SONDEO.contexto });
  const datos = contexto.estado.tipo === 'ok' ? contexto.estado.data : null;

  // Escucha el pedido de abrir el dialogo desde otros lados (p. ej. un atajo de la ficha). La ficha monta este boton
  // en varios sitios (uno queda oculto segun el ancho): solo responde el primero visible, o se apilarian dialogos.
  useEffect(() => {
    const alPedir = (e: Event) => {
      const d = (e as CustomEvent<{ referenciaId?: string; secciones?: Seccion[]; atendido?: boolean }>).detail;
      if (d?.referenciaId !== referenciaId || d.atendido) return;
      if (!raiz.current || raiz.current.getClientRects().length === 0) return;
      d.atendido = true;
      setSeccionesIni(d.secciones);
      setAbierto(true);
    };
    window.addEventListener('dm:abrir-enviar-a', alPedir);
    return () => window.removeEventListener('dm:abrir-enviar-a', alPedir);
  }, [referenciaId]);

  // Quien solo puede leer (o una ficha archivada) no ve el boton.
  if (datos && !datos.puedeEnviar) return null;

  async function listo() {
    setMarcando(true);
    const r = await marcarListoAccion({ referenciaId });
    setMarcando(false);
    if (r.ok) {
      setMarcadaId(datos?.miAsignacion?.id ?? null);
      avisar({
        tipo: 'exito',
        titulo: r.data.yaEstaba ? 'Ya habías marcado tu parte como lista' : 'Listo. Avisamos a quien te la envió',
      });
      avisarCambioDeFicha(referenciaId);
      contexto.recargar();
      router.refresh();
    } else {
      avisar({
        tipo: 'error',
        titulo: 'No pudimos marcar tu parte como lista',
        descripcion: r.mensaje,
        accion: { etiqueta: 'Reintentar', onClick: () => void listo() },
      });
    }
  }

  return (
    <div ref={raiz} className="flex flex-wrap items-center gap-3 max-sm:w-full max-sm:[&>*]:flex-1" data-testid="acciones-colaboracion">
      {datos?.miAsignacion && datos.miAsignacion.id !== marcadaId ? (
        <Boton variante="secundario" onClick={() => void listo()} cargando={marcando}>
          {marcando ? 'Guardando…' : 'Listo por mi parte'}
        </Boton>
      ) : null}
      <Boton onClick={() => setAbierto(true)}>
        <Send aria-hidden className="size-4" />
        Enviar a…
      </Boton>
      <DialogoEnviarA
        referenciaIds={[referenciaId]}
        abierto={abierto}
        {...(seccionesIni ? { seccionesIniciales: seccionesIni } : {})}
        onCerrar={() => {
          setAbierto(false);
          setSeccionesIni(undefined);
          contexto.recargar();
        }}
      />
    </div>
  );
}
