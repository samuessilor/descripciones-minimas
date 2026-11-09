/**
 * Aplicar en pantalla un guardado propio SIN volver a pedir la ficha entera. La respuesta del guardado trae el valor
 * normalizado, la version del campo y la version de la ficha; con eso (y las mismas funciones puras que usa el servidor
 * para el semaforo) se reconstruye lo que el servidor devolveria, siempre que NADIE MAS haya escrito entre medias.
 *
 * Si no se puede garantizar, devuelve `null` y quien llama refresca la ficha completa (comportamiento de siempre).
 */
import { COLUMNA_PROMOVIDA } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';
import { etiquetaFicha } from '@/dominio/estado';
import { estaVacio } from '@/dominio/valores';
import type { ResultadoGuardarCampo } from '@/server/acciones/guardar-campo';
import type { FichaVista } from '@/server/politicas/referencias';

/** Lo que responde el guardado de un campo, mas la clave del campo. */
export type GuardadoCampo = Pick<ResultadoGuardarCampo, 'escrito' | 'version' | 'valor' | 'versionFicha'> & { campo: string };

/**
 * La ficha tal como quedo tras el guardado, o `null` si hay que releerla del servidor:
 *   - la version de la ficha no es la conocida + 1 (o igual, si no escribio nada): otra persona o accion escribio
 *     entre medias y su cambio no esta en pantalla;
 *   - el campo alimenta una columna que el servidor mantiene aparte (codigo, nombre, tipo, partida, fecha de solicitud).
 * El semaforo, el conteo de cada seccion y la etiqueta se recalculan con las mismas funciones del dominio que usa el
 * servidor (`vistaFicha`), asi que los indicadores «Completa / Faltan N» quedan igual que tras un refresco.
 */
export function aplicarGuardado(ficha: FichaVista, versionConocida: number, g: GuardadoCampo, ahora: Date = new Date()): FichaVista | null {
  const esperada = g.escrito ? versionConocida + 1 : versionConocida;
  if (g.versionFicha !== esperada) return null;
  if (COLUMNA_PROMOVIDA[g.campo]) return null;
  // Un valor identico al vigente no escribe nada: no hay nada que cambiar en pantalla.
  if (!g.escrito) return ficha;

  const campos = {
    ...ficha.campos,
    // Como el servidor: un valor vacio se guarda como `null` (el campo sigue existiendo, con su version).
    [g.campo]: {
      clave: g.campo,
      valor: estaVacio(g.valor) ? null : g.valor,
      version: g.version,
      autor: 'Tú',
      propio: true,
      instante: ahora.toISOString(),
    },
  };
  const valores = Object.fromEntries(Object.entries(campos).map(([clave, c]) => [clave, c.valor]));
  const completitud = calcularCompletitud({ tipo: ficha.tipoProducto, valores });
  // «Reabierta» solo la sabe el servidor (historial de la ficha) y un guardado no la cambia: se conserva.
  const etiqueta =
    ficha.etiqueta === 'Reabierta'
      ? ficha.etiqueta
      : etiquetaFicha({
          estado: ficha.estado,
          archivada: ficha.archivada,
          reabierta: false,
          finalizada: completitud.finalizada,
          tresSeccionesVerdes: completitud.tresSeccionesVerdes,
          esperaRespuesta: completitud.aduana.faltantes.includes('respuesta_area'),
        });
  return { ...ficha, campos, completitud, etiqueta, version: g.versionFicha, actualizadaEn: ahora.toISOString() };
}
