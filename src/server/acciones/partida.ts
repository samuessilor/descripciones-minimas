/**
 * La partida arancelaria del lado aduana (SPEC 10.2, 12.4): se guarda como cualquier campo de la ficha (historial,
 * motivo si reemplaza un valor ajeno, conflicto) y, en la MISMA transaccion, copia a la ficha la restriccion que el
 * catalogo asocia a esa partida. Despues la aduana escribe las descripciones minimas y, si hace falta, edita la
 * restriccion: ambas son campos de texto normales (`guardarCampo`).
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { partidaArancelaria, restriccionPlantilla } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { estaVacio, valoresIguales } from '@/dominio/valores';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import { valoresVigentes, type FilaReferencia } from '../politicas/referencias';
import { auditarAduana } from './aduana-comun';
import { aplicarEscritura, ConflictoDeVersion } from './escritura';
import { conflictoComoError } from './guardar-campo';
import { normalizarEntradaCampo, prepararEscritura } from './preparar';
import { parsear, textoLimpio } from './validacion';

export interface InfoPartida {
  codigo: string;
  /** La partida esta en el catalogo (activa o no). */
  existe: boolean;
  origen: 'semilla' | 'aduana' | null;
  descripcion: string | null;
  /** Restriccion del catalogo, solo si la partida y la restriccion estan activas. */
  restriccion: { id: string; codigo: string; texto: string } | null;
}

/** Lo que el catalogo sabe de una partida. */
export async function infoDePartida(tx: Pick<Tx, 'select'>, codigo: string): Promise<InfoPartida> {
  const [p] = await tx.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, codigo)).limit(1);
  const origen = (p?.origen as 'semilla' | 'aduana' | undefined) ?? null;
  if (!p || !p.activa) return { codigo, existe: !!p, origen, descripcion: p?.descripcion ?? null, restriccion: null };
  let restriccion: InfoPartida['restriccion'] = null;
  if (p.restriccionId) {
    const [r] = await tx.select().from(restriccionPlantilla).where(eq(restriccionPlantilla.id, p.restriccionId)).limit(1);
    if (r && r.activa) restriccion = { id: r.id, codigo: r.codigo, texto: r.texto };
  }
  return { codigo, existe: true, origen, descripcion: p.descripcion, restriccion };
}

/**
 * Copia la restriccion de la partida a la ficha si el campo esta vacio o si todavia es la copia sin tocar de la
 * restriccion de la partida anterior (lo que la aduana ya edito no se pisa). Espera la ficha ya bloqueada.
 */
async function prellenarRestriccion(
  tx: Tx,
  actor: Actor,
  ficha: FilaReferencia,
  partida: string,
  partidaAnterior: string | null,
  ahora: Date,
): Promise<{ ficha: FilaReferencia; prellenada: boolean }> {
  const info = await infoDePartida(tx, partida);
  const actual = valoresVigentes(ficha).restricciones;
  let esCopiaAnterior = false;
  if (!estaVacio(actual) && partidaAnterior && partidaAnterior !== partida) {
    const anterior = await infoDePartida(tx, partidaAnterior);
    esCopiaAnterior = !!anterior.restriccion && valoresIguales(actual, anterior.restriccion.texto);
  }
  if (!info.restriccion) {
    // La partida nueva no trae restriccion: la copia sin tocar de la anterior ya no aplica y se vacia (A3 avisa al cerrar)
    if (!esCopiaAnterior) return { ficha, prellenada: false };
    const w = await aplicarEscritura(tx, actor, ficha, { campo: 'restricciones', valor: null, tipoEvento: 'sistema', versionEsperada: null, ahora });
    return { ficha: w.ficha, prellenada: false };
  }
  const reemplazar = estaVacio(actual) || esCopiaAnterior;
  if (!reemplazar || valoresIguales(actual, info.restriccion.texto)) return { ficha, prellenada: false };
  const w = await aplicarEscritura(tx, actor, ficha, {
    campo: 'restricciones',
    valor: info.restriccion.texto,
    tipoEvento: 'sistema',
    versionEsperada: null,
    ahora,
  });
  return { ficha: w.ficha, prellenada: true };
}

export const entradaFijarPartida = z.object({
  referenciaId: z.uuid(),
  partida: z.string().max(40),
  versionEsperada: z.number().int().min(0),
  motivo: textoLimpio().pipe(z.string().max(1000)).nullish(),
});

export interface ResultadoFijarPartida {
  escrito: boolean;
  version: number;
  valor: unknown;
  versionFicha: number;
  /** Se copio a la ficha la restriccion del catalogo de esta partida. */
  restriccionPrellenada: boolean;
}

/**
 * Guarda la partida y propone su restriccion. Si la partida es nueva en el catalogo se acepta igual como partida
 * libre: el cierre la da de alta con origen `aduana`.
 */
export async function fijarPartida(ctx: Contexto, entrada: unknown): Promise<ResultadoFijarPartida> {
  const e = parsear(entradaFijarPartida, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  try {
    return await ctx.db.transaction(async (tx) => {
      const prep = await prepararEscritura(tx, actor, e.referenciaId, 'partida_arancelaria', ahora);
      const valor = (await normalizarEntradaCampo(tx, prep, e.partida, ahora)) as string | null;
      const anterior = (prep.ficha.datos?.partida_arancelaria?.v as string | null | undefined) ?? null;
      const r = await aplicarEscritura(tx, actor, prep.ficha, {
        campo: 'partida_arancelaria',
        valor,
        tipoEvento: 'fijar',
        versionEsperada: e.versionEsperada,
        motivo: e.motivo,
        ahora,
      });

      let ficha = r.ficha;
      let restriccionPrellenada = false;
      if (valor) {
        const p = await prellenarRestriccion(tx, actor, ficha, valor, anterior, ahora);
        ficha = p.ficha;
        restriccionPrellenada = p.prellenada;
      }
      if (r.escrito) {
        await auditarAduana(tx, {
          usuarioId: actor.usuarioId,
          accion: 'cambiar_partida',
          entidad: 'referencia',
          entidadId: ficha.id,
          detalle: { codigo: ficha.codigo, de: anterior, a: valor, restriccionPrellenada },
          ip: ctx.ip,
          creadoEn: ahora,
        });
      }
      return { escrito: r.escrito, version: r.version, valor, versionFicha: ficha.version, restriccionPrellenada };
    });
  } catch (err) {
    if (err instanceof ConflictoDeVersion) throw await conflictoComoError(ctx, actor, err);
    throw err;
  }
}
