/**
 * `npm run worker`: CLIENTE HTTP del despachador de correo (SPEC 12.2, 14, D-30). No abre la base: llama a
 * `GET /api/cron/despachar` del servidor en marcha con `Authorization: Bearer $CRON_SECRET`, cada pocos
 * segundos (WORKER_INTERVALO_MS, 5000 por defecto). En produccion lo hace Vercel Cron cada 5 min; en
 * desarrollo el propio servidor ya lo hace solo (`instrumentation.ts`), asi que este script es opcional:
 * sirve para ver la salida de cada pasada o para despachar contra otro servidor (APP_URL).
 *
 *   npm run worker                 # una pasada cada 5 s, hasta Ctrl+C
 *   npm run worker -- --una-vez    # una sola pasada y termina (util en CI o en una tarea programada)
 */
const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const url = `${base}/api/cron/despachar`;
const secreto = process.env.CRON_SECRET;
const cadaMs = Math.max(1000, Number(process.env.WORKER_INTERVALO_MS ?? 5000) || 5000);
const unaVez = process.argv.includes('--una-vez');

if (!secreto) {
  console.error('Falta CRON_SECRET (corre `npm run setup`).');
  process.exit(1);
}

interface Respuesta {
  ok?: boolean;
  tomados?: number;
  enviados?: number;
  fallidos?: number;
  abandonados?: number;
  cola?: Record<string, number>;
  errores?: Array<{ error?: string }>;
  mensaje?: string;
}

let ultimaLinea = '';
let hayError = false;

async function pasada(): Promise<void> {
  const hora = new Date().toISOString();
  try {
    const r = await fetch(url, { headers: { authorization: `Bearer ${secreto}` }, signal: AbortSignal.timeout(60_000) });
    const cuerpo = (await r.json().catch(() => ({}))) as Respuesta;
    if (!r.ok || !cuerpo.ok) {
      hayError = true;
      console.error(`[worker] ${hora} el despachador respondió ${r.status}: ${cuerpo.mensaje ?? 'revisa CRON_SECRET y que el servidor esté en marcha'}`);
      return;
    }
    const linea = `tomados ${cuerpo.tomados ?? 0} · enviados ${cuerpo.enviados ?? 0} · fallidos ${cuerpo.fallidos ?? 0} · abandonados ${cuerpo.abandonados ?? 0}`;
    // Solo imprime cuando pasa algo (o cambia la linea), para no llenar la consola cada 5 s.
    if ((cuerpo.tomados ?? 0) > 0 || linea !== ultimaLinea) {
      console.log(`[worker] ${hora} ${linea}${cuerpo.errores?.length ? ` · error: ${cuerpo.errores[0]?.error ?? ''}` : ''}`);
    }
    ultimaLinea = linea;
  } catch (e) {
    hayError = true;
    console.error(`[worker] ${hora} el servidor no responde en ${base} (${(e as Error).message}). ¿Está corriendo y APP_URL coincide con su puerto?`);
  }
}

await pasada();
if (unaVez) {
  process.exit(hayError ? 1 : 0);
} else {
  console.log(`[worker] despachando ${url} cada ${cadaMs / 1000} s. Ctrl+C para salir.`);
  setInterval(() => void pasada(), cadaMs);
}
