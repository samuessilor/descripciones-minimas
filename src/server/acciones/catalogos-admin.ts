/**
 * Catalogos administrables (M14, 10.4): unidades de medida, aspecto fisico, sugerencias de empaque,
 * restricciones (texto normativo) y partidas arancelarias. Reglas:
 *  - NADA se borra: un valor inactivo deja de ofrecerse pero se sigue mostrando donde ya se uso (10.4).
 *  - Un valor del catalogo no se renombra: las fichas guardaron el texto, y las semillas lo volverian a crear.
 *    Para corregir un valor se crea el correcto y se desactiva el otro.
 *  - Cada cambio queda en `auditoria` en la misma transaccion.
 */
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { catalogoItem, partidaArancelaria, restriccionPlantilla } from '@/db/esquema';
import { normalizarPartida } from '@/dominio/partida';
import { puede } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { ahoraDe, type Contexto } from '../politicas/actor';
import { ErrorAccion, esViolacionUnica } from './resultado';
import { parsear, textoLimpio } from './validacion';

function exigirAdmin(ctx: Contexto): void {
  if (!puede(ctx.actor, 'administrar')) {
    throw new ErrorAccion('SIN_PERMISO', 'Solo un administrador puede gestionar los catálogos.');
  }
}

export const CATALOGOS_ITEM = ['unidad_medida', 'aspecto_fisico', 'sugerencia_empaque'] as const;
export type CatalogoItemNombre = (typeof CATALOGOS_ITEM)[number];

// ---- Valores de lista ---------------------------------------------------------------------------

export const entradaGuardarItem = z.object({
  catalogo: z.enum(CATALOGOS_ITEM),
  valor: textoLimpio().pipe(z.string().trim().min(1, 'Escribe el valor.').max(100, 'El valor es muy largo (máximo 100 letras).')),
  /** Si el valor ya existe, `activo` lo activa o desactiva. Al crearlo, queda activo salvo que se diga lo contrario. */
  activo: z.boolean().optional(),
});

/**
 * Agrega un valor al final de su lista. Si ya existe (sin importar mayusculas), no lo duplica: lo reactiva.
 * Devuelve `{ id, creado }`.
 */
export async function guardarItemCatalogo(ctx: Contexto, entrada: unknown): Promise<{ id: string; creado: boolean }> {
  exigirAdmin(ctx);
  const e = parsear(entradaGuardarItem, entrada);
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    const existentes = await tx.select().from(catalogoItem).where(eq(catalogoItem.catalogo, e.catalogo));
    const igual = existentes.find((x) => x.valor.toLocaleLowerCase('es') === e.valor.toLocaleLowerCase('es'));
    if (igual) {
      const activo = e.activo ?? true;
      if (igual.activo !== activo) {
        await tx.update(catalogoItem).set({ activo }).where(eq(catalogoItem.id, igual.id));
        await auditar(tx, {
          usuarioId: ctx.actor.usuarioId,
          accion: 'guardar_catalogo',
          entidad: 'catalogo_item',
          entidadId: igual.id,
          detalle: { catalogo: e.catalogo, valor: igual.valor, activo },
          ip: ctx.ip,
          creadoEn: ahora,
        });
      }
      return { id: igual.id, creado: false };
    }
    const orden = existentes.reduce((m, x) => Math.max(m, x.orden), -1) + 1;
    const [n] = await tx
      .insert(catalogoItem)
      .values({ catalogo: e.catalogo, valor: e.valor, orden, activo: e.activo ?? true })
      .returning({ id: catalogoItem.id });
    if (!n) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo guardar el valor.');
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'guardar_catalogo',
      entidad: 'catalogo_item',
      entidadId: n.id,
      detalle: { catalogo: e.catalogo, valor: e.valor, creado: true },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { id: n.id, creado: true };
  });
}

export async function activarItemCatalogo(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const e = parsear(z.object({ id: z.uuid(), activo: z.boolean() }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [x] = await tx.select().from(catalogoItem).where(eq(catalogoItem.id, e.id)).for('update').limit(1);
    if (!x) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese valor.');
    if (x.activo === e.activo) return;
    if (!e.activo) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(catalogoItem)
        .where(and(eq(catalogoItem.catalogo, x.catalogo), eq(catalogoItem.activo, true)));
      if ((r?.n ?? 0) <= 1) {
        throw new ErrorAccion('VALIDACION', 'Es el único valor activo de esta lista. Agrega otro antes de desactivarlo.');
      }
    }
    await tx.update(catalogoItem).set({ activo: e.activo }).where(eq(catalogoItem.id, x.id));
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'guardar_catalogo',
      entidad: 'catalogo_item',
      entidadId: x.id,
      detalle: { catalogo: x.catalogo, valor: x.valor, activo: e.activo },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

/** Sube o baja un valor en su lista. Renumera la lista entera (de 10 en 10) para no depender de ordenes repetidos. */
export async function moverItemCatalogo(ctx: Contexto, entrada: unknown): Promise<{ ok: true }> {
  exigirAdmin(ctx);
  const e = parsear(z.object({ id: z.uuid(), direccion: z.enum(['arriba', 'abajo']) }), entrada);
  const ahora = ahoraDe(ctx);
  await ctx.db.transaction(async (tx) => {
    const [x] = await tx.select().from(catalogoItem).where(eq(catalogoItem.id, e.id)).limit(1);
    if (!x) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos ese valor.');
    const lista = await tx.select().from(catalogoItem).where(eq(catalogoItem.catalogo, x.catalogo));
    lista.sort((a, b) => a.orden - b.orden || a.valor.localeCompare(b.valor, 'es'));
    const i = lista.findIndex((y) => y.id === x.id);
    const j = e.direccion === 'arriba' ? i - 1 : i + 1;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j]!, lista[i]!];
    for (let k = 0; k < lista.length; k++) {
      const item = lista[k]!;
      if (item.orden !== (k + 1) * 10) await tx.update(catalogoItem).set({ orden: (k + 1) * 10 }).where(eq(catalogoItem.id, item.id));
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'guardar_catalogo',
      entidad: 'catalogo_item',
      entidadId: x.id,
      detalle: { catalogo: x.catalogo, valor: x.valor, movido: e.direccion },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

// ---- Restricciones ------------------------------------------------------------------------------

const CODIGO = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;

export const entradaGuardarRestriccion = z.object({
  /** Con `id` se edita; sin `id` se crea. El codigo no cambia una vez creado. */
  id: z.uuid().optional(),
  codigo: textoLimpio().pipe(z.string().trim().toUpperCase().regex(CODIGO, 'El código lleva letras mayúsculas, números y guiones. Ejemplo: RES-8501.31.20.00')),
  texto: textoLimpio().pipe(z.string().trim().min(5, 'Escribe el texto de la restricción.').max(4000, 'El texto es muy largo (máximo 4000 letras).')),
  activa: z.boolean().optional(),
});

/**
 * Crea o edita una restriccion. La ficha guarda una COPIA del texto aplicado (Apendice A): cambiar el texto aqui
 * vale para las fichas nuevas y no reescribe las ya clasificadas. El texto anterior queda en la auditoria.
 */
export async function guardarRestriccion(ctx: Contexto, entrada: unknown): Promise<{ id: string; creada: boolean }> {
  exigirAdmin(ctx);
  const e = parsear(entradaGuardarRestriccion, entrada);
  const ahora = ahoraDe(ctx);
  try {
    return await ctx.db.transaction(async (tx) => {
      if (e.id) {
        const [r] = await tx.select().from(restriccionPlantilla).where(eq(restriccionPlantilla.id, e.id)).for('update').limit(1);
        if (!r) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa restricción.');
        const activa = e.activa ?? r.activa;
        if (r.texto === e.texto && r.activa === activa) return { id: r.id, creada: false };
        if (!activa && r.activa) {
          const [u] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(partidaArancelaria)
            .where(and(eq(partidaArancelaria.restriccionId, r.id), eq(partidaArancelaria.activa, true)));
          if ((u?.n ?? 0) > 0) {
            throw new ErrorAccion('VALIDACION', `${r.codigo} se usa en ${u!.n} ${u!.n === 1 ? 'partida activa' : 'partidas activas'}. Cámbiales la restricción antes de desactivarla.`);
          }
        }
        await tx.update(restriccionPlantilla).set({ texto: e.texto, activa }).where(eq(restriccionPlantilla.id, r.id));
        await auditar(tx, {
          usuarioId: ctx.actor.usuarioId,
          accion: 'guardar_restriccion',
          entidad: 'restriccion_plantilla',
          entidadId: r.id,
          detalle: { codigo: r.codigo, activa, ...(r.texto !== e.texto ? { textoAnterior: r.texto } : {}) },
          ip: ctx.ip,
          creadoEn: ahora,
        });
        return { id: r.id, creada: false };
      }
      const [n] = await tx
        .insert(restriccionPlantilla)
        .values({ codigo: e.codigo, texto: e.texto, activa: e.activa ?? true })
        .returning({ id: restriccionPlantilla.id });
      if (!n) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo guardar la restricción.');
      await auditar(tx, {
        usuarioId: ctx.actor.usuarioId,
        accion: 'guardar_restriccion',
        entidad: 'restriccion_plantilla',
        entidadId: n.id,
        detalle: { codigo: e.codigo, creada: true },
        ip: ctx.ip,
        creadoEn: ahora,
      });
      return { id: n.id, creada: true };
    });
  } catch (err) {
    if (esViolacionUnica(err)) throw new ErrorAccion('DUPLICADO', `Ya existe una restricción con el código ${e.codigo}.`);
    throw err;
  }
}

// ---- Partidas arancelarias ----------------------------------------------------------------------

export const entradaGuardarPartida = z.object({
  /** `crear`: falla con DUPLICADO si ya existe. `editar`: falla con NO_ENCONTRADO si no existe. */
  modo: z.enum(['crear', 'editar']),
  codigo: z.string().trim().max(40),
  descripcion: textoLimpio().pipe(z.string().trim().max(300, 'La descripción es muy larga (máximo 300 letras).')).nullish(),
  restriccionId: z.uuid().nullish(),
  activa: z.boolean().optional(),
});

export async function guardarPartida(ctx: Contexto, entrada: unknown): Promise<{ codigo: string }> {
  exigirAdmin(ctx);
  const e = parsear(entradaGuardarPartida, entrada);
  const codigo = normalizarPartida(e.codigo);
  if (!codigo) throw new ErrorAccion('VALIDACION', 'La partida lleva 10 dígitos. Ejemplo: 8466.92.00.00');
  const ahora = ahoraDe(ctx);
  return ctx.db.transaction(async (tx) => {
    if (e.restriccionId) {
      const [r] = await tx.select({ activa: restriccionPlantilla.activa }).from(restriccionPlantilla).where(eq(restriccionPlantilla.id, e.restriccionId)).limit(1);
      if (!r) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa restricción.');
      if (!r.activa) throw new ErrorAccion('VALIDACION', 'Elige una restricción activa.');
    }
    const [actual] = await tx.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, codigo)).for('update').limit(1);
    if (e.modo === 'crear') {
      if (actual) throw new ErrorAccion('DUPLICADO', `La partida ${codigo} ya existe. Ábrela para editarla.`);
      await tx.insert(partidaArancelaria).values({
        codigo,
        descripcion: e.descripcion || null,
        restriccionId: e.restriccionId ?? null,
        // `semilla` = dato de referencia curado por la administracion; `aduana` queda para las que cree la agencia.
        origen: 'semilla',
        creadaPor: ctx.actor.usuarioId,
        activa: e.activa ?? true,
      });
    } else {
      if (!actual) throw new ErrorAccion('NO_ENCONTRADO', `No encontramos la partida ${codigo}.`);
      await tx
        .update(partidaArancelaria)
        .set({
          descripcion: e.descripcion || null,
            restriccionId: e.restriccionId ?? null,
          activa: e.activa ?? actual.activa,
        })
        .where(eq(partidaArancelaria.codigo, codigo));
    }
    await auditar(tx, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'guardar_partida',
      entidad: 'partida_arancelaria',
      entidadId: codigo,
      detalle: {
        modo: e.modo,
        descripcion: e.descripcion || null,
        restriccionId: e.restriccionId ?? null,
        activa: e.activa ?? actual?.activa ?? true,
        ...(actual ? { antes: { descripcion: actual.descripcion, restriccionId: actual.restriccionId, activa: actual.activa } } : {}),
      },
      ip: ctx.ip,
      creadoEn: ahora,
    });
    return { codigo };
  });
}
