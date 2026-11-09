/**
 * `GET /api/adjuntos/[id]`: sirve una foto con control de sesion y permiso (SPEC 13.5): solo si la ficha es
 * visible para quien pide. `Content-Disposition: inline` (son solo imagenes), `X-Content-Type-Options: nosniff`
 * y `Cache-Control: private`. Nunca se expone la URL del almacen. `?m=1` devuelve la miniatura.
 */
import { leerAdjunto } from '@/server/acciones/adjuntos';
import { respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await params;
    const ctx = await contextoDeAccion();
    const miniatura = new URL(request.url).searchParams.get('m') === '1';
    const f = await leerAdjunto(ctx, id, { miniatura });
    const nombreSeguro = f.nombre.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'foto';
    return new Response(Buffer.from(f.bytes), {
      status: 200,
      headers: {
        'content-type': f.mime,
        'content-length': String(f.bytes.length),
        'content-disposition': `inline; filename="${nombreSeguro}"`,
        'x-content-type-options': 'nosniff',
        // El contenido de un id no cambia nunca: el navegador la guarda una hora (menos invocaciones y menos lecturas del
        // Blob, que en el plan gratuito tiene tope). El permiso se comprueba en cada peticion que llega al servidor, asi que
        // una foto retirada o un acceso vencido siguen viendose, en un navegador que ya la tenia, a lo sumo esa hora.
        'cache-control': 'private, max-age=3600',
        'content-security-policy': "default-src 'none'; img-src 'self'; sandbox",
      },
    });
  } catch (e) {
    return respuestaDeError(e);
  }
}
