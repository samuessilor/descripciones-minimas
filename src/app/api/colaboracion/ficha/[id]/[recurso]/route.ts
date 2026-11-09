/**
 * Lecturas de colaboracion de UNA ficha, todas filtradas para el actor (13.2):
 *   GET /api/colaboracion/ficha/<id>/contexto       datos del dialogo "Enviar a" y mi asignacion
 *   GET /api/colaboracion/ficha/<id>/destinatarios  personas a las que puedo enviarla
 *   GET /api/colaboracion/ficha/<id>/seguimiento    a quien esta enviada, desde cuando y como va el correo
 *   GET /api/colaboracion/ficha/<id>/historial      linea de tiempo (?campo=&antes=)
 *   GET /api/colaboracion/ficha/<id>/comentarios    comentarios visibles para mi (?campo=)
 *   GET /api/colaboracion/ficha/<id>/campos         quien puso cada valor y cuando
 * Ficha ajena o inexistente: 404, igual que la pagina.
 */
import {
  candidatosDestinoDe,
  comentariosDe,
  contextoEnvioDe,
  historialDeFichaDe,
  resumenCamposDe,
  seguimientoDeFicha,
} from '@/server/politicas/colaboracion';
import { ErrorAccion } from '@/server/acciones/resultado';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; recurso: string }> }): Promise<Response> {
  try {
    const { id, recurso } = await params;
    const ctx = await contextoDeAccion();
    if (!UUID.test(id)) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa referencia. Revisa el enlace o búscala por código.');
    const ahora = new Date();
    const q = new URL(request.url).searchParams;
    switch (recurso) {
      case 'contexto':
        return json(await contextoEnvioDe(ctx.db, ctx.actor, id, ahora));
      case 'destinatarios':
        return json(await candidatosDestinoDe(ctx.db, ctx.actor, id, ahora));
      case 'seguimiento':
        return json(await seguimientoDeFicha(ctx.db, ctx.actor, id, ahora));
      case 'historial': {
        const antes = Number(q.get('antes'));
        return json(
          await historialDeFichaDe(ctx.db, ctx.actor, id, ahora, {
            campo: q.get('campo'),
            antes: Number.isFinite(antes) && antes > 0 ? Math.trunc(antes) : null,
          }),
        );
      }
      case 'comentarios':
        return json(await comentariosDe(ctx.db, ctx.actor, id, ahora, { campo: q.get('campo') }));
      case 'campos':
        return json(await resumenCamposDe(ctx.db, ctx.actor, id, ahora));
      default:
        return json({ ok: false, codigo: 'NO_ENCONTRADO' }, 404);
    }
  } catch (e) {
    return respuestaDeError(e);
  }
}
