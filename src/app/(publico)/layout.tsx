import type { ReactNode } from 'react';
import { Logo } from '@/componentes/Logo';
import { Estado } from '@/componentes/Estado';
import { AnillosLente } from '@/componentes/ui/decoracion';
import { Insignia } from '@/componentes/ui/insignia';
import { BarraProgreso } from '@/componentes/ui/progreso';

/**
 * Pantallas publicas (entrada). Panel azul oscuro con composicion tipografica y una miniatura de «hoja de
 * vida» de EJEMPLO (sin fotos de stock, 11.1); a la derecha el formulario sobre fondo claro. En movil el
 * panel se reduce a una banda con el logo. La miniatura es decorativa (`aria-hidden`) y usa datos
 * inventados marcados como ejemplo.
 */
function MiniFicha() {
  const filas = [
    { n: 1, titulo: 'Producto', color: 'verde' as const, texto: 'Completa' },
    { n: 2, titulo: 'Detalle', color: 'amarillo' as const, texto: 'Faltan 3' },
    { n: 3, titulo: 'Especificaciones', color: 'amarillo' as const, texto: 'Faltan 5' },
  ];
  return (
    <div aria-hidden className="relative w-full max-w-md rounded-2xl bg-white p-5 text-tinta shadow-modal">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Insignia variante="contorno" className="mb-2">
            Ejemplo
          </Insignia>
          <p className="truncate font-display text-xl font-extrabold leading-tight">Limpiador de lentes</p>
          <p className="mt-0.5 font-mono text-sm text-tinta-suave">EJEMPLO-0001 · Insumo</p>
        </div>
        <Estado color="amarillo" texto="Pendiente" tamano="md" sinRol />
      </div>
      <ul className="mt-4 divide-y divide-borde-suave rounded-xl border border-borde-suave">
        {filas.map((f) => (
          <li key={f.n} className="flex items-center gap-3 px-3 py-2.5">
            <span
              className={
                f.color === 'verde'
                  ? 'flex size-7 items-center justify-center rounded-full border-2 border-verde-solido bg-verde-fondo font-display text-sm font-extrabold text-verde-texto'
                  : 'flex size-7 items-center justify-center rounded-full border-2 border-amarillo-borde bg-amarillo-fondo font-display text-sm font-extrabold text-amarillo-texto'
              }
            >
              {f.n}
            </span>
            <span className="flex-1 font-semibold">{f.titulo}</span>
            <Estado color={f.color} texto={f.texto} tamano="sm" sinRol />
          </li>
        ))}
      </ul>
      <BarraProgreso className="mt-4" completados={9} total={17} />
    </div>
  );
}

export default function LayoutPublico({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="superficie-oscura fondo-azul relative isolate overflow-hidden text-white">
        <AnillosLente className="absolute -bottom-24 -right-40 -z-10 w-[56rem] max-w-none" />
        <AnillosLente className="absolute -left-72 -top-32 -z-10 hidden w-[44rem] max-w-none opacity-70 lg:block" />
        <div className="flex h-full flex-col justify-between gap-12 px-6 py-6 sm:px-10 lg:min-h-dvh lg:px-14 lg:py-12">
          <div className="flex flex-col gap-2.5">
            <span className="max-lg:hidden">
              <Logo alto={26} />
            </span>
            <span className="lg:hidden">
              <Logo alto={20} />
            </span>
            <p className="font-display text-sm font-bold tracking-tight text-azul-200 lg:hidden">Descripciones mínimas · Supply Chain</p>
          </div>

          <div className="hidden space-y-8 lg:block">
            <div>
              <p className="text-balance font-display text-4xl font-extrabold leading-[1.08] tracking-tight">
                Una referencia.
                <br />
                Una sola clasificación.
              </p>
              <p className="mt-4 max-w-md text-lg text-azul-200">
                Llenas lo que sabes una vez, lo envías a quien sigue con un clic y la base queda guardada, con historial.
              </p>
            </div>
            <MiniFicha />
          </div>

          <p className="hidden text-sm text-azul-300 lg:block">Supply Chain · Descripciones mínimas</p>
        </div>
      </aside>

      <main id="contenido" tabIndex={-1} className="flex flex-1 items-center justify-center bg-fondo px-5 py-10 text-tinta outline-none sm:px-10 lg:min-h-dvh">
        <div className="w-full max-w-[28rem] rounded-2xl border border-borde-suave bg-superficie p-6 shadow-flotante sm:p-9">{children}</div>
      </main>
    </div>
  );
}
