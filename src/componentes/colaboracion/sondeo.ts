/**
 * Cada cuanto consulta cada pantalla si hay novedades (sin websockets, que Vercel no sostiene). UN SOLO SITIO para
 * ajustarlo: en el plan gratuito de Vercel el recurso mas escaso es la CPU activa (4 h al mes) y casi todo su gasto
 * son estas consultas repetidas. Subir un valor gasta menos; bajarlo da avisos mas rapidos. Los comentarios del resto
 * del codigo remiten a este objeto en vez de repetir cifras.
 *
 * Quienes miran el reloj (solo con la pestana visible; todos con backoff salvo la bandeja de Inicio, que usa un intervalo fijo): el estado de la ficha (`estadoFicha`), la
 * campana, el contexto de envio (`EnviarA`), el seguimiento y los comentarios del panel de actividad (solo mientras esta
 * abierto) y la bandeja de Inicio. Las lecturas de la ficha que muestran datos que cambian con la version (quien puso cada
 * campo, historial, zona de la aduana) NO tienen reloj propio: se releen cuando el sondeo de estado ve una version nueva
 * (`EVENTO_FICHA_CAMBIADA`), al montar, al volver a la pestana y tras una accion propia. Un choque de edicion se detecta
 * al guardar (`versionEsperada`), no al sondear, asi que alargar estos tiempos no pierde datos.
 *
 * LIMITACION ACEPTADA: lo que NO sube `referencia.version` (asignaciones, solicitar la reapertura, comentarios) ya no lo
 * recoge ese evento, y por tanto tampoco el historial ni la zona de la aduana. Llega por la campana, el contexto, el
 * panel de actividad o un evento propio, no por el reloj de la ficha: puede tardar hasta el intervalo de cada uno.
 *
 * `NEXT_PUBLIC_SONDEO_FACTOR` multiplica todos (las pruebas de navegador usan 0,5 para no esperar). Sin definir, es 1.
 */
const f = Number(process.env.NEXT_PUBLIC_SONDEO_FACTOR ?? '1');
const factor = Number.isFinite(f) && f > 0 ? f : 1;
const ms = (base: number): number => Math.round(base * factor);

export const SONDEO = {
  /** Version de la ficha y quien esta escribiendo. Un cambio ajeno tarda hasta este tiempo en verse. */
  estadoFicha: ms(60_000),
  /**
   * Ficha CLASIFICADA o archivada: nadie la esta llenando, asi que no hay «escribiendo» que mostrar y lo unico que puede
   * pasar es que la reabran. Con el historico importado habra miles de fichas cerradas que se consultan sin editar.
   */
  fichaCerrada: ms(180_000),
  /** Envios y pendientes de la ficha (panel de actividad, solo mientras esta abierto): la campana ya avisa de lo urgente. */
  seguimiento: ms(90_000),
  comentarios: ms(90_000),
  /** Si tengo algo que marcar como listo en esta ficha. */
  contexto: ms(120_000),
  /** Campana de la barra superior: la unica consulta periodica fuera de una ficha. */
  campana: ms(120_000),
  /** Respaldo de Inicio: lo normal es que lo refresque un aviso nuevo de la campana. */
  bandeja: ms(300_000),
} as const;

/**
 * Backoff: si varios tics seguidos no traen nada nuevo y nadie toca la pantalla desde hace un rato, el intervalo se
 * duplica (hasta el techo) y vuelve al base con el primer gesto o el primer cambio. Los tiempos escalan con el factor
 * para que las pruebas de navegador, que lo usan para ir mas rapido, vean el mismo comportamiento proporcional.
 */
export const BACKOFF = {
  /** Tics seguidos sin cambios antes de empezar a espaciar. */
  ticsSinCambio: 3,
  /** Solo se espacia si el ultimo gesto (puntero, teclado) fue hace mas de esto. */
  sinGestoMs: ms(60_000),
  /** El intervalo espaciado nunca pasa de esto (si el base ya lo supera, no se espacia). */
  techoMs: ms(180_000),
} as const;

/** Al volver de una pestana oculta se relee solo si estuvo oculta MAS de esto: cambiar de pestana un momento no consulta. */
export const OCULTA_MIN_MS = ms(30_000);

/**
 * Cuantos pasos del intervalo base hay que dejar pasar antes del siguiente tic real: 1 = sin espaciar. Con 3 tics
 * seguidos sin cambios y sin gestos hace mas de `BACKOFF.sinGestoMs`, duplica en cada tic sin cambios (2, 4, ...)
 * hasta que el intervalo llegaria a `BACKOFF.techoMs`.
 */
export function pasosDeEspera(baseMs: number, ticsSinCambio: number, msSinGesto: number): number {
  if (ticsSinCambio < BACKOFF.ticsSinCambio || msSinGesto <= BACKOFF.sinGestoMs) return 1;
  const tope = Math.max(1, Math.floor(BACKOFF.techoMs / baseMs));
  return Math.min(2 ** (ticsSinCambio - BACKOFF.ticsSinCambio + 1), tope);
}

/**
 * «Estoy escribiendo aqui» mientras un campo tiene el foco. NO se escala con el factor. El servidor lo da por vigente
 * `VIGENCIA_LATIDO_MS` (90 s, en estado-ficha.ts): con un latido cada 40 s se puede perder uno y la marca aguanta
 * (0, 40, 80 < 90). El primero sale `LATIDO_PRIMERO_MS` despues de enfocar, no al instante: quien solo pasa de un campo
 * a otro con el tabulador o un clic no manda nada.
 */
export const LATIDO_EDICION_MS = 40_000;
export const LATIDO_PRIMERO_MS = 1_800;
