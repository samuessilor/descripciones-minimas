/**
 * `resolverConflicto` (12.4, 9.5): quien guarda segundo elige entre
 *  - `dejar`: dejar el valor de la otra persona. El texto propio NUNCA se pierde: queda en
 *    `texto_descartado` (append-only), visible en "Ver mi texto descartado";
 *  - `usar_mio`: guardar el propio sobre el vigente (un `guardarCampo` con la version vigente);
 *    exige motivo y avisa al autor, como cualquier reemplazo de valor ajeno;
 *  - `combinar`: igual que `usar_mio` pero solo para campos de texto (el cliente rellena el campo
 *    con ambos textos y el usuario edita).
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { textoDescartado } from '@/db/esquema';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { aplicarEscritura } from './escritura';
import { verificarTamano } from './guardar-campo';
import { normalizarEntradaCampo, prepararEscritura } from './preparar';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const entradaResolverConflicto = z.object({
  referenciaId: z.uuid(),
  campo: z.string().min(1).max(120),
  opcion: z.enum(['dejar', 'usar_mio', 'combinar']),
  /** Lo que escribio la persona (obligatorio para las tres opciones). */
  valor: z.unknown(),
  motivo: textoLimpio().pipe(z.string().max(1000)).nullish(),
});

export interface ResultadoResolverConflicto {
  opcion: 'dejar' | 'usar_mio' | 'combinar';
  /** Version del campo despues de resolver. */
  version: number;
  /** `true` si el texto propio quedo guardado en `texto_descartado`. */
  textoConservado: boolean;
  versionFicha: number;
}

const TIPOS_TEXTO = new Set(['texto', 'texto_largo']);

function comoTexto(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'object' && valor !== null && 'texto' in valor && typeof (valor as { texto: unknown }).texto === 'string') {
    return (valor as { texto: string }).texto;
  }
  return JSON.stringify(valor ?? null);
}

export async function resolverConflicto(ctx: Contexto, entrada: unknown): Promise<ResultadoResolverConflicto> {
  const e = parsear(entradaResolverConflicto, entrada);
  verificarTamano(e.valor);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  return ctx.db.transaction(async (tx) => {
    const prep = await prepararEscritura(tx, actor, e.referenciaId, e.campo, ahora);
    const vigente = prep.ficha.datos?.[e.campo];
    const versionVigente = vigente?.n ?? 0;

    if (e.opcion === 'dejar') {
      const texto = comoTexto(e.valor);
      if (texto.trim() === '') throw new ErrorAccion('VALIDACION', 'No hay texto que conservar.');
      // La tabla es de solo escritura (nadie la borra): repetir «Dejar el otro» con el MISMO texto (doble clic, otra
      // pestana) no agrega otra copia, porque el texto ya esta conservado. Corre con la ficha bloqueada.
      const [yaGuardado] = await tx
        .select({ id: textoDescartado.id })
        .from(textoDescartado)
        .where(
          and(
            eq(textoDescartado.referenciaId, prep.ficha.id),
            eq(textoDescartado.campo, e.campo),
            eq(textoDescartado.usuarioId, actor.usuarioId),
            eq(textoDescartado.texto, texto),
          ),
        )
        .limit(1);
      if (!yaGuardado) {
        await tx.insert(textoDescartado).values({
          referenciaId: prep.ficha.id,
          campo: e.campo,
          usuarioId: actor.usuarioId,
          texto,
          motivoDescarte: 'conflicto_dejar_el_otro',
          creadoEn: ahora,
        });
      }
      return { opcion: 'dejar', version: versionVigente, textoConservado: true, versionFicha: prep.ficha.version };
    }

    if (e.opcion === 'combinar') {
      if (!TIPOS_TEXTO.has(prep.def.tipoDato)) {
        throw new ErrorAccion('VALIDACION', 'Combinar solo está disponible en campos de texto. Elige el de ella o el tuyo.');
      }
    }

    const valor = await normalizarEntradaCampo(tx, prep, e.valor, ahora);
    const r = await aplicarEscritura(tx, actor, prep.ficha, {
      campo: e.campo,
      valor,
      tipoEvento: 'fijar',
      versionEsperada: versionVigente,
      motivo: e.motivo,
      ahora,
    });
    return { opcion: e.opcion, version: r.version, textoConservado: false, versionFicha: r.ficha.version };
  });
}
