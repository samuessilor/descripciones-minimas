/**
 * Arranque del servidor (Node).
 *  - En PRODUCCION valida la configuracion al arrancar: si falta `DATABASE_URL`, un secreto, etc., imprime un
 *    mensaje claro en la consola (SPEC 12.2: "falla con mensaje claro") en vez de dejar solo un 500 sin causa
 *    visible en cada pagina. (Next mantiene el proceso vivo; las paginas responden 500 hasta corregirlo.)
 *  - Solo en DESARROLLO y con PGlite local:
 *     - migra y siembra la base al arrancar (PGlite es de un solo proceso: solo el servidor abre la base, D-30);
 *     - cada pocos segundos (DESPACHADOR_DEV_MS, 5000 por defecto) "toca" el despachador de correo, como lo haria
 *       Vercel Cron en produccion: asi el desarrollo funciona SIN correr `npm run worker` aparte. El envio inicial sale
 *       igual al instante (`after()`); esto cubre los reintentos y lo que quedo en la cola.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NODE_ENV === 'production') {
    const { getConfig } = await import('./server/config');
    try {
      getConfig();
    } catch (e) {
      console.error(`[config] El servidor no puede arrancar. ${(e as Error).message}`);
      throw e;
    }
    return;
  }
  if (process.env.NODE_ENV !== 'development') return;

  const { getConfig } = await import('./server/config');
  const config = getConfig();

  if (config.AUTO_PREPARAR_BD_DEV && !config.DATABASE_URL) {
    const { getConexion } = await import('./db');
    const { prepararBase } = await import('./server/preparar-bd');
    await prepararBase(getConexion(), { desarrollo: true });
    console.log('[dev] Base local lista (migraciones aplicadas y semillas cargadas).');
  }

  if (config.AVISOS_POR_CORREO && config.CRON_SECRET) {
    const g = globalThis as typeof globalThis & { __despachadorDev?: ReturnType<typeof setInterval> };
    if (!g.__despachadorDev) {
      const cadaMs = Math.max(1000, Number(process.env.DESPACHADOR_DEV_MS) || 5000);
      let enCurso = false;
      g.__despachadorDev = setInterval(() => {
        if (enCurso) return; // nunca dos pasadas del temporizador a la vez
        enCurso = true;
        fetch(`${config.APP_URL}/api/cron/despachar`, { headers: { authorization: `Bearer ${config.CRON_SECRET}` } })
          .catch(() => {})
          .finally(() => {
            enCurso = false;
          });
      }, cadaMs);
      g.__despachadorDev.unref?.();
    }
  }
}
