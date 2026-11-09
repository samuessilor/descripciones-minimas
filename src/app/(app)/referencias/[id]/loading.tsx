import { Esqueleto, EsqueletoZona } from '@/componentes/ui/esqueleto';
import { ContenedorLectura } from '@/componentes/ui/pagina';

/** Carga de la ficha: cabecera, barra y tres secciones con su altura aproximada. */
export default function CargandoFicha() {
  return (
    <ContenedorLectura className="space-y-5">
      <EsqueletoZona etiqueta="Cargando la referencia…" className="space-y-5">
        <Esqueleto className="h-4 w-40" />
        <Esqueleto className="h-40 w-full rounded-2xl" />
        <Esqueleto className="h-14 w-full rounded-xl" />
        <Esqueleto className="h-72 w-full rounded-xl" />
        <Esqueleto className="h-24 w-full rounded-xl" />
        <Esqueleto className="h-24 w-full rounded-xl" />
      </EsqueletoZona>
    </ContenedorLectura>
  );
}
