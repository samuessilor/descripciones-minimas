/**
 * `aplicarEscritura()`: la UNICA funcion que toca `campo_historial`, `referencia.datos`, las
 * columnas promovidas (`codigo`, `nombre_producto`, `tipo_producto`, `partida`, `fecha_solicitud`)
 * y `texto_busqueda` (SPEC 6.4). `guardarCampo`, `restaurarCampo`, `resolverConflicto` (y la
 * creacion de la ficha) pasan por aqui, de modo que las reglas de "nadie borra lo que otro puso"
 * (SPEC 9.3, RV-06) valen por TODOS los caminos que cambian el valor vigente:
 *
 *  - reemplazar un valor de OTRA persona exige un motivo y avisa a su autor (`cambio_en_mi_campo`);
 *  - nadie puede dejar vacio un valor ajeno, salvo un `admin` (con motivo);
 *  - el valor anterior queda en el historial inmutable; nada se pierde.
 *
 * La funcion espera que quien la llama YA haya bloqueado la fila de la ficha (`FOR UPDATE`) y
 * verificado permisos: aqui solo vive la regla de integridad del dato.
 */
import { and, eq } from 'drizzle-orm';
import { campoHistorial, edicionActiva, referencia, usuario } from '@/db/esquema';
import type { Tx } from '@/db/tipos';
import { COLUMNA_PROMOVIDA, getCampo } from '@/dominio/campos';
import { construirTextoBusqueda } from '@/dominio/busqueda';
import { solicitudSinRespuesta } from '@/dominio/completitud';
import { nombreSinMarca } from '@/dominio/colaboracion';
import { motivoVisible, normalizarCodigo } from '@/dominio/normalizacion';
import { autorVisible, type TipoOrganizacion } from '@/dominio/permisos';
import { esNoAplica, estaVacio, valoresIguales } from '@/dominio/valores';
import type { Datos, EntradaDatos } from '@/db/esquema/nucleo';
import { crearNotificacion } from '../notificaciones/crear';
import type { Actor } from '../politicas/actor';
import type { FilaReferencia } from '../politicas/referencias';
import { pedirRespuestaAlArea, registrarRespuestaDelArea, terminarPedidosDeRespuesta } from './asignaciones';
import { ErrorAccion } from './resultado';

export type TipoEventoEscritura = 'fijar' | 'restaurar' | 'sistema';

export interface ParametrosEscritura {
  campo: string;
  /** Valor ya normalizado y validado; `null` = vaciar. */
  valor: unknown;
  tipoEvento: TipoEventoEscritura;
  /** Version del campo que el cliente vio. `null` = no comparar (creacion, eventos del sistema). */
  versionEsperada: number | null;
  motivo?: string | null | undefined;
  restauraId?: number | null | undefined;
  origen?: 'web' | 'sistema';
  /** Escribe aunque el valor sea igual al vigente (hechos iniciales de la creacion). */
  omitirIgualdad?: boolean;
  ahora: Date;
}

export interface ResultadoAplicarEscritura {
  /** `false` si el valor era identico al vigente (idempotencia: no se escribe nada). */
  escrito: boolean;
  /** Version del campo tras la operacion. */
  version: number;
  /** La ficha tal como queda (con `datos` al dia). */
  ficha: FilaReferencia;
  historialId: number | null;
}

/** El valor vigente cambio desde que el cliente lo leyo. Lo convierte `guardarCampo` en CONFLICTO. */
export class ConflictoDeVersion extends Error {
  constructor(
    readonly campo: string,
    readonly vigente: EntradaDatos | undefined,
  ) {
    super(`Conflicto de version en ${campo}`);
  }
}

function etiquetaDeCampo(campo: string): string {
  return getCampo(campo)?.etiqueta ?? campo;
}

function valorPromovido(clave: string, valor: unknown): string | null {
  if (typeof valor === 'string') return valor;
  return valor === null || valor === undefined ? null : String(valor);
}

export async function aplicarEscritura(
  tx: Tx,
  actor: Actor,
  ficha: FilaReferencia,
  p: ParametrosEscritura,
): Promise<ResultadoAplicarEscritura> {
  const datosActuales: Datos = ficha.datos ?? {};
  const vigente = datosActuales[p.campo];
  const versionVigente = vigente?.n ?? 0;
  const valorVigente = vigente?.v ?? null;
  const nuevo = p.valor === undefined ? null : p.valor;

  // Idempotencia: un valor identico al vigente no escribe nada (cubre el reintento de una
  // escritura que ya llego, aunque la version esperada haya quedado vieja).
  if (!p.omitirIgualdad && (valoresIguales(valorVigente, nuevo) || (estaVacio(valorVigente) && estaVacio(nuevo)))) {
    return { escrito: false, version: versionVigente, ficha, historialId: null };
  }

  // Concurrencia optimista por campo (9.5): nunca hay "ultimo gana" silencioso.
  if (p.versionEsperada !== null && p.versionEsperada !== versionVigente) {
    throw new ConflictoDeVersion(p.campo, vigente);
  }

  // Un motivo sin texto visible (espacios, U+200B, marcas de formato) no cuenta como motivo.
  const motivo = motivoVisible(p.motivo);
  const hayValorAjeno = !!vigente && vigente.a !== actor.usuarioId && !estaVacio(valorVigente);

  if (p.tipoEvento !== 'sistema' && hayValorAjeno) {
    // Nadie vacia un valor ajeno; solo un admin, y con motivo (9.3). Excepcion: desmarcar un «No aplica» ajeno
    // (con motivo y aviso al autor), porque con la casilla marcada el campo no admite otro valor (R1).
    if (estaVacio(nuevo) && actor.rol !== 'admin' && !esNoAplica(valorVigente)) {
      throw new ErrorAccion(
        'SIN_PERMISO',
        'No se puede dejar vacío un valor que puso otra persona. Si está mal, cámbialo y cuéntale por qué.',
      );
    }
    if (!motivo) {
      throw new ErrorAccion(
        'FALTA_MOTIVO',
        'Escribe el motivo para guardar. La persona que puso este valor recibirá un aviso.',
        { campo: p.campo },
      );
    }
  }

  const version = versionVigente + 1;
  const tipoEvento = p.tipoEvento === 'fijar' && estaVacio(nuevo) ? 'vaciar' : p.tipoEvento;
  const valorGuardado = estaVacio(nuevo) ? null : nuevo;

  const [hecho] = await tx
    .insert(campoHistorial)
    .values({
      referenciaId: ficha.id,
      campo: p.campo,
      versionCampo: version,
      tipoEvento,
      valor: valorGuardado,
      restauraId: p.restauraId ?? null,
      baseVersion: p.versionEsperada,
      motivo,
      autorId: actor.usuarioId,
      rol: actor.rol,
      organizacionId: actor.organizacionId,
      origen: p.origen ?? (p.tipoEvento === 'sistema' ? 'sistema' : 'web'),
      creadoEn: p.ahora,
    })
    .returning({ id: campoHistorial.id });

  const entrada: EntradaDatos = {
    v: valorGuardado,
    n: version,
    a: actor.usuarioId,
    o: actor.organizacionId,
    t: p.ahora.toISOString(),
  };
  const datosNuevos: Datos = { ...datosActuales, [p.campo]: entrada };

  // Columnas promovidas (6.4).
  const promovida = COLUMNA_PROMOVIDA[p.campo];
  const cambios: Partial<typeof referencia.$inferInsert> = {};
  let codigo = ficha.codigo;
  let nombreProducto = ficha.nombreProducto;
  let partida = ficha.partida;
  if ((promovida === 'codigo' || promovida === 'nombre_producto' || promovida === 'tipo_producto' || promovida === 'fecha_solicitud') && valorGuardado === null) {
    // Estas columnas son NOT NULL y se piden al crear: jamas se vacian (la validacion ya lo impide; defensa en profundidad).
    throw new ErrorAccion('VALIDACION', 'Este campo no se puede dejar vacío.');
  }
  if (promovida === 'codigo') {
    codigo = String(valorGuardado);
    cambios.codigo = codigo;
    cambios.codigoNorm = normalizarCodigo(codigo);
  } else if (promovida === 'nombre_producto') {
    nombreProducto = String(valorGuardado);
    cambios.nombreProducto = nombreProducto;
  } else if (promovida === 'tipo_producto') {
    cambios.tipoProducto = String(valorGuardado);
  } else if (promovida === 'partida') {
    partida = valorPromovido(p.campo, valorGuardado);
    cambios.partida = partida;
  } else if (promovida === 'fecha_solicitud') {
    cambios.fechaSolicitud = String(valorGuardado);
  }

  const valores: Record<string, unknown> = {};
  for (const [clave, e] of Object.entries(datosNuevos)) valores[clave] = e.v;
  const textoBusqueda = construirTextoBusqueda({ codigo, nombreProducto, partida, valores });

  const [actualizada] = await tx
    .update(referencia)
    .set({
      ...cambios,
      datos: datosNuevos,
      textoBusqueda,
      version: ficha.version + 1,
      actualizadaEn: p.ahora,
    })
    .where(eq(referencia.id, ficha.id))
    .returning();
  if (!actualizada) throw new ErrorAccion('ERROR_INTERNO', 'No se pudo actualizar la ficha.');

  // Aviso al autor del valor reemplazado (solo bandeja, 14).
  if (p.tipoEvento !== 'sistema' && hayValorAjeno && vigente) {
    await avisarCambioAlAutor(tx, actor, actualizada, vigente.a, p.campo, p.ahora);
  }

  // Solicitud de informacion de la aduana (descripciones minimas adicionales) y respuesta del area: el pendiente del
  // area se abre, se actualiza o se cierra con el mismo valor vigente que usa el semaforo.
  if (p.tipoEvento !== 'sistema') {
    if (p.campo === 'descripciones_minimas') {
      if (typeof valorGuardado === 'string' && solicitudSinRespuesta(valores)) {
        await pedirRespuestaAlArea(tx, actor, actualizada, valorGuardado, p.ahora);
      } else if (typeof valorGuardado !== 'string' && vigente) {
        await terminarPedidosDeRespuesta(tx, ficha.id, vigente.a, p.ahora);
      }
    } else if (p.campo === 'respuesta_area' && valorGuardado !== null) {
      await registrarRespuestaDelArea(tx, actor, actualizada, p.ahora);
    }
  }

  // Mientras escribia, el actor aparecia como "editando": ya guardo.
  await tx
    .delete(edicionActiva)
    .where(
      and(
        eq(edicionActiva.referenciaId, ficha.id),
        eq(edicionActiva.campo, p.campo),
        eq(edicionActiva.usuarioId, actor.usuarioId),
      ),
    );

  return { escrito: true, version, ficha: actualizada, historialId: hecho?.id ?? null };
}

async function avisarCambioAlAutor(
  tx: Tx,
  actor: Actor,
  ficha: FilaReferencia,
  autorPrevioId: string,
  campo: string,
  ahora: Date,
): Promise<void> {
  const [previo] = await tx
    .select({
      id: usuario.id,
      activo: usuario.activo,
      organizacionId: usuario.organizacionId,
      organizacionTipo: usuario.organizacionTipo,
    })
    .from(usuario)
    .where(eq(usuario.id, autorPrevioId))
    .limit(1);
  if (!previo || !previo.activo || previo.id === actor.usuarioId) return;

  // Si el autor previo es de una agencia y quien cambia es de OTRA agencia, no se revela su nombre (A5).
  const quien =
    autorVisible(
      {
        usuarioId: previo.id,
        rol: 'aduana',
        organizacionId: previo.organizacionId,
        organizacionTipo: previo.organizacionTipo as TipoOrganizacion,
      },
      { organizacionId: actor.organizacionId, organizacionTipo: actor.organizacionTipo },
    ) === 'otra_agencia'
      ? 'Otra agencia'
      : nombreSinMarca(actor.nombre);

  await crearNotificacion(tx, {
    usuarioId: previo.id,
    tipo: 'cambio_en_mi_campo',
    referenciaId: ficha.id,
    titulo: `${quien} cambió «${etiquetaDeCampo(campo)}» en ${ficha.codigo}, un valor que habías puesto`,
    creadaEn: ahora,
  });
}
