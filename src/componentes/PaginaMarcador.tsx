import { Hourglass } from 'lucide-react';
import type { ReactNode } from 'react';
import { ContenedorLectura, EncabezadoPagina } from './ui/pagina';
import { EstadoVacio } from './ui/estado-vacio';

/**
 * Seccion del mapa de navegacion (10.1) cuya pantalla real aun no existe: estado vacio «Próximamente».
 * Existe para que TODA la navegacion funcione desde el primer dia (404 solo para lo inexistente). Cuando una
 * pantalla se construye, su pagina deja de usar este componente. `hito` es solo una nota interna
 * (atributo `data-hito`); no se muestra a nadie.
 */
export function PaginaMarcador({
  titulo,
  hito,
  children,
}: {
  titulo: string;
  hito?: string;
  children?: ReactNode;
}) {
  return (
    <ContenedorLectura>
      <EncabezadoPagina titulo={titulo} />
      <div data-hito={hito}>
        <EstadoVacio
          icono={Hourglass}
          titulo="Próximamente"
          descripcion={children ?? 'Estamos terminando esta sección. Mientras tanto, lo que ya existe sigue funcionando.'}
        />
      </div>
    </ContenedorLectura>
  );
}
