'use server';

/**
 * Server Actions de la ficha. Cada una vuelve a autenticar y autorizar (una Server Action es un
 * endpoint publico, 13.2 punto 3) y delega en los nucleos de `server/acciones`.
 */
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { comoResultado, ErrorAccion, type Resultado } from '@/server/acciones/resultado';
import { listarAdjuntos, retirarAdjunto, type AdjuntoVista } from '@/server/acciones/adjuntos';
import { corregirCodigo, type ResultadoCorregirCodigo } from '@/server/acciones/corregir-codigo';
import { crearReferencia, revisarCodigo, type RevisionCodigo, type ResultadoCrearReferencia } from '@/server/acciones/crear-referencia';
import { estadoFicha, latidoEdicion, terminarEdicion, type EstadoFicha } from '@/server/acciones/estado-ficha';
import { guardarCampo, type ResultadoGuardarCampo } from '@/server/acciones/guardar-campo';
import { restaurarCampo, type ResultadoRestaurarCampo } from '@/server/acciones/restaurar-campo';
import { resolverConflicto, type ResultadoResolverConflicto } from '@/server/acciones/resolver-conflicto';
import { historialDeCampo, vistaFicha, type EntradaHistorialVista, type FichaVista } from '@/server/politicas/referencias';
import { contextoDeAccion } from '@/server/sesion';

export async function guardarCampoAccion(entrada: unknown): Promise<Resultado<ResultadoGuardarCampo>> {
  return comoResultado(async () => guardarCampo(await contextoDeAccion(), entrada));
}

export async function restaurarCampoAccion(entrada: unknown): Promise<Resultado<ResultadoRestaurarCampo>> {
  return comoResultado(async () => restaurarCampo(await contextoDeAccion(), entrada));
}

export async function resolverConflictoAccion(entrada: unknown): Promise<Resultado<ResultadoResolverConflicto>> {
  return comoResultado(async () => resolverConflicto(await contextoDeAccion(), entrada));
}

const entradaHistorial = z.object({ referenciaId: z.uuid(), campo: z.string().min(1).max(120) });
const entradaVista = z.object({ referenciaId: z.uuid() });

function entradaValida<S extends z.ZodType>(esquema: S, entrada: unknown): z.output<S> {
  const r = esquema.safeParse(entrada);
  if (!r.success) throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.');
  return r.data;
}

export async function historialAccion(entrada: unknown): Promise<Resultado<EntradaHistorialVista[]>> {
  return comoResultado(async () => {
    const ctx = await contextoDeAccion();
    const e = entradaValida(entradaHistorial, entrada);
    return historialDeCampo(ctx.db, ctx.actor, e.referenciaId, e.campo, new Date());
  });
}

export async function vistaFichaAccion(entrada: unknown): Promise<Resultado<FichaVista>> {
  return comoResultado(async () => {
    const ctx = await contextoDeAccion();
    const e = entradaValida(entradaVista, entrada);
    return vistaFicha(ctx.db, ctx.actor, e.referenciaId, new Date());
  });
}

export async function latidoAccion(entrada: unknown): Promise<Resultado<{ hasta: string }>> {
  return comoResultado(async () => latidoEdicion(await contextoDeAccion(), entrada));
}

export async function terminarEdicionAccion(entrada: unknown): Promise<Resultado<{ ok: true }>> {
  return comoResultado(async () => terminarEdicion(await contextoDeAccion(), entrada));
}

export async function estadoFichaAccion(entrada: unknown): Promise<Resultado<EstadoFicha>> {
  return comoResultado(async () => estadoFicha(await contextoDeAccion(), entrada));
}

export async function listarAdjuntosAccion(entrada: unknown): Promise<Resultado<AdjuntoVista[]>> {
  return comoResultado(async () => {
    const ctx = await contextoDeAccion();
    const e = entradaValida(entradaVista, entrada);
    return listarAdjuntos(ctx.db, ctx.actor, e.referenciaId, new Date());
  });
}

export async function retirarAdjuntoAccion(entrada: unknown): Promise<Resultado<{ ok: true }>> {
  return comoResultado(async () => retirarAdjunto(await contextoDeAccion(), entrada as { adjuntoId: string; motivo: string }));
}

export async function corregirCodigoAccion(entrada: unknown): Promise<Resultado<ResultadoCorregirCodigo>> {
  return comoResultado(async () => corregirCodigo(await contextoDeAccion(), entrada));
}

export async function revisarCodigoAccion(entrada: unknown): Promise<Resultado<RevisionCodigo>> {
  return comoResultado(async () => revisarCodigo(await contextoDeAccion(), entrada));
}

export interface EstadoCrear {
  estado: 'inicial' | 'error';
  mensaje?: string;
  existenteId?: string;
  posiblesDuplicados?: ResultadoCrearReferencia['posiblesDuplicados'];
}

export async function crearReferenciaAccion(_previo: EstadoCrear, datos: FormData): Promise<EstadoCrear> {
  if (!datos.get('areaResponsable')) return { estado: 'error', mensaje: 'Elige el área responsable.' };
  const r = await comoResultado(async () =>
    crearReferencia(await contextoDeAccion(), {
      codigo: String(datos.get('codigo') ?? ''),
      nombreProducto: String(datos.get('nombreProducto') ?? ''),
      tipoProducto: String(datos.get('tipoProducto') ?? ''),
      // Desde el formulario el area es obligatoria (P4).
      areaResponsable: String(datos.get('areaResponsable') ?? ''),
      ...(datos.get('similarDe') ? { similarDe: String(datos.get('similarDe')) } : {}),
      ...(datos.get('fechaSolicitud') ? { fechaSolicitud: String(datos.get('fechaSolicitud')) } : {}),
    }),
  );
  if (r.ok) redirect(`/referencias/${r.data.id}`);
  const existente = r.codigo === 'DUPLICADO' ? (r.detalle as { id?: string } | undefined)?.id : undefined;
  return { estado: 'error', mensaje: r.mensaje, ...(existente ? { existenteId: existente } : {}) };
}
