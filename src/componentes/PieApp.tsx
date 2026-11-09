import { ShieldCheck } from 'lucide-react';
import { Insignia } from './ui/insignia';

/** Pie discreto: marca, nombre del producto y la promesa que mas importa a las usuarias (nada se borra). */
export function PieApp() {
  const enDesarrollo = process.env.NODE_ENV !== 'production';
  return (
    <footer className="mt-auto border-t border-borde-suave px-4 py-5 text-xs text-tinta-suave sm:px-6 lg:px-8">
      <div className="contenedor-ancho flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <p className="flex items-center gap-1.5">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-azul-700" />
          Nada de lo que escribes se borra: todo queda en el historial.
        </p>
        <p className="flex items-center gap-2">
          EssilorLuxottica · Supply Chain · Descripciones mínimas
          {enDesarrollo ? <Insignia variante="contorno">Desarrollo</Insignia> : null}
        </p>
      </div>
    </footer>
  );
}
