/**
 * SLOT: panel lateral de la ficha: historial por campo, comentarios, restaurar valores
 * Dueno: colaboracion. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Renderiza el boton «Historial y comentarios» y el cajon con tres pestanas (Historial, Comentarios, Envios).
 * Tambien registra que la persona abrio la ficha. Para abrirlo desde otro punto (p. ej. el icono de comentario
 * de un campo): `abrirActividad({ referenciaId, pestana: 'comentarios', campo })` de `@/componentes/colaboracion/api`.
 */
import { PanelActividadCliente } from '@/componentes/colaboracion/PanelActividad';

export function PanelActividad({ referenciaId }: { referenciaId: string }) {
  return <PanelActividadCliente referenciaId={referenciaId} />;
}
