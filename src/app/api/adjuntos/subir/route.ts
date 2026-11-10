/**
 * `POST /api/adjuntos/subir` (multipart: `referenciaId`, `archivo`): subida de fotos (SPEC 13.5). La validacion
 * del contenido real, el reprocesado con sharp y el tope de 5 fotos viven en `subirAdjunto`; aqui solo se corta
 * pronto lo que ya es demasiado grande.
 */
import { MAX_BYTES_FOTO } from '@/server/almacen/imagen';
import { subirAdjunto } from '@/server/acciones/adjuntos';
import { ErrorAccion } from '@/server/acciones/resultado';
import { fotosActivas } from '@/server/config';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';

/** Holgura para los bordes del multipart. */
const MAX_CUERPO = MAX_BYTES_FOTO + 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    if (!fotosActivas()) {
      throw new ErrorAccion('VALIDACION', 'La carga de fotos está desactivada por ahora.');
    }
    const largo = Number(request.headers.get('content-length') ?? '0');
    if (Number.isFinite(largo) && largo > MAX_CUERPO) {
      throw new ErrorAccion('VALIDACION', 'Esa foto pesa más de 4 MB. Prueba con una más liviana.');
    }
    let datos: FormData;
    try {
      datos = await request.formData();
    } catch {
      throw new ErrorAccion('VALIDACION', 'No pudimos leer el archivo enviado. Elige la foto otra vez.');
    }
    const referenciaId = datos.get('referenciaId');
    const archivo = datos.get('archivo');
    if (typeof referenciaId !== 'string' || !(archivo instanceof File)) {
      throw new ErrorAccion('VALIDACION', 'Elige una foto para adjuntar.');
    }
    if (archivo.size > MAX_BYTES_FOTO) {
      const mb = (archivo.size / (1024 * 1024)).toFixed(1).replace('.', ',');
      throw new ErrorAccion('VALIDACION', `Esa foto pesa ${mb} MB y el máximo es 4 MB. Prueba con una más liviana.`);
    }
    const bytes = new Uint8Array(await archivo.arrayBuffer());
    const adjunto = await subirAdjunto(ctx, { referenciaId, archivo: bytes, nombre: archivo.name });
    return json({ ok: true, data: adjunto }, 201);
  } catch (e) {
    return respuestaDeError(e);
  }
}
