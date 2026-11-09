/**
 * SLOT: buscador con lupa de la barra superior (escribes la referencia y te lleva a su ficha)
 * Dueno: ficha-listado. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Componente de servidor: lee la preferencia de atajos y el permiso de crear, y los pasa al cliente.
 */
import { BuscadorLupaCliente } from '@/componentes/busqueda/BuscadorLupaCliente';
import { puede } from '@/dominio/permisos';
import { atajosDeTecladoActivos } from '@/server/politicas/preferencias-busqueda';
import { exigirContexto } from '@/server/sesion';

export async function BuscadorLupa() {
  const { db, actor } = await exigirContexto({ claveInicial: true }); // se pinta tambien en «Mi cuenta» con la contrasena inicial; la busqueda en si la rechaza el servidor
  const atajos = await atajosDeTecladoActivos(db, actor.usuarioId);
  return <BuscadorLupaCliente atajos={atajos} puedeCrear={puede(actor, 'crear_referencia')} />;
}
