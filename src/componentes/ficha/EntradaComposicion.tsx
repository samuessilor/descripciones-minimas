'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Boton } from '@/componentes/ui/button';
import { AreaTexto, Campo } from '@/componentes/ui/input';
import { cn } from '@/lib/utils';
import { parsearComposicion, serializarComposicion, sumarComposicion, type FilaComposicion } from './composicion';

/**
 * Composicion de un insumo (02-ux-ui 4.5): tabla Componente / Desde % / Hasta % con la suma debajo, o texto
 * libre (la reunion dijo que es «muy variable»). Las dos formas escriben el MISMO texto, una linea por
 * componente; `onCambio` entrega siempre ese texto.
 */
export function EntradaComposicion({
  id,
  valor,
  deshabilitado,
  maximo,
  descritoPor,
  onCambio,
  alSalir,
}: {
  id: string;
  valor: string;
  deshabilitado: boolean;
  maximo: number;
  descritoPor?: string | undefined;
  onCambio: (texto: string) => void;
  /** El foco salio de las filas (a los botones de abajo o fuera): es el momento de guardar. */
  alSalir?: () => void;
}) {
  const [libre, setLibre] = useState(() => parsearComposicion(valor).some((f) => f.componente.length > 120));
  const [filas, setFilas] = useState<FilaComposicion[]>(() => {
    const f = parsearComposicion(valor);
    return f.length > 0 ? f : [{ componente: '', desde: '', hasta: '' }];
  });

  // Si el texto cambia desde fuera (otra persona, restaurar), la tabla lo sigue mientras no se esta editando.
  const [ultimo, setUltimo] = useState(valor);
  if (valor !== ultimo) {
    setUltimo(valor);
    if (serializarComposicion(filas) !== valor.trim()) {
      const f = parsearComposicion(valor);
      setFilas(f.length > 0 ? f : [{ componente: '', desde: '', hasta: '' }]);
    }
  }

  function cambiar(nuevas: FilaComposicion[]) {
    setFilas(nuevas);
    const texto = serializarComposicion(nuevas);
    setUltimo(texto);
    onCambio(texto);
  }

  const suma = sumarComposicion(filas);

  if (libre) {
    return (
      <div className="space-y-2">
        <AreaTexto
          id={id}
          rows={4}
          maxLength={maximo}
          disabled={deshabilitado}
          aria-describedby={descritoPor}
          className="field-sizing-content min-h-20"
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
        />
        <Boton
          variante="terciario"
          tamano="sm"
          disabled={deshabilitado}
          onClick={() => {
            const f = parsearComposicion(valor);
            setFilas(f.length > 0 ? f : [{ componente: '', desde: '', hasta: '' }]);
            setLibre(false);
          }}
        >
          Ordenar en tabla con porcentajes
        </Boton>
      </div>
    );
  }

  return (
    <div className="space-y-3" role="group" aria-labelledby={`${id}-etiqueta`}>
      <div className="overflow-hidden rounded-lg border border-borde-campo bg-superficie">
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_2.75rem] gap-x-2 border-b border-borde-suave bg-superficie-2 px-3 py-2 text-xs font-semibold text-tinta-suave max-sm:grid-cols-[minmax(0,1fr)_3.75rem_3.75rem_2.75rem]">
          <span id={`${id}-etiqueta`}>Componente</span>
          <span>Desde %</span>
          <span>Hasta %</span>
          <span className="sr-solo">Quitar</span>
        </div>
        <ul
          className="divide-y divide-borde-suave"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) alSalir?.();
          }}
        >
          {filas.map((f, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_2.75rem] items-center gap-x-2 px-3 py-2 max-sm:grid-cols-[minmax(0,1fr)_3.75rem_3.75rem_2.75rem]"
            >
              <Campo
                id={i === 0 ? id : undefined}
                aria-label={`Componente ${i + 1}`}
                aria-describedby={i === 0 ? descritoPor : undefined}
                disabled={deshabilitado}
                maxLength={200}
                value={f.componente}
                onChange={(e) => cambiar(filas.map((x, j) => (j === i ? { ...x, componente: e.target.value } : x)))}
                className="min-h-10 px-2.5"
              />
              <Campo
                aria-label={`Desde, en porcentaje, del componente ${i + 1}`}
                inputMode="decimal"
                disabled={deshabilitado}
                maxLength={7}
                value={f.desde}
                onChange={(e) => cambiar(filas.map((x, j) => (j === i ? { ...x, desde: e.target.value } : x)))}
                className="min-h-10 px-2 text-right tabular-nums"
              />
              <Campo
                aria-label={`Hasta, en porcentaje, del componente ${i + 1}`}
                inputMode="decimal"
                disabled={deshabilitado}
                maxLength={7}
                value={f.hasta}
                onChange={(e) => cambiar(filas.map((x, j) => (j === i ? { ...x, hasta: e.target.value } : x)))}
                className="min-h-10 px-2 text-right tabular-nums"
              />
              <Boton
                variante="terciario"
                tamano="icono-sm"
                aria-label={`Quitar el componente ${i + 1}`}
                disabled={deshabilitado || filas.length === 1}
                onClick={() => cambiar(filas.filter((_, j) => j !== i))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Boton>
            </li>
          ))}
        </ul>
        <div className="border-t border-borde-suave bg-superficie-2 px-3 py-2">
          <Boton
            variante="terciario"
            tamano="sm"
            disabled={deshabilitado || filas.length >= 40}
            onClick={() => setFilas([...filas, { componente: '', desde: '', hasta: '' }])}
          >
            <Plus aria-hidden className="size-4" />
            Agregar componente
          </Boton>
        </div>
      </div>

      {suma.nivel !== 'ninguno' ? (
        <p
          className={cn(
            'text-sm',
            suma.nivel === 'error' ? 'font-medium text-error' : 'text-tinta-suave',
          )}
          role={suma.nivel === 'error' ? 'alert' : undefined}
        >
          {suma.mensaje}
        </p>
      ) : null}

      <Boton
        variante="terciario"
        tamano="sm"
        disabled={deshabilitado}
        onClick={() => {
          setLibre(true);
          onCambio(serializarComposicion(filas));
        }}
      >
        Escribir como texto libre
      </Boton>
    </div>
  );
}
