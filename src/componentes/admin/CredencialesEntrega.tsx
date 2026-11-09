'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import type { SecretoEntrega } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin permiso del navegador: se puede seleccionar el texto a mano */
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-borde-suave bg-superficie-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold text-tinta-suave">{etiqueta}</p>
        <p className="select-all break-all font-mono text-lg font-bold text-tinta" data-testid={`credencial-${etiqueta.toLowerCase()}`}>
          {valor}
        </p>
      </div>
      <Boton variante="secundario" tamano="sm" onClick={copiar} aria-label={`Copiar ${etiqueta.toLowerCase()}`}>
        {copiado ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        {copiado ? 'Copiado' : 'Copiar'}
      </Boton>
    </div>
  );
}

/**
 * El usuario y la contrasena temporal de una cuenta recien creada o restablecida. Se muestran UNA vez: en la base solo
 * queda el hash. Quien administra se los entrega a quien corresponda (en persona o por un canal que ya use el area).
 */
export function CredencialesEntrega({ secreto }: { secreto: SecretoEntrega }) {
  return (
    <div className="space-y-4" data-testid="credenciales-entrega">
      <Aviso tipo="aviso" titulo="Cópialas ahora: no se vuelven a mostrar">
        Entrega estos datos a {secreto.nombre}. Si se pierde, la restableces desde la ficha de la cuenta.
      </Aviso>
      <Fila etiqueta="Usuario" valor={secreto.usuario} />
      <Fila etiqueta="Contraseña" valor={secreto.clave} />
    </div>
  );
}
