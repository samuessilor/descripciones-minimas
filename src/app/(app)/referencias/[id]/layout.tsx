import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cargarReferenciaVisible } from '@/server/politicas/referencias';
import { exigirContexto } from '@/server/sesion';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Comprueba aqui, ANTES de que empiece a llegar la pagina, que la referencia existe y es visible para quien la
 * pide: asi una ficha ajena o inexistente responde **404 de verdad** (no 403, y sin distinguir una de otra, SPEC 13.2)
 * aunque la pantalla muestre un esqueleto de carga mientras llega la ficha (`loading.tsx` ya habria enviado un 200).
 */
export default async function LayoutFicha({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { db, actor } = await exigirContexto();
  try {
    await cargarReferenciaVisible(db, actor, id, new Date());
  } catch (e) {
    if (e instanceof ErrorAccion && e.codigo === 'NO_ENCONTRADO') notFound();
    throw e;
  }
  return children;
}
