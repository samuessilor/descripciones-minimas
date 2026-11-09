import { Esqueleto, EsqueletoFilas, EsqueletoZona } from '@/componentes/ui/esqueleto';
import { ContenedorAncho } from '@/componentes/ui/pagina';

/** Carga del listado: el titulo y los filtros no se mueven; las filas tienen la altura final (sin saltos). */
export default function CargandoReferencias() {
  return (
    <ContenedorAncho className="space-y-5">
      <EsqueletoZona etiqueta="Cargando las referencias…">
        <div className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div className="space-y-2">
              <Esqueleto className="h-8 w-48" />
              <Esqueleto className="h-4 w-40" />
            </div>
            <Esqueleto className="h-11 w-40 rounded-md" />
          </div>
          <div className="flex gap-3">
            <Esqueleto className="h-16 w-44 rounded-xl" />
            <Esqueleto className="h-16 w-44 rounded-xl" />
            <Esqueleto className="h-16 w-44 rounded-xl" />
          </div>
          <Esqueleto className="h-36 w-full rounded-xl" />
        </div>
      </EsqueletoZona>
      <EsqueletoFilas filas={6} />
    </ContenedorAncho>
  );
}
