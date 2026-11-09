/**
 * `GET /api/aduana/[id]/vista`: la zona de la aduana de una ficha (partida, descripciones minimas, restricciones, cierre).
 * Es una lectura: va por GET y no por Server Action para que el sondeo no haga cola delante de un guardado
 * (Next ejecuta las Server Actions de un mismo cliente una por una). Misma autenticacion, permisos y aislamiento
 * de agencia que antes: los decide `vistaAduana` con el Actor de la sesion.
 */
import { z } from 'zod';
import { ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { vistaAduana } from '@/server/politicas/aduana';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const e = z.uuid().safeParse((await params).id);
    if (!e.success) throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.');
    return json(await vistaAduana(ctx.db, ctx.actor, e.data, new Date()));
  } catch (e) {
    return respuestaDeError(e);
  }
}
