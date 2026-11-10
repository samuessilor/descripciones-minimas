'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Boton } from '@/componentes/ui/button';

/**
 * Un texto corto en monoespaciado con su boton «Copiar» (el usuario de una cuenta, para entregarlo o pegarlo sin teclearlo).
 * Solo copia lo que ya esta a la vista: nunca una contrasena.
 */
export function TextoCopiable({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso del navegador: el texto se puede seleccionar a mano */
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="select-all break-all font-mono" data-testid="texto-copiable">
        {texto}
      </span>
      <Boton variante="terciario" tamano="sm" onClick={copiar} aria-label={`Copiar ${etiqueta}`}>
        {copiado ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </Boton>
    </span>
  );
}
