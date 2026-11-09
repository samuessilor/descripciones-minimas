/**
 * `corregirCodigo` (SPEC 6.3, 12.4, CA-34): el creador (mientras la ficha no este CLASIFICADA) o un admin
 * corrigen el codigo de una referencia, SIEMPRE con motivo. Verifica que el codigo nuevo no sea de otra ficha
 * (archivada o no), reindexa `codigo_norm` y `texto_busqueda` (lo hace `aplicarEscritura`) y deja el cambio en
 * el historial del campo `codigo` y en `auditoria`.
 */
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { referencia } from '@/db/esquema';
import { motivoVisible, normalizarCodigo } from '@/dominio/normalizacion';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { cargarReferenciaBloqueada } from '../politicas/referencias';
import { aplicarEscritura } from './escritura';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const entradaCorregirCodigo = z.object({
  referenciaId: z.uuid(),
  codigoNuevo: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el código correcto.').max(80, 'El código admite máximo 80 caracteres.')),
  motivo: textoLimpio().pipe(z.string().max(1000)),
});

export interface ResultadoCorregirCodigo {
  ok: true;
  codigo: string;
  /** `false` si el codigo escrito era igual al vigente. */
  cambio: boolean;
}

export async function corregirCodigo(ctx: Contexto, entrada: unknown): Promise<ResultadoCorregirCodigo> {
  const e = parsear(entradaCorregirCodigo, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  const motivo = motivoVisible(e.motivo);
  const codigoNorm = normalizarCodigo(e.codigoNuevo);
  if (codigoNorm === '') throw new ErrorAccion('VALIDACION', 'Escribe el código correcto.');

  try {
    return await ctx.db.transaction(async (tx) => {
      const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
      const estado = ficha.estado as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA';
      if (ficha.archivadaEn !== null) {
        throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia está archivada y no se edita.');
      }
      if (!puede(actor, 'corregir_codigo', { esCreador: ficha.creadaPor === actor.usuarioId, estadoFicha: estado })) {
        throw new ErrorAccion(
          estado === 'CLASIFICADA' ? 'FICHA_CERRADA' : 'SIN_PERMISO',
          estado === 'CLASIFICADA'
            ? 'Esta referencia está clasificada. Pide a un administrador que corrija el código.'
            : 'Solo quien creó la referencia o un administrador pueden corregir el código.',
        );
      }
      if (!motivo) throw new ErrorAccion('FALTA_MOTIVO', 'Cuéntanos por qué corriges el código. Queda en el historial.');

      const [otra] = await tx
        .select({ id: referencia.id, codigo: referencia.codigo, estado: referencia.estado, archivadaEn: referencia.archivadaEn })
        .from(referencia)
        .where(and(eq(referencia.codigoNorm, codigoNorm), ne(referencia.id, ficha.id)))
        .limit(1);
      if (otra) throw errorDuplicadoCodigo(otra);

      if (e.codigoNuevo === ficha.codigo) return { ok: true as const, codigo: ficha.codigo, cambio: false };

      const vigente = ficha.datos?.codigo?.n ?? null;
      await aplicarEscritura(tx, actor, ficha, {
        campo: 'codigo',
        valor: e.codigoNuevo,
        tipoEvento: 'fijar',
        versionEsperada: vigente,
        motivo,
        ahora,
      });
      await auditar(tx, {
        usuarioId: actor.usuarioId,
        accion: 'corregir_codigo',
        entidad: 'referencia',
        entidadId: ficha.id,
        detalle: { de: ficha.codigo, a: e.codigoNuevo, motivo },
        ip: ctx.ip,
        creadoEn: ahora,
      });
      return { ok: true as const, codigo: e.codigoNuevo, cambio: true };
    });
  } catch (err) {
    // Dos correcciones o una creacion simultanea con el mismo codigo: el indice unico decide.
    if (esViolacionUnica(err, 'referencia_codigo_norm_unico')) {
      const [otra] = await ctx.db
        .select({ id: referencia.id, codigo: referencia.codigo, estado: referencia.estado, archivadaEn: referencia.archivadaEn })
        .from(referencia)
        .where(eq(referencia.codigoNorm, codigoNorm))
        .limit(1);
      if (otra) throw errorDuplicadoCodigo(otra);
    }
    throw err;
  }
}

const ETIQUETA_ESTADO: Record<string, string> = { BORRADOR: 'Borrador', EN_GESTION: 'En gestión', CLASIFICADA: 'Clasificada' };

function errorDuplicadoCodigo(f: { id: string; codigo: string; estado: string; archivadaEn: Date | null }): ErrorAccion {
  const archivada = f.archivadaEn !== null;
  return new ErrorAccion(
    'DUPLICADO',
    archivada
      ? 'Ese código ya es de una referencia archivada. Pide a un administrador que la restaure.'
      : `Ese código ya es de la referencia ${f.codigo} (${ETIQUETA_ESTADO[f.estado] ?? f.estado}). Ábrela en vez de repetirlo.`,
    { id: f.id, codigo: f.codigo, estado: f.estado, archivada },
  );
}
