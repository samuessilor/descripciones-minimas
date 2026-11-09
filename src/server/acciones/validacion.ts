import { z } from 'zod';
import { AREAS } from '@/dominio/areas';
import { limpiarCaracteres } from '@/dominio/normalizacion';
import { ErrorAccion } from './resultado';

/**
 * Cadena de texto libre ya limpia de lo que Postgres no admite (U+0000, sustitutos UTF-16 sueltos). Se compone
 * con `.pipe(z.string().trim()...)` para que los limites y el "no vacio" se evaluen sobre el texto limpio.
 */
export const textoLimpio = () => z.string().transform(limpiarCaracteres);

/** Area de un usuario interno (C2): una del catalogo fijo, o ninguna (`''`/ausente = sin area). */
export const areaUsuario = () =>
  z
    .union([z.enum(AREAS), z.literal('')], 'Elige un área de la lista.')
    .nullish()
    .transform((a) => a || null);

/** Valida la entrada de una accion con zod; cualquier fallo es `VALIDACION` con las causas. */
export function parsear<S extends z.ZodType>(esquema: S, entrada: unknown): z.output<S> {
  const r = esquema.safeParse(entrada);
  if (!r.success) {
    throw new ErrorAccion('VALIDACION', 'Revisa los datos enviados.', {
      problemas: r.error.issues.map((i) => ({ ruta: i.path.join('.'), mensaje: i.message })),
    });
  }
  return r.data;
}
