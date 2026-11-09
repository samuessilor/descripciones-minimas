/**
 * Despachador del outbox (SPEC 14, RV-14). Lo llaman: `GET /api/cron/despachar` (Vercel Cron o el
 * worker), y `after()` justo despues de una accion para que el envio inicial salga al instante.
 *
 * Garantias:
 *  - RECLAMO ATOMICO: un solo `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`
 *    pasa las filas a `enviando` con un bloqueo de 2 minutos. Dos despachadores simultaneos jamas
 *    toman la misma fila (la que otro tiene bloqueada se salta); una `enviando` con el bloqueo VIGENTE
 *    no se vuelve a tomar.
 *  - RECUPERACION: una `enviando` con el bloqueo VENCIDO (la funcion murio por timeout o despliegue)
 *    vuelve a tomarse. Si ya agoto sus intentos pasa a `abandonado` en vez de reintentarse sin fin.
 *  - REINTENTOS con espera creciente: 5 min, 30 min, 2 h, 12 h y 24 h (seis intentos en total) y despues
 *    `abandonado`, lo que activa la insignia "El correo no se pudo entregar" para quien envio.
 *  - IDEMPOTENCIA hacia el proveedor: cada envio lleva la `clave_idempotencia` de la fila, y el payload
 *    (asunto, texto, html) esta guardado en ella, asi un reintento envia exactamente lo mismo.
 *  - Cada resultado queda en la fila: `estado`, `intentos`, `enviado_en`, `ultimo_error`.
 */
import { and, eq, sql } from 'drizzle-orm';
import { entregaCorreo, usuario } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import { BLOQUEO_ENVIO_MS, MAX_INTENTOS_CORREO, planReintento } from '@/dominio/colaboracion';
import { extraerEnlace } from './outbox';
import type { Mailer } from './tipos';

export interface OpcionesDespacho {
  db: Db;
  mailer: Mailer;
  ahora?: Date;
  /** Filas por pasada (50, SPEC 14). */
  limite?: number;
  /** Restringe el reclamo a estas filas (el envio inmediato posterior a una accion). */
  ids?: readonly string[];
  /** Cuanto dura el reclamo antes de poder recuperarse (2 min). */
  bloqueoMs?: number;
  /** Tiempo maximo de un envio; pasado esto cuenta como fallo (15 s). */
  tiempoMaxEnvioMs?: number;
  /** Envios en paralelo (8). */
  concurrencia?: number;
}

export interface ResultadoDespacho {
  tomados: number;
  /** De los tomados, cuantos eran un reclamo vencido recuperado (informativo). */
  recuperados: number;
  enviados: number;
  fallidos: number;
  abandonados: number;
  /** Detalle por fila (para pruebas y para el log). */
  filas: Array<{ id: string; resultado: 'enviado' | 'fallido' | 'abandonado'; intentos: number; error?: string }>;
}

interface FilaReclamada {
  id: string;
  destinatario: string;
  plantilla: string;
  claveIdempotencia: string;
  asunto: string;
  cuerpoTexto: string;
  cuerpoHtml: string;
  intentos: number;
}

function filasDe(r: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(r)) return r as Array<Record<string, unknown>>;
  const rows = (r as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function mensajeDeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, ' ').slice(0, 500) || 'Error desconocido al enviar.';
}

async function conTiempoMaximo<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`El proveedor de correo no respondió en ${Math.round(ms / 1000)} s.`)), ms);
  });
  try {
    return await Promise.race([promesa, limite]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Pasa a `abandonado` los reclamos vencidos que ya agotaron sus intentos (no se reintentan sin fin). */
async function cerrarAgotados(db: Db, ahora: Date): Promise<number> {
  const r = await db.execute(sql`
    UPDATE entrega_correo
       SET estado = 'abandonado',
           bloqueado_hasta = NULL,
           ultimo_error = 'No se pudo confirmar el envío y ya se agotaron los intentos.'
     WHERE id IN (
       SELECT id FROM entrega_correo
        WHERE estado = 'enviando'
          AND (bloqueado_hasta IS NULL OR bloqueado_hasta < ${ahora.toISOString()}::timestamptz)
          AND intentos >= ${MAX_INTENTOS_CORREO}
        FOR UPDATE SKIP LOCKED)
    RETURNING id`);
  return filasDe(r).length;
}

async function reclamar(db: Db, ahora: Date, limite: number, bloqueoMs: number, ids?: readonly string[]) {
  const hasta = new Date(ahora.getTime() + bloqueoMs);
  const filtroIds =
    ids && ids.length > 0 ? sql`AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``;
  const r = await db.execute(sql`
    UPDATE entrega_correo
       SET estado = 'enviando',
           bloqueado_hasta = ${hasta.toISOString()}::timestamptz,
           intentos = intentos + 1
     WHERE id IN (
       SELECT id FROM entrega_correo
        WHERE ((estado IN ('pendiente', 'fallido') AND proximo_intento <= ${ahora.toISOString()}::timestamptz)
            OR (estado = 'enviando' AND (bloqueado_hasta IS NULL OR bloqueado_hasta < ${ahora.toISOString()}::timestamptz)))
          ${filtroIds}
        ORDER BY proximo_intento
        LIMIT ${limite}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, destinatario, plantilla, clave_idempotencia, asunto, cuerpo_texto, cuerpo_html, intentos`);
  return filasDe(r).map(
    (f): FilaReclamada => ({
      id: String(f.id),
      destinatario: String(f.destinatario),
      plantilla: String(f.plantilla),
      claveIdempotencia: String(f.clave_idempotencia),
      asunto: String(f.asunto),
      cuerpoTexto: String(f.cuerpo_texto),
      cuerpoHtml: String(f.cuerpo_html),
      intentos: Number(f.intentos),
    }),
  );
}

export async function despachar(op: OpcionesDespacho): Promise<ResultadoDespacho> {
  const { db, mailer } = op;
  const ahora = op.ahora ?? new Date();
  const limite = op.limite ?? 50;
  const bloqueoMs = op.bloqueoMs ?? BLOQUEO_ENVIO_MS;
  const tiempoMax = op.tiempoMaxEnvioMs ?? 15_000;
  const concurrencia = Math.max(1, op.concurrencia ?? 8);

  const agotados = await cerrarAgotados(db, ahora);
  const tomadas = await reclamar(db, ahora, limite, bloqueoMs, op.ids);

  const resultado: ResultadoDespacho = {
    tomados: tomadas.length,
    recuperados: 0,
    enviados: 0,
    fallidos: 0,
    abandonados: agotados,
    filas: [],
  };

  async function enviarUna(f: FilaReclamada): Promise<void> {
    // Un destinatario desactivado o con correo marcado invalido no recibe nada (y se ve en la ficha).
    const [u] = await db
      .select({ activo: usuario.activo, invalido: usuario.correoInvalido })
      .from(usuario)
      .where(sql`lower(${usuario.email}) = ${f.destinatario.toLowerCase()}`)
      .limit(1);
    if (u && (!u.activo || u.invalido)) {
      const motivo = !u.activo
        ? 'El destinatario ya no tiene acceso a la plataforma.'
        : 'El correo del destinatario está marcado como inválido.';
      await db
        .update(entregaCorreo)
        .set({ estado: 'abandonado', bloqueadoHasta: null, ultimoError: motivo })
        .where(and(eq(entregaCorreo.id, f.id), eq(entregaCorreo.estado, 'enviando')));
      resultado.abandonados += 1;
      resultado.filas.push({ id: f.id, resultado: 'abandonado', intentos: f.intentos, error: motivo });
      return;
    }

    try {
      const enlace = extraerEnlace(f.cuerpoTexto);
      await conTiempoMaximo(
        mailer.enviar({
          para: f.destinatario,
          asunto: f.asunto,
          texto: f.cuerpoTexto,
          html: f.cuerpoHtml,
          ...(enlace ? { enlace } : {}),
          claveIdempotencia: f.claveIdempotencia,
        }),
        tiempoMax,
      );
      // Solo marca `enviado` si la fila sigue siendo nuestra (`enviando`): si otro la recupero, no la pisamos.
      await db
        .update(entregaCorreo)
        .set({ estado: 'enviado', enviadoEn: new Date(), bloqueadoHasta: null, ultimoError: null })
        .where(and(eq(entregaCorreo.id, f.id), eq(entregaCorreo.estado, 'enviando')));
      resultado.enviados += 1;
      resultado.filas.push({ id: f.id, resultado: 'enviado', intentos: f.intentos });
    } catch (e) {
      const error = mensajeDeError(e);
      const plan = planReintento(f.intentos, ahora);
      if (plan.estado === 'abandonado') {
        await db
          .update(entregaCorreo)
          .set({ estado: 'abandonado', bloqueadoHasta: null, ultimoError: error })
          .where(and(eq(entregaCorreo.id, f.id), eq(entregaCorreo.estado, 'enviando')));
        resultado.abandonados += 1;
        resultado.filas.push({ id: f.id, resultado: 'abandonado', intentos: f.intentos, error });
      } else {
        await db
          .update(entregaCorreo)
          .set({ estado: 'fallido', bloqueadoHasta: null, ultimoError: error, proximoIntento: plan.proximoIntento })
          .where(and(eq(entregaCorreo.id, f.id), eq(entregaCorreo.estado, 'enviando')));
        resultado.fallidos += 1;
        resultado.filas.push({ id: f.id, resultado: 'fallido', intentos: f.intentos, error });
      }
    }
  }

  // Pool simple: `concurrencia` envios a la vez para que el lote entre en la ventana del bloqueo.
  const cola = [...tomadas];
  await Promise.all(
    Array.from({ length: Math.min(concurrencia, cola.length) }, async () => {
      for (;;) {
        const siguiente = cola.shift();
        if (!siguiente) return;
        await enviarUna(siguiente);
      }
    }),
  );
  resultado.recuperados = tomadas.filter((f) => f.intentos > 1).length;
  return resultado;
}

/** Para `after()`: nunca lanza (un fallo aqui no debe afectar la respuesta; la cola lo reintenta). */
export async function despacharSinFallar(op: OpcionesDespacho): Promise<ResultadoDespacho | null> {
  try {
    return await despachar(op);
  } catch (e) {
    console.error('[correo] el envio inmediato fallo; el despachador lo reintentara:', e);
    return null;
  }
}

/** Conteo por estado (cron, panel de correo). */
export async function contarCola(db: Db): Promise<Record<string, number>> {
  const r = await db.execute(sql`SELECT estado, count(*)::int AS n FROM entrega_correo GROUP BY estado`);
  const cuentas: Record<string, number> = { pendiente: 0, enviando: 0, enviado: 0, fallido: 0, abandonado: 0 };
  for (const f of filasDe(r)) cuentas[String(f.estado)] = Number(f.n);
  return cuentas;
}
