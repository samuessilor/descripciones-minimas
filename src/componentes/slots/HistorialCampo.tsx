/**
 * SLOT: indicador por campo de quien lo puso y cuando, con acceso a las versiones anteriores
 * Dueno: colaboracion. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Muestra el acceso «Historial (3)» de un campo con valor: abre las versiones de ESE campo (quien, cuando, valor,
 * motivo) con «Restaurar este valor». La ficha ya imprime «Autor · fecha»; aqui va el acceso, y la ultima version
 * ("Ana, hace 2 h") queda en su nombre accesible y su tooltip. Todos los campos de una ficha comparten UNA lectura
 * (no una por campo) y se refrescan solos. Sin valor no dibuja nada. Tras restaurar avisa con el evento
 * `dm:ficha-cambiada` (ver `colaboracion/api.ts`) para que la ficha vuelva a leer sus valores.
 */
import { HistorialCampoCliente } from '@/componentes/colaboracion/Historial';

export function HistorialCampo({ referenciaId, campo }: { referenciaId: string; campo: string }) {
  return <HistorialCampoCliente referenciaId={referenciaId} campo={campo} />;
}
