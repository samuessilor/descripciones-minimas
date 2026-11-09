'use server';

/**
 * Server Actions de la colaboracion (enviar, marcar listo, recordar, reasignar, cancelar, comentar,
 * leer avisos). Cada una vuelve a autenticar y autorizar (una Server Action es un endpoint publico, 13.2) y
 * delega en los nucleos de `server/acciones`. Las que crean correos piden el envio inmediato con `after()`:
 * la respuesta no espera al proveedor, y si el envio falla el despachador lo reintenta.
 */
import {
  cancelarAsignacion,
  enviarA,
  enviarALote,
  abrirFicha,
  marcarListo,
  recordar,
  reasignar,
  type ResultadoEnviarA,
  type ResultadoMarcarListo,
  type ResultadoReasignar,
  type ResultadoRecordar,
} from '@/server/acciones/asignaciones';
import {
  comentar,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  type ResultadoComentar,
} from '@/server/acciones/comentarios-y-bandeja';
import { comoResultado, type Resultado } from '@/server/acciones/resultado';
import { programarEnvioInmediato } from '@/server/correo/inmediato';
import { contextoDeAccion } from '@/server/sesion';

export async function enviarAAccion(entrada: unknown): Promise<Resultado<ResultadoEnviarA>> {
  return comoResultado(async () => {
    const r = await enviarA(await contextoDeAccion(), entrada);
    programarEnvioInmediato(r.correoIds);
    return r;
  });
}

export async function enviarALoteAccion(entrada: unknown): Promise<Resultado<ResultadoEnviarA>> {
  return comoResultado(async () => {
    const r = await enviarALote(await contextoDeAccion(), entrada);
    programarEnvioInmediato(r.correoIds);
    return r;
  });
}

export async function marcarListoAccion(entrada: unknown): Promise<Resultado<ResultadoMarcarListo>> {
  return comoResultado(async () => {
    const r = await marcarListo(await contextoDeAccion(), entrada);
    programarEnvioInmediato(r.correoIds);
    return r;
  });
}

export async function cancelarAsignacionAccion(entrada: unknown): Promise<Resultado<{ ok: true; yaEstaba: boolean }>> {
  return comoResultado(async () => cancelarAsignacion(await contextoDeAccion(), entrada));
}

export async function recordarAccion(entrada: unknown): Promise<Resultado<ResultadoRecordar>> {
  return comoResultado(async () => {
    const r = await recordar(await contextoDeAccion(), entrada);
    programarEnvioInmediato(r.correoId ? [r.correoId] : []);
    return r;
  });
}

export async function reasignarAccion(entrada: unknown): Promise<Resultado<ResultadoReasignar>> {
  return comoResultado(async () => {
    const r = await reasignar(await contextoDeAccion(), entrada);
    programarEnvioInmediato(r.correoIds);
    return r;
  });
}

export async function abrirFichaAccion(entrada: unknown): Promise<Resultado<{ enCurso: number; leidas: number }>> {
  return comoResultado(async () => abrirFicha(await contextoDeAccion(), entrada));
}

export async function comentarAccion(entrada: unknown): Promise<Resultado<ResultadoComentar>> {
  return comoResultado(async () => comentar(await contextoDeAccion(), entrada));
}

export async function marcarNotificacionLeidaAccion(entrada: unknown): Promise<Resultado<{ ok: true }>> {
  return comoResultado(async () => marcarNotificacionLeida(await contextoDeAccion(), entrada));
}

export async function marcarTodasLeidasAccion(): Promise<Resultado<{ marcadas: number }>> {
  return comoResultado(async () => marcarTodasLeidas(await contextoDeAccion()));
}
