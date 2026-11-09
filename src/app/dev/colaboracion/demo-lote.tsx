'use client';

import { useState } from 'react';
import { BarraLote } from '@/componentes/colaboracion/BarraLote';
import { Casilla } from '@/componentes/ui/casilla';

interface FilaDemo {
  id: string;
  codigo: string;
  nombre: string;
}

/** Como se usa `BarraLote` en un listado: casillas por fila + la barra con los ids marcados. */
export function DemoLote({ filas }: { filas: FilaDemo[] }) {
  const [marcadas, setMarcadas] = useState<string[]>([]);
  return (
    <div className="space-y-4">
      <ul className="divide-y divide-borde-suave rounded-xl border border-borde-suave bg-superficie">
        {filas.map((f) => (
          <li key={f.id}>
            <Casilla
              checked={marcadas.includes(f.id)}
              onChange={(e) => setMarcadas((m) => (e.target.checked ? [...m, f.id] : m.filter((x) => x !== f.id)))}
              etiqueta={
                <span>
                  <span className="font-mono text-sm text-tinta-suave">{f.codigo}</span> <span className="font-semibold">{f.nombre}</span>
                </span>
              }
              aria-label={`Seleccionar ${f.codigo}`}
            />
          </li>
        ))}
      </ul>
      <BarraLote referenciaIds={marcadas} onLimpiar={() => setMarcadas([])} />
    </div>
  );
}
