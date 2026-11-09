/**
 * SLOT: boton 'Descargar base en Excel' del listado
 * Dueno: aduana. Este archivo es un punto de enlace: su dueno lo reemplaza por la implementacion real
 * SIN cambiar el nombre exportado ni las props. Nadie mas lo edita.
 *
 * Lee los filtros de la direccion actual (`estado`, `tipo`, `q`, `mias`, `agencia`, `sinResponsable`, `partida`: los del listado) para que
 * «Lo que veo en la lista» exporte exactamente lo que la persona esta mirando.
 */
import { Suspense } from 'react';
import { DescargarExcel } from '@/componentes/aduana/DescargarExcel';

export function BotonExportar() {
  return (
    <Suspense fallback={null}>
      <DescargarExcel />
    </Suspense>
  );
}
