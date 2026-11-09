/**
 * `restaurarCampo` (12.4, 9.6): cualquier version anterior se repone creando un hecho NUEVO
 * (`restaurar`); no reescribe nada. Si el valor vigente es de otra persona exige motivo y avisa a
 * su autor, y no se puede reponer una version vacia sobre un valor ajeno (RV-06): todo eso lo
 * impone `aplicarEscritura`, igual que para `guardarCampo`.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { campoHistorial } from '@/db/esquema';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { condicionHistorialVisible } from '../politicas/historial-visible';
import { aplicarEscritura, ConflictoDeVersion } from './escritura';
import { conflictoComoError } from './guardar-campo';
import { prepararEscritura } from './preparar';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const entradaRestaurarCampo = z.object({
  referenciaId: z.uuid(),
  campo: z.string().min(1).max(120),
  historialId: z.number().int().positive(),
  motivo: textoLimpio().pipe(z.string().max(1000)).nullish(),
});

export interface ResultadoRestaurarCampo {
  escrito: boolean;
  version: number;
  valor: unknown;
  versionFicha: number;
}

export async function restaurarCampo(ctx: Contexto, entrada: unknown): Promise<ResultadoRestaurarCampo> {
  const e = parsear(entradaRestaurarCampo, entrada);
  // La clasificacion finalizada solo la escriben finalizar y reabrir: restaurarla saltaria las guardas del cierre
  if (e.campo === 'clasificacion_finalizada') {
    throw new ErrorAccion('VALIDACION', 'Para cerrar o reabrir la clasificación usa los botones de la zona de la aduana.');
  }
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  try {
    return await ctx.db.transaction(async (tx) => {
      const prep = await prepararEscritura(tx, actor, e.referenciaId, e.campo, ahora);

      const [version] = await tx
        .select()
        .from(campoHistorial)
        .where(
          and(
            eq(campoHistorial.id, e.historialId),
            eq(campoHistorial.referenciaId, prep.ficha.id),
            eq(campoHistorial.campo, e.campo),
            // Una cuenta de agencia solo ve (y por tanto solo puede restaurar) eventos de su propia organizacion en
            // campos de aduana: sin esto, un id adivinado devolveria el texto que el historial le oculta.
            condicionHistorialVisible(actor),
          ),
        )
        .limit(1);
      if (!version) throw new ErrorAccion('NO_ENCONTRADO', 'Esa versión no existe en el historial de este campo.');

      const vigente = prep.ficha.datos?.[e.campo];
      const r = await aplicarEscritura(tx, actor, prep.ficha, {
        campo: e.campo,
        valor: version.valor,
        tipoEvento: 'restaurar',
        versionEsperada: vigente?.n ?? 0, // se repone sobre lo ultimo que haya, bajo el bloqueo de la fila
        restauraId: version.id,
        motivo: e.motivo,
        ahora,
      });

      if (r.escrito) {
        await auditar(tx, {
          usuarioId: actor.usuarioId,
          accion: 'restaurar',
          entidad: 'referencia',
          entidadId: prep.ficha.id,
          detalle: {
            campo: e.campo,
            historialId: version.id,
            versionRestaurada: version.versionCampo,
            versionNueva: r.version,
            motivo: e.motivo ?? null,
          },
          ip: ctx.ip,
          creadoEn: ahora,
        });
      }
      return { escrito: r.escrito, version: r.version, valor: version.valor, versionFicha: r.ficha.version };
    });
  } catch (err) {
    if (err instanceof ConflictoDeVersion) throw await conflictoComoError(ctx, actor, err);
    throw err;
  }
}
