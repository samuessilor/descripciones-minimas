/**
 * Fotos de la ficha (SPEC 13.5, 10.2, 9 punto 7): `subirAdjunto`, `retirarAdjunto`, `leerAdjunto` y
 * `listarAdjuntos`.
 *  - el tipo se decide por la firma real del archivo; se reprocesa con sharp (sin EXIF, 2000 px, miniatura);
 *  - maximo 5 fotos vivas por referencia, 4 MB por archivo, 30 subidas por hora y persona;
 *  - NO hay borrado: retirar una foto pone `retirado_*` con motivo y deja el archivo; queda en `auditoria`;
 *  - solo se retira la foto propia (un admin puede retirar cualquiera, con motivo);
 *  - la lectura pasa SIEMPRE por la visibilidad de la ficha: nunca se expone una URL publica del almacen.
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { adjunto, referencia, usuario } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { motivoVisible } from '@/dominio/normalizacion';
import { esGestor, puede, type TipoOrganizacion } from '@/dominio/permisos';
import { auditar } from '../auditoria';
import { limitarTasa, REGLAS_TASA } from '../limite-tasa';
import { claveMiniatura, getAlmacen } from '../almacen';
import { detectarTipoImagen, ImagenInvalida, MAX_BYTES_FOTO, procesarImagen } from '../almacen/imagen';
import type { Almacen } from '../almacen/tipos';
import { ahoraDe, type Actor, type Contexto } from '../politicas/actor';
import {
  cargarReferenciaBloqueada,
  cargarReferenciaVisible,
  nombreDeAutor,
  type FilaReferencia,
} from '../politicas/referencias';
import { ErrorAccion } from './resultado';
import { parsear, textoLimpio } from './validacion';

export const MAX_FOTOS = 5;

export interface AdjuntoVista {
  id: string;
  referenciaId: string;
  nombre: string;
  mime: string;
  tamanoBytes: number;
  subidoPor: string;
  esPropio: boolean;
  subidoEn: string;
  /** Rutas que pasan por permiso (`/api/adjuntos/[id]`); jamas una URL del almacen. */
  url: string;
  urlMiniatura: string;
  retirado: boolean;
  retiradoPor: string | null;
  retiradoEn: string | null;
  motivoRetiro: string | null;
}

const entradaSubir = z.object({
  referenciaId: z.uuid(),
  nombre: z.string().max(500),
});

/** Nombre mostrable: sin rutas ni caracteres de control, 120 como maximo. */
export function limpiarNombreArchivo(nombre: string): string {
  const base = (nombre.split(/[\\/]/).pop() ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  const recortado = [...base].slice(0, 120).join('');
  return recortado === '' ? 'foto' : recortado;
}

function estadoDe(f: FilaReferencia) {
  return f.estado as 'BORRADOR' | 'EN_GESTION' | 'CLASIFICADA';
}

function exigirPuedeAdjuntar(actor: Actor, f: FilaReferencia): void {
  if (f.archivadaEn !== null || estadoDe(f) === 'CLASIFICADA') {
    throw new ErrorAccion('FICHA_CERRADA', 'Esta referencia está clasificada y no se edita. Puedes solicitar su reapertura.');
  }
  if (!puede(actor, 'adjuntar_foto', { estadoFicha: estadoDe(f) })) {
    throw new ErrorAccion('SIN_PERMISO', 'No tienes permiso para adjuntar fotos en esta referencia.');
  }
}

interface InfoUsuario {
  nombre: string;
  organizacionId: string;
  organizacionTipo: string;
}

function quien(actor: Actor, u: InfoUsuario | undefined): string {
  return nombreDeAutor(
    actor,
    u ? { id: '', nombre: u.nombre, organizacionId: u.organizacionId, organizacionTipo: u.organizacionTipo as TipoOrganizacion } : undefined,
  );
}

export function aVista(
  actor: Actor,
  a: typeof adjunto.$inferSelect,
  autor: InfoUsuario | undefined,
  retiro: InfoUsuario | undefined,
): AdjuntoVista {
  return {
    id: a.id,
    referenciaId: a.referenciaId,
    nombre: a.nombreOriginal,
    mime: a.mime,
    tamanoBytes: a.tamanoBytes,
    subidoPor: quien(actor, autor),
    esPropio: a.subidoPor === actor.usuarioId,
    subidoEn: a.subidoEn.toISOString(),
    url: `/api/adjuntos/${a.id}`,
    urlMiniatura: `/api/adjuntos/${a.id}?m=1`,
    retirado: a.retiradoEn !== null,
    retiradoPor: a.retiradoPor ? quien(actor, retiro) : null,
    retiradoEn: a.retiradoEn?.toISOString() ?? null,
    motivoRetiro: a.motivoRetiro,
  };
}

/** Fotos de una ficha visible para el actor, de la mas vieja a la mas nueva (las retiradas al final). */
export async function listarAdjuntos(ej: Ejecutor, actor: Actor, referenciaId: string, ahora: Date): Promise<AdjuntoVista[]> {
  await cargarReferenciaVisible(ej, actor, referenciaId, ahora);
  const filas = await ej
    .select()
    .from(adjunto)
    .where(eq(adjunto.referenciaId, referenciaId))
    .orderBy(asc(sql`${adjunto.retiradoEn} is not null`), asc(adjunto.subidoEn));
  if (filas.length === 0) return [];
  const ids = [...new Set(filas.flatMap((f) => [f.subidoPor, f.retiradoPor].filter((x): x is string => !!x)))];
  const usuarios = await ej
    .select({ id: usuario.id, nombre: usuario.nombre, organizacionId: usuario.organizacionId, organizacionTipo: usuario.organizacionTipo })
    .from(usuario)
    .where(inArray(usuario.id, ids));
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  return filas.map((f) => aVista(actor, f, porId.get(f.subidoPor), f.retiradoPor ? porId.get(f.retiradoPor) : undefined));
}

export interface EntradaSubirAdjunto {
  referenciaId: string;
  archivo: Uint8Array;
  nombre: string;
  /** Almacen inyectable (pruebas). */
  almacen?: Almacen;
}

export async function subirAdjunto(ctx: Contexto, entrada: EntradaSubirAdjunto): Promise<AdjuntoVista> {
  const e = parsear(entradaSubir, { referenciaId: entrada.referenciaId, nombre: entrada.nombre });
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;

  // 1. Permiso y visibilidad ANTES de gastar CPU en la imagen (404 si la ficha no es visible para el actor).
  exigirPuedeAdjuntar(actor, await cargarReferenciaVisible(ctx.db, actor, e.referenciaId, ahora));

  const tasa = await limitarTasa(ctx.db, `subir:${actor.usuarioId}`, REGLAS_TASA.subirArchivo, ahora);
  if (!tasa.permitido) {
    throw new ErrorAccion('LIMITE_TASA', 'Subiste muchas fotos en poco tiempo. Espera unos minutos y vuelve a intentar.', {
      reintentarEnMs: tasa.reintentarEnMs,
    });
  }

  // 2. Contenido real del archivo.
  const bytes = entrada.archivo;
  if (bytes.length === 0) throw new ErrorAccion('VALIDACION', 'El archivo está vacío. Elige la foto otra vez.');
  if (bytes.length > MAX_BYTES_FOTO) {
    const mb = (bytes.length / (1024 * 1024)).toFixed(1).replace('.', ',');
    throw new ErrorAccion('VALIDACION', `Esa foto pesa ${mb} MB y el máximo es 4 MB. Prueba con una más liviana.`);
  }
  const tipo = detectarTipoImagen(bytes);
  if (!tipo) throw new ErrorAccion('VALIDACION', 'Solo se aceptan fotos JPG, PNG o WebP. Ese archivo no es una de ellas.');
  let imagen;
  try {
    imagen = await procesarImagen(bytes, tipo);
  } catch (err) {
    if (err instanceof ImagenInvalida) {
      throw new ErrorAccion('VALIDACION', 'No pudimos leer esa foto. Prueba con otra o vuelve a sacarla.');
    }
    throw err;
  }

  // 3. Transaccion: la ficha se bloquea para que el tope de 5 fotos no se salte con dos subidas a la vez.
  const almacen = entrada.almacen ?? getAlmacen();
  const clave = `${randomUUID()}.${imagen.extension}`;
  const nombre = limpiarNombreArchivo(e.nombre);

  const fila = await ctx.db.transaction(async (tx) => {
    const ficha = await cargarReferenciaBloqueada(tx, actor, e.referenciaId, ahora);
    exigirPuedeAdjuntar(actor, ficha);
    const [conteo] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(adjunto)
      .where(and(eq(adjunto.referenciaId, ficha.id), isNull(adjunto.retiradoEn)));
    if ((conteo?.n ?? 0) >= MAX_FOTOS) {
      throw new ErrorAccion('VALIDACION', `Ya hay ${MAX_FOTOS} fotos en esta referencia, que es el máximo. Retira una para subir otra.`);
    }
    const [creada] = await tx
      .insert(adjunto)
      .values({
        referenciaId: ficha.id,
        tipo: 'foto',
        nombreOriginal: nombre,
        mime: imagen.mime,
        tamanoBytes: imagen.principal.length,
        sha256: createHash('sha256').update(imagen.principal).digest('hex'),
        storageKey: clave,
        subidoPor: actor.usuarioId,
        subidoEn: ahora,
      })
      .returning();
    if (!creada) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo guardar la foto.');
    // Si el almacen falla, la transaccion se revierte y no queda una fila sin archivo.
    await almacen.guardar(clave, imagen.principal, imagen.mime);
    await almacen.guardar(claveMiniatura(clave), imagen.miniatura, 'image/webp');
    // La foto no es parte de `datos`: se sube la version para que quien tiene la ficha abierta la vea (sondeo).
    await tx
      .update(referencia)
      .set({ version: sql`${referencia.version} + 1`, actualizadaEn: ahora })
      .where(eq(referencia.id, ficha.id));
    return creada;
  });

  return aVista(
    actor,
    fila,
    { nombre: actor.nombre, organizacionId: actor.organizacionId, organizacionTipo: actor.organizacionTipo },
    undefined,
  );
}

const entradaRetirar = z.object({
  adjuntoId: z.uuid(),
  motivo: textoLimpio().pipe(z.string().max(500)),
});

/** Retira la foto (no la borra). Propia, o cualquiera si es admin; el motivo es obligatorio y queda en auditoria. */
export async function retirarAdjunto(ctx: Contexto, entrada: { adjuntoId: string; motivo: string }): Promise<{ ok: true }> {
  const e = parsear(entradaRetirar, entrada);
  const ahora = ahoraDe(ctx);
  const actor = ctx.actor;
  const motivo = motivoVisible(e.motivo);
  if (!motivo) throw new ErrorAccion('FALTA_MOTIVO', 'Cuéntanos por qué retiras la foto.');

  await ctx.db.transaction(async (tx) => {
    const [a] = await tx.select().from(adjunto).where(eq(adjunto.id, e.adjuntoId)).limit(1);
    if (!a) throw new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa foto.');
    const ficha = await cargarReferenciaBloqueada(tx, actor, a.referenciaId, ahora);
    exigirPuedeAdjuntar(actor, ficha);
    if (a.retiradoEn) return;
    if (a.subidoPor !== actor.usuarioId && !esGestor(actor.rol)) {
      throw new ErrorAccion('SIN_PERMISO', 'La foto la subió otra persona y no se retira desde aquí. Escríbele o pídele a un administrador o a la supervisora general que lo haga.');
    }
    await tx
      .update(adjunto)
      .set({ retiradoEn: ahora, retiradoPor: actor.usuarioId, motivoRetiro: motivo })
      .where(eq(adjunto.id, a.id));
    await tx
      .update(referencia)
      .set({ version: sql`${referencia.version} + 1`, actualizadaEn: ahora })
      .where(eq(referencia.id, ficha.id));
    await auditar(tx, {
      usuarioId: actor.usuarioId,
      accion: 'retirar_adjunto',
      entidad: 'adjunto',
      entidadId: a.id,
      detalle: { referenciaId: ficha.id, motivo },
      ip: ctx.ip,
      creadoEn: ahora,
    });
  });
  return { ok: true };
}

export interface ArchivoAdjunto {
  bytes: Uint8Array;
  mime: string;
  nombre: string;
}

/**
 * Lee los bytes de una foto para `/api/adjuntos/[id]`. 404 si la ficha no es visible para el actor (la
 * agencia ajena no distingue "no existe" de "no es tuya") o si la foto fue retirada (salvo para un admin).
 */
export async function leerAdjunto(
  ctx: Contexto,
  adjuntoId: string,
  opciones: { miniatura: boolean; almacen?: Almacen },
): Promise<ArchivoAdjunto> {
  const ahora = ahoraDe(ctx);
  const noExiste = () => new ErrorAccion('NO_ENCONTRADO', 'No encontramos esa foto.');
  if (!z.uuid().safeParse(adjuntoId).success) throw noExiste();
  const [a] = await ctx.db.select().from(adjunto).where(eq(adjunto.id, adjuntoId)).limit(1);
  if (!a) throw noExiste();
  try {
    await cargarReferenciaVisible(ctx.db, ctx.actor, a.referenciaId, ahora);
  } catch {
    throw noExiste();
  }
  if (a.retiradoEn && !esGestor(ctx.actor.rol)) throw noExiste();
  const almacen = opciones.almacen ?? getAlmacen();
  const clave = opciones.miniatura ? claveMiniatura(a.storageKey) : a.storageKey;
  const objeto = await almacen.leer(clave);
  if (!objeto) throw noExiste();
  return { bytes: objeto.bytes, mime: opciones.miniatura ? 'image/webp' : a.mime, nombre: a.nombreOriginal };
}
