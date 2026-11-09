/**
 * `npm run inicio`: UN solo comando para ver la aplicacion funcionando en local.
 *   1. `npm run setup`  (carpetas .data/ y .env.local con secretos nuevos; no sobrescribe nada existente)
 *   2. busca un puerto libre (3000 o el que pidas con PORT) y alinea APP_URL con el
 *   3. arranca el servidor de desarrollo (migra y siembra la base local con usuarios y 15 referencias de ejemplo)
 *   4. cuando responde, abre el navegador en /entrar.
 *
 * Funciona igual en PowerShell, cmd, bash y zsh. Opciones: `PORT=3010` (puerto), `NO_ABRIR=1` (no abrir navegador).
 * Un solo servidor de desarrollo por carpeta: si ya hay uno corriendo aqui, Next lo avisa y este comando termina.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
// Sin shell ni `npx`: se lanza el binario de Next con el mismo Node (igual en Windows, macOS y Linux).
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

/** Un puerto esta ocupado si alguien acepta conexiones en IPv4 o IPv6 (otro programa puede tenerlo solo en uno). */
function ocupado(puerto: number): Promise<boolean> {
  const probar = (host: string) =>
    new Promise<boolean>((fin) => {
      const s = connect({ port: puerto, host });
      s.setTimeout(800);
      s.once('connect', () => {
        s.destroy();
        fin(true);
      });
      s.once('timeout', () => {
        s.destroy();
        fin(false);
      });
      s.once('error', () => fin(false));
    });
  return Promise.all([probar('127.0.0.1'), probar('::1')]).then(([a, b]) => a || b);
}

async function puertoLibre(desde: number): Promise<number> {
  for (let p = desde; p < desde + 30; p++) if (!(await ocupado(p))) return p;
  throw new Error(`No hay ningun puerto libre entre ${desde} y ${desde + 29}.`);
}

function abrirNavegador(url: string): void {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* sin navegador: la direccion queda impresa */
  }
}

// 1) Entorno local listo (el mismo `scripts/setup.mts`; aqui se calla su mensaje final porque el de abajo lo reemplaza).
const log = console.log;
console.log = () => {};
try {
  await import('./setup.mts');
} finally {
  console.log = log;
}

// 2) Puerto y URL alineados.
const pedido = Number(process.env.PORT) || 3000;
const puerto = await puertoLibre(pedido);
const url = `http://localhost:${puerto}`;
if (puerto !== pedido) console.log(`El puerto ${pedido} esta ocupado por otro programa: uso el ${puerto}.`);

console.log(`
Descripciones minimas · desarrollo local
  Direccion ........ ${url}
  Entrar ........... sin login: entras como admin y cambias de cuenta desde el menu de arriba a la derecha.
                     Con login (CON_LOGIN=1): usuario admin, consumibles, mantenimiento, instrumentos, marketing, aduana-a, aduana-b,
                     lector, solicitante o solicitante2; contrasena de ejemplo: desarrollo-2026.
  Datos ............ 15 referencias de ejemplo. Reiniciarlas: POST ${url}/api/dev/reset   (o: npm run db:reset, con el servidor detenido)
  (CON_LOGIN=1 npm run inicio  pide usuario y contrasena como en produccion)
  Para parar ....... Ctrl+C
`);

// 3) Servidor de desarrollo.
const servidor = spawn(process.execPath, [nextBin, 'dev', '-p', String(puerto)], {
  cwd: raiz,
  stdio: 'inherit',
  env: { ...process.env, APP_URL: url, ...(process.env.CON_LOGIN === '1' ? {} : { SIN_LOGIN: '1' }) },
});
const parar = () => servidor.kill();
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
servidor.on('exit', (codigo) => process.exit(codigo ?? 0));

// 4) Abrir el navegador cuando responda.
if (process.env.NO_ABRIR !== '1') {
  const limite = Date.now() + 120_000;
  const esperar = async (): Promise<void> => {
    while (Date.now() < limite) {
      try {
        const r = await fetch(`${url}/entrar`, { signal: AbortSignal.timeout(5_000) });
        if (r.ok) return abrirNavegador(`${url}/entrar`);
      } catch {
        /* todavia arrancando */
      }
      await new Promise((res) => setTimeout(res, 1_000));
    }
  };
  void esperar();
}
