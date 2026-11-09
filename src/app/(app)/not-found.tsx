import { NoEncontrada } from '@/componentes/ui/pantallas';
import { getActor } from '@/server/sesion';

/**
 * 404 de la zona autenticada. Una ficha ajena o inexistente responde igual (no distingue "no existe"
 * de "sin acceso", 13.2). El texto depende del rol (10.5).
 */
export default async function NoEncontrado() {
  const actor = await getActor();
  return <NoEncontrada aduana={actor?.rol === 'aduana'} compacto />;
}
