/**
 * `guardarCampo` (12.4): UNA transaccion que autentica y autoriza (rol, organizacion, grupo del
 * campo, visibilidad de la ficha, ficha no cerrada), valida con zod, bloquea la ficha
 * (`SELECT ... FOR UPDATE`), compara la version del campo, exige motivo si reemplaza o vacia un
 * valor ajeno, inserta en `campo_historial`, actualiza `datos`, columnas promovidas, `texto_busqueda`
 * y `version`, y avisa al autor. Un valor identico al vigente no escribe (idempotencia).
 */
import { z } from 'zod';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import { describirAutor } from '../politicas/referencias';
import { aplicarEscritura, ConflictoDeVersion } from './escritura';
import { normalizarEntradaCampo, prepararEscritura } from './preparar';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

const MAX_VALOR_BYTES = 20_000;

export const entradaGuardarCampo = z.object({
  referenciaId: z.uuid(),
  campo: z.string().min(1).max(120),
  valor: z.unknown(),
  versionEsperada: z.number().int().min(0),
  motivo: textoLimpio().pipe(z.string().max(1000)).nullish(),
});
export type EntradaGuardarCampo = z.input<typeof entradaGuardarCampo>;

export interface ResultadoGuardarCampo {
  /** `false` si el valor era identico al vigente. */
  escrito: boolean;
  /** Version del campo tras guardar (la que debe enviar el cliente como `versionEsperada` despues). */
  version: number;
  /** Valor normalizado que quedo (p. ej. `{valor:'156', expresion:'13x12'}`). */
  valor: unknown;
  /** `referencia.version`, para el polling de `estadoFicha`. */
  versionFicha: number;
}

export interface DetalleConflicto {
  vigente: { valor: unknown; version: number; autor: string; instante: string };
}

export function verificarTamano(valor: unknown): void {
  let largo = 0;
  try {
    largo = JSON.stringify(valor ?? null).length;
  } catch {
    throw new ErrorAccion('VALIDACION', 'El valor enviado no es válido.');
  }
  if (largo > MAX_VALOR_BYTES) throw new ErrorAccion('VALIDACION', 'El valor enviado es demasiado grande.');
}

/** Convierte el choque de version interno en el error CONFLICTO con el valor vigente y su autor. */
export async function conflictoComoError(ctx: Contexto, actor: Actor, c: ConflictoDeVersion): Promise<ErrorAccion> {
  const v = c.vigente;
  const detalle: DetalleConflicto = {
    vigente: {
      valor: v?.v ?? null,
      version: v?.n ?? 0,
      autor: v ? await describirAutor(ctx.db, actor, v.a) : 'Alguien',
      instante: v?.t ?? new Date(0).toISOString(),
    },
  };
  // Texto del SPEC 10.5 ("Brian ya guardó este campo. Tu texto no se perdió: [Ver mi texto] [Usar el mío]
  // [Combinar]"): las tres acciones son botones de la interfaz, no van dentro de la frase ni fijan genero.
  const propio = v?.a === actor.usuarioId;
  const mensaje = propio
    ? 'Ya guardaste este campo desde otra pestaña. Tu texto no se perdió: puedes verlo, usarlo o combinarlo.'
    : `${detalle.vigente.autor} ya guardó este campo. Tu texto no se perdió: puedes verlo, usarlo o combinarlo.`;
  return new ErrorAccion('CONFLICTO', mensaje, detalle);
}

export async function guardarCampo(ctx: Contexto, entrada: unknown): Promise<ResultadoGuardarCampo> {
  const e = parsear(entradaGuardarCampo, entrada);
  verificarTamano(e.valor);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  try {
    return await ctx.db.transaction(async (tx) => {
      const prep = await prepararEscritura(tx, actor, e.referenciaId, e.campo, ahora);
      const valor = await normalizarEntradaCampo(tx, prep, e.valor, ahora);
      const r = await aplicarEscritura(tx, actor, prep.ficha, {
        campo: e.campo,
        valor,
        tipoEvento: 'fijar',
        versionEsperada: e.versionEsperada,
        motivo: e.motivo,
        ahora,
      });
      return { escrito: r.escrito, version: r.version, valor, versionFicha: r.ficha.version };
    });
  } catch (err) {
    if (err instanceof ConflictoDeVersion) throw await conflictoComoError(ctx, actor, err);
    throw err;
  }
}
