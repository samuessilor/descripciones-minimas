/**
 * Historico importado: referencias que se cerraron ANTES de existir la plataforma y se cargan de una vez desde un Excel
 * (`npm run importar:historico`). Dominio PURO.
 *
 * Como se reconocen en la base sin migrar nada:
 *  - su autor es la cuenta `Historico importado` (inactiva, sin contrasena: no puede entrar), de una organizacion interna
 *    inactiva con el mismo nombre;
 *  - cada dato queda como un hecho `fijar` con `origen = 'sistema'` (version 1). Una escritura normal `fijar` siempre es
 *    `origen = 'web'`, y los eventos automaticos reales (cierre, restriccion copiada de la partida) son `tipo_evento =
 *    'sistema'`, asi que `fijar` + `sistema` solo lo produce el importador (`esEventoImportado`).
 * Esos hechos son la unica copia del dato antiguo (la proyeccion `datos` se reconstruye desde ellos), pero no son «un cambio»:
 * la hoja `Historial` del Excel los deja fuera (50.000 filas que repetirian la hoja `Base` y gastarian CPU en cada descarga).
 */

export const NOMBRE_HISTORICO = 'Histórico importado';
export const CORREO_HISTORICO = 'historico-importado@sin-correo.invalid';
/** Texto que se agrega a «Informacion adicional» cuando la fila no la trae: asi la ficha dice de donde viene. */
export const NOTA_HISTORICO = 'Referencia cargada del histórico anterior a la plataforma.';

export function esEventoImportado(e: { origen: string; tipoEvento: string }): boolean {
  return e.origen === 'sistema' && e.tipoEvento === 'fijar';
}

/** Mediodia de Bogota (UTC-5, sin horario de verano) de una fecha `YYYY-MM-DD`: ni la madrugada ni el cambio de dia. */
export function instanteDeFecha(fecha: string): Date {
  return new Date(`${fecha}T17:00:00.000Z`);
}
