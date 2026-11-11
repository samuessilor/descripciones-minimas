'use client';

import { Landmark } from 'lucide-react';
import { Boton } from '@/componentes/ui/button';

/**
 * Aviso grande que aparece justo debajo de las tres secciones cuando el area las completo y la referencia aun no tiene agencia
 * aduanera (reunion 2026-11-10). Lo que sigue es clasificar, y eso es de la aduana: el boton abre «Enviar a» ya en modo
 * «designar agencia», con las agencias primero (las areas de EssilorLuxottica no se eligen para esta parte).
 */
export function AvisoDesignarAduana({ referenciaId, codigo }: { referenciaId: string; codigo: string }) {
  function designar() {
    window.dispatchEvent(new CustomEvent('dm:abrir-enviar-a', { detail: { referenciaId, secciones: [], modo: 'aduana' } }));
  }
  return (
    <section
      aria-labelledby="designar-aduana-titulo"
      data-testid="designar-aduana"
      className="rounded-2xl border-2 border-azul-600 bg-azul-50 p-5 shadow-suave sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-4">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full bg-azul-700 text-white">
            <Landmark className="size-6" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h2 id="designar-aduana-titulo" className="font-display text-2xl font-extrabold tracking-tight text-tinta">
              Las tres secciones están completas
            </h2>
            <p className="text-base text-tinta">
              Falta un último paso: <strong>designar la agencia aduanera responsable</strong> de {codigo}. Es quien la clasifica; le llega un aviso con el enlace directo.
            </p>
          </div>
        </div>
        <Boton tamano="lg" onClick={designar} className="max-sm:w-full" data-testid="designar-aduana-boton">
          <Landmark aria-hidden className="size-5" />
          Designar la agencia aduanera responsable
        </Boton>
      </div>
    </section>
  );
}
