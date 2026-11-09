'use client';

import { Send, X } from 'lucide-react';
import { useState } from 'react';
import { Boton } from '@/componentes/ui/button';
import { plural } from '@/dominio/colaboracion';
import { DialogoEnviarA } from './EnviarA';

/** Tope de fichas por envio en lote (SPEC 8.3, RV-37). */
export const MAX_FICHAS_LOTE = 25;

/**
 * Barra de envio en lote para el LISTADO (RV-37): aparece cuando hay referencias marcadas con la casilla y
 * ofrece «Enviar a…» con los mismos destinatarios para todas (un solo correo resumen por persona).
 *
 *   <BarraLote referenciaIds={marcadas} onLimpiar={() => setMarcadas([])} />
 *
 * El listado dueño de las casillas decide cuales estan marcadas; esta barra solo recibe los ids.
 * Pensada para ir al final de la pagina: es `sticky` y deja libre la barra inferior del movil.
 */
export function BarraLote({
  referenciaIds,
  onLimpiar,
  onEnviado,
}: {
  referenciaIds: string[];
  onLimpiar: () => void;
  onEnviado?: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  // Los ids se congelan al abrir: al enviar, el listado limpia su seleccion y el dialogo (con su resultado) debe seguir ahi.
  const [idsEnvio, setIdsEnvio] = useState<string[]>([]);
  const n = referenciaIds.length;
  if (n === 0 && !abierto) return null;
  const demasiadas = n > MAX_FICHAS_LOTE;

  return (
    <>
      {n > 0 ? (
      <div
        role="region"
        aria-label="Envío en lote"
        className="superficie-oscura sticky bottom-[4.75rem] z-10 mx-auto mt-4 flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-azul-900 px-4 py-3 text-white shadow-modal animate-aparecer lg:bottom-5"
      >
        <p className="min-w-0 flex-1 basis-40 text-base font-semibold">
          {plural(n, 'referencia seleccionada', 'referencias seleccionadas')}
          {demasiadas ? <span className="block text-sm font-normal text-azul-200">Puedes enviar hasta {MAX_FICHAS_LOTE} a la vez. Quita {n - MAX_FICHAS_LOTE}.</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
          <Boton variante="fantasma-claro" onClick={onLimpiar}>
            <X aria-hidden className="size-4" />
            Quitar selección
          </Boton>
          <Boton
            variante="claro"
            onClick={() => {
              setIdsEnvio(referenciaIds.slice(0, MAX_FICHAS_LOTE));
              setAbierto(true);
            }}
            disabled={demasiadas}
          >
            <Send aria-hidden className="size-4" />
            Enviar a…
          </Boton>
        </div>
      </div>
      ) : null}
      <DialogoEnviarA
        referenciaIds={idsEnvio}
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onEnviado={() => {
          onLimpiar();
          onEnviado?.();
        }}
      />
    </>
  );
}
