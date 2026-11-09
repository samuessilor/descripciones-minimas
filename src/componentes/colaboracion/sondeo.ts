/**
 * Cada cuanto consulta cada pantalla si hay novedades (sin websockets, que Vercel no sostiene). UN SOLO SITIO para
 * ajustarlo: en el plan gratuito de Vercel el recurso mas escaso es la CPU activa (4 h al mes) y casi todo su gasto
 * son estas consultas repetidas. Subir un valor gasta menos; bajarlo da avisos mas rapidos.
 *
 * Los cambios propios no esperan al reloj: tras guardar, enviar o comentar se vuelve a leer en el acto
 * (`EVENTO_FICHA_CAMBIADA`), y los ajenos se ven al volver a la pestana (`EVENTO_PRESENCIA`). Un choque de edicion se
 * detecta al guardar, no al sondear, asi que alargar estos tiempos no pierde datos.
 *
 * `NEXT_PUBLIC_SONDEO_FACTOR` multiplica todos (las pruebas de navegador usan 0,5 para no esperar). Sin definir, es 1.
 */
const f = Number(process.env.NEXT_PUBLIC_SONDEO_FACTOR ?? '1');
const factor = Number.isFinite(f) && f > 0 ? f : 1;
const ms = (base: number): number => Math.round(base * factor);

export const SONDEO = {
  /** Version de la ficha y quien esta escribiendo. */
  estadoFicha: ms(30_000),
  /** Envios y pendientes de la ficha (panel de actividad). */
  seguimiento: ms(45_000),
  comentarios: ms(45_000),
  /** Si tengo algo que marcar como listo en esta ficha. */
  contexto: ms(60_000),
  historial: ms(45_000),
  /** Zona de la aduana (respuestas del area). */
  aduana: ms(45_000),
  /** Campana de la barra superior: la unica consulta periodica fuera de una ficha. */
  campana: ms(60_000),
  /** Respaldo de Inicio: lo normal es que lo refresque un aviso nuevo de la campana. */
  bandeja: ms(180_000),
} as const;

/**
 * «Estoy escribiendo aqui» mientras un campo tiene el foco. NO se escala con el factor: debe quedar por debajo de
 * VIGENCIA_LATIDO_MS (45 s) con margen para perder un latido (20 s: 0, 40 < 45), y solo se envia si hay alguien presente.
 */
export const LATIDO_EDICION_MS = 20_000;
