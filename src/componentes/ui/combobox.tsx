'use client';

import { Check, ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { normalizarTexto } from '@/dominio/normalizacion';
import { cn } from '@/lib/utils';
import { mostrar, ocultar, posicionar } from './flotante';
import { baseControl } from './input';

/**
 * Select con busqueda (patron ARIA 1.2 «combobox con listbox»): para listas largas (Pais de origen,
 * Unidad de medida). Escribes para filtrar (sin distinguir mayusculas ni tildes), flechas para moverte,
 * Enter elige, Esc cierra, el foco nunca sale del campo. Para <= 8 opciones fijas usa `Seleccion`.
 *
 * Pensado para formularios: `nombre` escribe un `<input type="hidden">` con el VALOR elegido, asi
 * funciona con Server Actions sin JavaScript extra. Controlado (`valor`) o no (`valorInicial`).
 *
 *   <Combobox id="pais" nombre="pais" opciones={paises.map(p => ({ valor: p.codigo, etiqueta: p.nombre }))}
 *             valorInicial="CO" onCambio={(v) => …} />
 */
export interface OpcionCombobox {
  valor: string;
  etiqueta: string;
  /** Texto secundario (codigo ISO, descripcion). Tambien se busca. */
  detalle?: string;
}

export function Combobox({
  id: idExterno,
  nombre,
  opciones,
  valor,
  valorInicial = null,
  onCambio,
  placeholder = 'Escribe para buscar',
  textoVacio = 'No hay coincidencias. Prueba con otra parte del nombre.',
  deshabilitado = false,
  limpiable = true,
  className,
  ...aria
}: {
  id?: string;
  nombre?: string;
  opciones: readonly OpcionCombobox[];
  valor?: string | null;
  valorInicial?: string | null;
  onCambio?: (valor: string | null) => void;
  placeholder?: string;
  textoVacio?: string;
  deshabilitado?: boolean;
  limpiable?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}) {
  const generado = useId().replace(/:/g, '');
  const id = idExterno ?? `cb-${generado}`;
  const idLista = `${id}-lista`;
  const [interno, setInterno] = useState<string | null>(valorInicial);
  const esControlado = valor !== undefined;
  const actual = esControlado ? valor : interno;
  const elegida = useMemo(() => opciones.find((o) => o.valor === actual) ?? null, [opciones, actual]);

  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState<string | null>(null); // null = mostrar la etiqueta elegida
  const [activa, setActiva] = useState(0);
  const entrada = useRef<HTMLInputElement | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);
  const lista = useRef<HTMLDivElement | null>(null);

  const indice = useMemo(() => opciones.map((o) => normalizarTexto(`${o.etiqueta} ${o.detalle ?? ''}`)), [opciones]);
  const filtradas = useMemo(() => {
    const q = normalizarTexto(texto ?? '');
    if (!q || texto === null) return opciones;
    const idx = opciones.map((o, i) => ({ o, i }));
    // Primero las que EMPIEZAN por lo escrito, luego las que lo contienen.
    const empiezan = idx.filter(({ o }) => normalizarTexto(o.etiqueta).startsWith(q));
    const contienen = idx.filter(({ o, i }) => !normalizarTexto(o.etiqueta).startsWith(q) && indice[i]!.includes(q));
    return [...empiezan, ...contienen].map(({ o }) => o);
  }, [opciones, texto, indice]);

  const elegir = useCallback(
    (op: OpcionCombobox | null) => {
      if (!esControlado) setInterno(op?.valor ?? null);
      onCambio?.(op?.valor ?? null);
      setTexto(null);
      setAbierto(false);
    },
    [esControlado, onCambio],
  );

  // Abre/cierra la lista en la capa superior y la coloca bajo el campo.
  useEffect(() => {
    const el = lista.current;
    if (!el) return;
    if (abierto && caja.current) {
      mostrar(el);
      posicionar(caja.current, el, { igualarAncho: true, separacion: 4 });
      el.dataset.listo = '';
    } else {
      ocultar(el);
      delete el.dataset.listo;
    }
  }, [abierto, filtradas.length]);

  useEffect(() => {
    if (!abierto) return;
    const recolocar = () => {
      if (lista.current && caja.current) posicionar(caja.current, lista.current, { igualarAncho: true, separacion: 4 });
    };
    window.addEventListener('resize', recolocar);
    window.addEventListener('scroll', recolocar, true);
    return () => {
      window.removeEventListener('resize', recolocar);
      window.removeEventListener('scroll', recolocar, true);
    };
  }, [abierto]);

  // Mantiene visible la opcion activa.
  useEffect(() => {
    if (!abierto) return;
    document.getElementById(`${id}-op-${activa}`)?.scrollIntoView({ block: 'nearest' });
  }, [abierto, activa, id]);

  function abrir() {
    if (deshabilitado) return;
    const i = Math.max(
      filtradas.findIndex((o) => o.valor === actual),
      0,
    );
    setActiva(i);
    setAbierto(true);
  }

  function alTeclear(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!abierto) abrir();
      else setActiva((a) => Math.min(a + 1, filtradas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!abierto) abrir();
      else setActiva((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Home' && abierto) {
      e.preventDefault();
      setActiva(0);
    } else if (e.key === 'End' && abierto) {
      e.preventDefault();
      setActiva(filtradas.length - 1);
    } else if (e.key === 'Enter') {
      if (abierto) {
        e.preventDefault(); // no envia el formulario mientras eliges
        const op = filtradas[activa];
        if (op) elegir(op);
      }
    } else if (e.key === 'Escape') {
      if (abierto) {
        e.preventDefault();
        e.stopPropagation(); // no cierra un dialogo que contenga al campo
        setTexto(null);
        setAbierto(false);
      }
    } else if (e.key === 'Tab') {
      setAbierto(false); // el blur que sigue confirma lo escrito
    }
  }

  /** Al salir del campo: si lo escrito es exactamente una opcion, se elige (no se descarta en silencio). */
  function confirmarTexto() {
    if (texto !== null) {
      const q = normalizarTexto(texto);
      const exacta = q ? opciones.find((o) => normalizarTexto(o.etiqueta) === q) : undefined;
      if (exacta && exacta.valor !== actual) {
        elegir(exacta);
        return;
      }
    }
    setTexto(null);
    setAbierto(false);
  }

  const mostrado = texto ?? elegida?.etiqueta ?? '';
  const idActiva = abierto && filtradas[activa] ? `${id}-op-${activa}` : undefined;

  return (
    <div className={cn('relative', className)}>
      {nombre ? <input type="hidden" name={nombre} value={actual ?? ''} /> : null}
      <div ref={caja} className="relative">
        <input
          ref={entrada}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={idActiva}
          disabled={deshabilitado}
          placeholder={placeholder}
          value={mostrado}
          onChange={(e) => {
            setTexto(e.target.value);
            setActiva(0);
            setAbierto(true);
          }}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onClick={() => (abierto ? undefined : abrir())}
          onBlur={confirmarTexto}
          onKeyDown={alTeclear}
          className={cn(baseControl, 'min-h-11 py-2 pr-16 max-sm:min-h-12')}
          {...aria}
        />
        <span className="absolute inset-y-0 right-1.5 flex items-center gap-0.5">
          {limpiable && elegida && !deshabilitado ? (
            <button
              type="button"
              aria-label="Quitar selección"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                elegir(null);
                entrada.current?.focus();
              }}
              className="inline-flex size-8 items-center justify-center rounded text-tinta-suave hover:bg-azul-50 hover:text-tinta"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
          <ChevronDown aria-hidden className="pointer-events-none mr-1.5 size-4 text-tinta-suave" />
        </span>
      </div>

      <div ref={lista} popover="manual" className="flotante overflow-auto rounded-lg border border-borde-suave bg-superficie py-1 shadow-flotante" style={{ maxHeight: '16rem' }}>
        <div id={idLista} role="listbox" aria-label={aria['aria-label'] ?? 'Opciones'}>
          {filtradas.length === 0 ? (
            <p role="presentation" className="px-3 py-3 text-sm text-tinta-suave">
              {textoVacio}
            </p>
          ) : (
            filtradas.map((o, i) => {
              const sel = o.valor === actual;
              return (
                <div
                  key={o.valor}
                  id={`${id}-op-${i}`}
                  role="option"
                  aria-selected={sel}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => elegir(o)}
                  onMouseMove={() => setActiva(i)}
                  className={cn(
                    'flex min-h-10 cursor-pointer items-center gap-2 px-3 py-2 text-base',
                    i === activa ? 'bg-azul-50' : '',
                    sel && 'font-semibold text-azul-800',
                  )}
                >
                  <Check aria-hidden className={cn('size-4 shrink-0 text-azul-700', sel ? 'opacity-100' : 'opacity-0')} />
                  <span className="min-w-0 flex-1 truncate">{o.etiqueta}</span>
                  {o.detalle ? <span className="shrink-0 font-mono text-xs text-tinta-suave">{o.detalle}</span> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
