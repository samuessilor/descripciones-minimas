import type { ReactNode } from 'react';
import { MarcoApp } from '@/componentes/MarcoApp';
import { exigirActor } from '@/server/sesion';

export const dynamic = 'force-dynamic';

/**
 * «Mi cuenta» y «Ayuda»: lo unico que se puede usar si la guardia `debeCambiarClave` esta activa. Hoy no se activa por
 * defecto (la contrasena entregada se puede conservar); el grupo queda para ese caso latente.
 */
export default async function LayoutClaveInicial({ children }: { children: ReactNode }) {
  const actor = await exigirActor({ claveInicial: true });
  return <MarcoApp actor={actor}>{children}</MarcoApp>;
}
