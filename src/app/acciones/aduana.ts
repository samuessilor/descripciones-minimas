'use server';

/**
 * Server Actions del lado aduana (H4). Cada una vuelve a autenticar y autorizar (una Server Action es un endpoint
 * publico, 13.2 punto 3) y delega en los nucleos de `server/acciones`. Devuelven el contrato `Resultado`.
 */
import { archivar, desarchivar, finalizar, reabrir, solicitarReapertura, type ResultadoFinalizar } from '@/server/acciones/cierre';
import { fijarPartida, type ResultadoFijarPartida } from '@/server/acciones/partida';
import { comoResultado, type Resultado } from '@/server/acciones/resultado';
import { contextoDeAccion } from '@/server/sesion';

// Las LECTURAS de la zona (vista y sugerencias de partida) van por GET: `/api/aduana/[id]/vista` y `/api/aduana/partidas`.
// Aqui quedan solo las mutaciones: Next ejecuta las Server Actions de un cliente una por una. Las descripciones
// minimas, las restricciones y las observaciones se guardan con `guardarCampoAccion`, como cualquier campo.

export async function fijarPartidaAccion(entrada: unknown): Promise<Resultado<ResultadoFijarPartida>> {
  return comoResultado(async () => fijarPartida(await contextoDeAccion(), entrada));
}

export async function finalizarAccion(entrada: unknown): Promise<Resultado<ResultadoFinalizar>> {
  return comoResultado(async () => finalizar(await contextoDeAccion(), entrada));
}

export async function reabrirAccion(entrada: unknown): Promise<Resultado<{ ok: true; versionFicha: number }>> {
  return comoResultado(async () => reabrir(await contextoDeAccion(), entrada));
}

export async function solicitarReaperturaAccion(entrada: unknown): Promise<Resultado<{ ok: true; asignadoA: string | null }>> {
  return comoResultado(async () => solicitarReapertura(await contextoDeAccion(), entrada));
}

export async function archivarAccion(entrada: unknown): Promise<Resultado<{ ok: true }>> {
  return comoResultado(async () => archivar(await contextoDeAccion(), entrada));
}

export async function desarchivarAccion(entrada: unknown): Promise<Resultado<{ ok: true }>> {
  return comoResultado(async () => desarchivar(await contextoDeAccion(), entrada));
}
