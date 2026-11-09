/**
 * SLOT: boton 'Enviar a' de la ficha y su dialogo (asignar a una o varias personas, mensaje opcional)
 * Dueno: colaboracion. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Renderiza el grupo de acciones del pie de la ficha: «Listo por mi parte» (solo si la persona tiene esta
 * referencia pendiente) y «Enviar a…». El envio por lote desde el listado usa `BarraLote`
 * (`@/componentes/colaboracion/BarraLote`).
 */
import { BotonEnviarACliente } from '@/componentes/colaboracion/EnviarA';

export function BotonEnviarA({ referenciaId }: { referenciaId: string }) {
  return <BotonEnviarACliente referenciaId={referenciaId} />;
}
