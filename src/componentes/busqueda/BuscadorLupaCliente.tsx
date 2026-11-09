'use client';

import { ArrowRight, CornerDownLeft, LoaderCircle, Plus, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Estado } from '@/componentes/Estado';
import { Boton } from '@/componentes/ui/button';
import { mostrar, ocultar, posicionar } from '@/componentes/ui/flotante';
import { Tecla } from '@/componentes/ui/insignia';
import { ETIQUETA_TIPO } from '@/dominio/campos';
import { cn } from '@/lib/utils';
import type { RespuestaBusqueda, ResultadoBusqueda } from '@/server/acciones/buscar';

const ESPERA_MS = 150;
const MIN = 2;

type Opcion =
  | { tipo: 'resultado'; r: ResultadoBusqueda }
  | { tipo: 'todos' }
  | { tipo: 'crear' };

/** Resalta (sin distinguir mayusculas) lo que se escribio dentro de un texto. */
function Resaltado({ texto, q }: { texto: string; q: string }): ReactNode {
  const tokens = q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return texto;
  const minus = texto.toLowerCase();
  const marcas: Array<[number, number]> = [];
  for (const t of tokens) {
    const i = minus.indexOf(t.toLowerCase());
    if (i >= 0) marcas.push([i, i + t.length]);
  }
  if (marcas.length === 0) return texto;
  marcas.sort((a, b) => a[0] - b[0]);
  const piezas: ReactNode[] = [];
  let cursor = 0;
  for (const [a, b] of marcas) {
    if (a < cursor) continue;
    if (a > cursor) piezas.push(texto.slice(cursor, a));
    piezas.push(
      <mark key={a} className="rounded-sm bg-azul-100 px-0.5 font-bold text-azul-900">
        {texto.slice(a, b)}
      </mark>,
    );
    cursor = b;
  }
  if (cursor < texto.length) piezas.push(texto.slice(cursor));
  return piezas;
}

/**
 * Buscador con lupa (SPEC 10.3, F5): escribes la referencia y te lleva a su ficha. Atajos `Ctrl+K` (siempre) y
 * `/` (solo con el foco fuera de un campo editable y si la persona no lo apago en su cuenta, WCAG 2.1.4).
 * Sugerencias desde 2 caracteres con espera de 150 ms, maximo 8; flechas, Enter y Esc. Enter con UNA coincidencia
 * exacta (codigo o nombre) abre la ficha; si no, abre el listado ya filtrado.
 */
export function BuscadorLupaCliente({ atajos, puedeCrear }: { atajos: boolean; puedeCrear: boolean }) {
  const router = useRouter();
  const idLista = `busq-${useId().replace(/:/g, '')}`;
  const [q, setQ] = useState('');
  const [respuesta, setRespuesta] = useState<RespuestaBusqueda | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1);
  const [movil, setMovil] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const entradaEscritorio = useRef<HTMLInputElement>(null);
  const entradaMovil = useRef<HTMLInputElement>(null);
  const control = useRef<AbortController | null>(null);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const limpio = q.trim();

  const consultar = useCallback(async (texto: string): Promise<RespuestaBusqueda | null> => {
    control.current?.abort();
    const ac = new AbortController();
    control.current = ac;
    setCargando(true);
    setError(null);
    try {
      const r = await fetch(`/api/buscar?q=${encodeURIComponent(texto)}`, { signal: ac.signal, headers: { accept: 'application/json' } });
      const cuerpo = (await r.json()) as RespuestaBusqueda | { ok: false; mensaje: string; detalle?: { sesionVencida?: boolean } };
      if (ac.signal.aborted) return null;
      if (!r.ok || 'ok' in cuerpo) {
        const c = cuerpo as { mensaje?: string; detalle?: { sesionVencida?: boolean } };
        setError(c.detalle?.sesionVencida ? 'Tu sesión venció. Entra de nuevo y vuelve a buscar.' : (c.mensaje ?? 'No pudimos buscar. Intenta de nuevo.'));
        setRespuesta(null);
        return null;
      }
      setRespuesta(cuerpo as RespuestaBusqueda);
      return cuerpo as RespuestaBusqueda;
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') return null;
      setError('No pudimos buscar. Revisa tu conexión y vuelve a intentar.');
      setRespuesta(null);
      return null;
    } finally {
      if (control.current === ac) setCargando(false);
    }
  }, []);

  // Busca mientras escribe (con espera).
  useEffect(() => {
    if (espera.current) clearTimeout(espera.current);
    if ([...limpio].length < MIN) return;
    espera.current = setTimeout(() => void consultar(limpio), ESPERA_MS);
    return () => {
      if (espera.current) clearTimeout(espera.current);
    };
  }, [limpio, consultar]);

  const resultados = respuesta && respuesta.q.trim() === limpio ? respuesta : null;
  const opciones: Opcion[] = [];
  if (resultados) {
    for (const r of resultados.resultados) opciones.push({ tipo: 'resultado', r });
    if (resultados.total >= 2) opciones.push({ tipo: 'todos' });
    if (resultados.resultados.length === 0 && puedeCrear) opciones.push({ tipo: 'crear' });
  }
  const panelVisible = abierto && [...limpio].length >= MIN;

  // La lista flotante de escritorio vive en la capa superior del navegador (no la recorta la barra).
  useEffect(() => {
    const el = lista.current;
    if (!el) return;
    if (panelVisible && !movil && caja.current) {
      mostrar(el);
      posicionar(caja.current, el, { igualarAncho: true, separacion: 6 });
      el.dataset.listo = '';
    } else {
      ocultar(el);
      delete el.dataset.listo;
    }
  }, [panelVisible, movil, resultados, cargando, error]);

  useEffect(() => {
    if (!panelVisible || movil) return;
    const recolocar = () => {
      if (lista.current && caja.current) posicionar(caja.current, lista.current, { igualarAncho: true, separacion: 6 });
    };
    window.addEventListener('resize', recolocar);
    return () => window.removeEventListener('resize', recolocar);
  }, [panelVisible, movil]);

  // Atajos globales.
  useEffect(() => {
    const alTeclear = (e: globalThis.KeyboardEvent) => {
      const destino = e.target as HTMLElement | null;
      const editable = !!destino && (destino.isContentEditable || /^(input|textarea|select)$/i.test(destino.tagName));
      const abrir = () => {
        e.preventDefault();
        if (window.matchMedia('(max-width: 639.98px)').matches) setMovil(true);
        else entradaEscritorio.current?.focus();
        setAbierto(true);
      };
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') abrir();
      else if (atajos && e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !editable) abrir();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [atajos]);

  useEffect(() => {
    if (movil) requestAnimationFrame(() => entradaMovil.current?.focus());
  }, [movil]);

  function cerrar(vaciar = false) {
    setAbierto(false);
    setMovil(false);
    setActivo(-1);
    if (vaciar) setQ('');
  }

  function ir(destino: string) {
    cerrar();
    // Ya estas ahi: no se navega (evita recargar la misma pantalla y apilar navegaciones).
    if (`${window.location.pathname}${window.location.search}` === destino) return;
    router.push(destino);
  }

  const urlListado = (texto: string) => `/referencias?q=${encodeURIComponent(texto)}`;
  const urlCrear = (texto: string) => `/referencias/nueva?codigo=${encodeURIComponent(texto)}`;

  function abrirOpcion(o: Opcion) {
    if (o.tipo === 'resultado') ir(`/referencias/${o.r.id}`);
    else if (o.tipo === 'todos') ir(urlListado(limpio));
    else ir(urlCrear(limpio));
  }

  async function enviar() {
    if (limpio === '') return;
    if (activo >= 0 && opciones[activo]) return abrirOpcion(opciones[activo]);
    if ([...limpio].length < MIN) return ir(urlListado(limpio));
    // Si la respuesta aun no llego para lo escrito, se pide ya.
    const r = resultados ?? (await consultar(limpio));
    if (!r) return;
    if (r.exactaId) return ir(`/referencias/${r.exactaId}`);
    ir(urlListado(limpio));
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
      setActivo((a) => (opciones.length === 0 ? -1 : Math.min(a + 1, opciones.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivo((a) => (a <= 0 ? -1 : a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void enviar();
    } else if (e.key === 'Escape') {
      if (abierto || movil || q !== '') {
        e.preventDefault();
        if (q !== '' && !abierto) setQ('');
        cerrar();
      }
    } else if (e.key === 'Home' && opciones.length > 0 && panelVisible) {
      e.preventDefault();
      setActivo(0);
    } else if (e.key === 'End' && opciones.length > 0 && panelVisible) {
      e.preventDefault();
      setActivo(opciones.length - 1);
    }
  }

  useEffect(() => {
    if (activo >= 0) document.getElementById(`${idLista}-op-${activo}`)?.scrollIntoView({ block: 'nearest' });
  }, [activo, idLista]);

  const idActiva = panelVisible && activo >= 0 ? `${idLista}-op-${activo}` : undefined;

  const campo = (ref: React.RefObject<HTMLInputElement | null>, enMovil: boolean) => (
    <div className="relative w-full">
      <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-[1.125rem] -translate-y-1/2 text-azul-700" />
      <input
        ref={ref}
        type="search"
        role="combobox"
        aria-label="Buscar referencia"
        aria-expanded={panelVisible}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={idActiva}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder="Buscar por código, nombre, marca…"
        value={q}
        maxLength={120}
        onChange={(e) => {
          const nuevo = e.target.value;
          setQ(nuevo);
          setAbierto(true);
          setActivo(-1);
          if ([...nuevo.trim()].length < MIN) {
            control.current?.abort();
            setRespuesta(null);
            setCargando(false);
            setError(null);
          }
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          if (!enMovil) setAbierto(false);
        }}
        onKeyDown={alTeclear}
        className="h-10 w-full rounded-lg border border-transparent bg-white pl-10 pr-20 text-base text-tinta shadow-[inset_0_1px_2px_rgb(7_31_74/0.12)] outline-none transition-[box-shadow] duration-150 ease-salida placeholder:text-tinta-suave/80 focus-visible:shadow-[0_0_0_3px_var(--azul-300)] [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute inset-y-0 right-1.5 flex items-center gap-1">
        {cargando ? <LoaderCircle aria-hidden className="mr-1 size-4 animate-girar text-tinta-suave" /> : null}
        {q !== '' ? (
          <button
            type="button"
            aria-label="Borrar lo escrito"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQ('');
              control.current?.abort();
              setRespuesta(null);
              setCargando(false);
              setError(null);
              ref.current?.focus();
            }}
            className="inline-flex size-8 items-center justify-center rounded text-tinta-suave hover:bg-azul-50 hover:text-tinta"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : atajos ? (
          <span aria-hidden className="mr-1 flex items-center gap-1 max-lg:hidden">
            <Tecla>/</Tecla>
          </span>
        ) : null}
      </span>
    </div>
  );

  const contenido = (
    <div
      id={idLista}
      role="listbox"
      aria-label="Referencias encontradas"
      className={cn(
        'max-h-[min(26rem,70dvh)] overflow-auto rounded-xl border border-borde-suave bg-superficie py-1.5 text-tinta shadow-flotante',
        movil && 'max-h-none rounded-lg shadow-none',
      )}
    >
      {error ? (
        <div role="alert" className="space-y-2 px-4 py-3 text-sm">
          <p className="font-medium text-error">{error}</p>
          <Boton variante="secundario" tamano="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => void consultar(limpio)}>
            Reintentar
          </Boton>
        </div>
      ) : !resultados ? (
        <p role="presentation" className="px-4 py-3 text-sm text-tinta-suave">
          Buscando…
        </p>
      ) : (
        <>
          {resultados.resultados.length > 0 ? (
            <p role="presentation" className="px-4 pb-1 pt-1.5 text-xs font-semibold text-tinta-suave">
              {resultados.total === 1 ? '1 referencia' : `${resultados.total} referencias`}
            </p>
          ) : null}
          {opciones.map((o, i) => {
            const marcada = i === activo;
            const comun = {
              id: `${idLista}-op-${i}`,
              role: 'option' as const,
              'aria-selected': marcada,
              onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
              onMouseMove: () => setActivo(i),
              onClick: () => abrirOpcion(o),
            };
            if (o.tipo === 'resultado') {
              const r = o.r;
              return (
                <div key={r.id} {...comun} className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2', marcada && 'bg-azul-50')}>
                  <Estado color={r.color} texto={r.color === 'verde' ? 'Clasificada' : 'Pendiente'} tamano="sm" sinRol className="shrink-0 max-sm:hidden" />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-mono text-[0.9375rem] font-bold text-tinta">
                      <Resaltado texto={r.codigo} q={limpio} />
                    </span>
                    <span className="block text-sm text-tinta-suave sm:truncate">
                      <Resaltado texto={r.nombreProducto} q={limpio} /> · {ETIQUETA_TIPO[r.tipoProducto]}
                      <span className="sm:hidden"> · {r.color === 'verde' ? 'Clasificada' : 'Pendiente'}</span>
                    </span>
                  </span>
                  {marcada ? <CornerDownLeft aria-hidden className="size-4 shrink-0 text-tinta-suave" /> : null}
                </div>
              );
            }
            if (o.tipo === 'todos') {
              return (
                <div key="todos" {...comun} className={cn('flex min-h-12 cursor-pointer items-center justify-between gap-3 border-t border-borde-suave px-4 py-2 text-sm font-semibold text-azul-700', marcada && 'bg-azul-50')}>
                  <span>Ver los {resultados.total} resultados</span>
                  <ArrowRight aria-hidden className="size-4" />
                </div>
              );
            }
            return (
              <div key="crear" {...comun} className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 text-sm font-semibold text-azul-700', marcada && 'bg-azul-50')}>
                <Plus aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 truncate">Crear referencia con el código «{limpio}»</span>
              </div>
            );
          })}
          {resultados.resultados.length === 0 ? (
            <div role="presentation" className="px-4 py-3 text-sm">
              <p className="font-medium text-tinta">No encontramos «{limpio}».</p>
              <p className="mt-0.5 text-tinta-suave">
                {puedeCrear
                  ? 'Revisa cómo la escribiste o prueba con una parte. Si es nueva, puedes crearla.'
                  : 'Revisa cómo la escribiste o prueba con una parte. Si no aparece, pregúntale a quien la solicitó o a un administrador.'}
              </p>
            </div>
          ) : null}
        </>
      )}
      <p role="presentation" className="hidden border-t border-borde-suave px-4 pb-1 pt-2 text-xs text-tinta-suave lg:block">
        <Tecla>↑</Tecla> <Tecla>↓</Tecla> para moverte · <Tecla>Enter</Tecla> para abrir · <Tecla>Esc</Tecla> para cerrar
      </p>
    </div>
  );

  return (
    <>
      {/* Escritorio y tableta: campo claro en la barra. */}
      <div ref={caja} role="search" aria-label="Buscador de referencias" className="w-full max-w-xl max-sm:hidden">
        {campo(entradaEscritorio, false)}
      </div>
      <div ref={lista} popover="manual" className="flotante" style={{ minWidth: '22rem' }}>
        {!movil ? contenido : null}
      </div>

      {/* Movil: icono que abre una hoja con el campo. */}
      <Boton variante="fantasma-claro" tamano="icono" aria-label="Buscar referencia" className="sm:hidden" onClick={() => { setMovil(true); setAbierto(true); }}>
        <Search aria-hidden className="size-5" />
      </Boton>
      {movil ? (
        <div role="dialog" aria-modal="true" aria-label="Buscar referencia" className="superficie-oscura fixed inset-0 z-40 flex flex-col gap-3 bg-azul-900 p-3 sm:hidden">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1" role="search" aria-label="Buscador de referencias">
              {campo(entradaMovil, true)}
            </div>
            <Boton variante="fantasma-claro" onClick={() => cerrar()}>
              Cerrar
            </Boton>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">{[...limpio].length >= MIN ? contenido : <p className="px-1 text-sm text-azul-200">Escribe al menos 2 letras del código o del nombre.</p>}</div>
        </div>
      ) : null}
      <span className="sr-solo" role="status" aria-live="polite">
        {panelVisible && resultados ? (resultados.total === 0 ? 'Sin resultados' : `${resultados.total} resultados`) : ''}
      </span>
    </>
  );
}
