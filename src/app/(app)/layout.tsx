import type { ReactNode } from 'react';
import { BarraSuperior } from '@/componentes/BarraSuperior';
import { NavLateral } from '@/componentes/NavLateral';
import { destinosPara } from '@/componentes/navegacion';
import { PieApp } from '@/componentes/PieApp';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { exigirActor } from '@/server/sesion';

export const dynamic = 'force-dynamic';

/**
 * Armazon autenticado (10.1): barra superior fija (logo, buscador, campana, usuario); menu lateral desde
 * 1024 px y barra inferior de tres destinos debajo; contenido con pie discreto. Toda pagina de este
 * grupo exige sesion valida (`exigirActor` relee `usuario.activo` en cada peticion, 13.1).
 *
 * Anchos: la ficha usa `ContenedorLectura` (720 px) y los listados `ContenedorAncho` (ver `ui/pagina`).
 * El `<main>` no impone ancho: lo decide cada pantalla.
 */
export default async function LayoutAutenticado({ children }: { children: ReactNode }) {
  const actor = await exigirActor();
  const destinos = destinosPara(actor.rol);

  return (
    <div className="flex min-h-dvh flex-col">
      <BarraSuperior
        usuario={{
          nombre: actor.nombre,
          email: actor.email,
          rol: actor.rol,
          organizacion: nombreSinMarca(actor.organizacionNombre),
          esAgencia: actor.organizacionTipo === 'agencia',
          area: actor.area,
        }}
      />
      <div className="flex flex-1">
        <NavLateral destinos={destinos} variante="lateral" />
        <div className="flex min-w-0 flex-1 flex-col">
          <main id="contenido" tabIndex={-1} className="flex-1 px-4 pb-28 pt-6 outline-none sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
            {children}
          </main>
          <PieApp />
        </div>
      </div>
      <NavLateral destinos={destinos} variante="inferior" />
    </div>
  );
}
