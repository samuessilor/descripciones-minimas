import type { ReactNode } from 'react';
import { MarcoApp } from '@/componentes/MarcoApp';
import { exigirActor } from '@/server/sesion';

export const dynamic = 'force-dynamic';

/** «Mi cuenta» y «Ayuda»: lo unico que se puede usar con la contrasena inicial (hay que cambiarla antes de seguir). */
export default async function LayoutClaveInicial({ children }: { children: ReactNode }) {
  const actor = await exigirActor({ claveInicial: true });
  return <MarcoApp actor={actor}>{children}</MarcoApp>;
}
