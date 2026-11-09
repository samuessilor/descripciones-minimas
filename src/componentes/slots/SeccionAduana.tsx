/**
 * SLOT: bloque de aduana de la ficha: partida arancelaria, descripciones minimas adicionales (y la respuesta del area), restricciones, observaciones, cerrar y reabrir
 * Dueno: aduana. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * La implementacion vive en `componentes/aduana`. Es un componente de cliente que carga sus propios datos por una
 * Server Action, asi que sirve igual dentro de una pagina de servidor o de un componente de cliente de la ficha.
 */
import { ZonaAduana } from '@/componentes/aduana/ZonaAduana';

export function SeccionAduana({ referenciaId }: { referenciaId: string }) {
  return <ZonaAduana referenciaId={referenciaId} />;
}
