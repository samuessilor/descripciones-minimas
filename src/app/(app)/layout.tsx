import type { ReactNode } from 'react';
import { MarcoApp } from '@/componentes/MarcoApp';
import { exigirActor } from '@/server/sesion';

export const dynamic = 'force-dynamic';

/**
 * Toda pagina de este grupo exige sesion valida (`exigirActor` relee `usuario.activo` en cada peticion, 13.1) y que la
 * contrasena ya no sea la inicial: con la inicial solo se llega a `(app-clave)` («Mi cuenta» y «Ayuda»).
 */
export default async function LayoutAutenticado({ children }: { children: ReactNode }) {
  const actor = await exigirActor();
  return <MarcoApp actor={actor}>{children}</MarcoApp>;
}
