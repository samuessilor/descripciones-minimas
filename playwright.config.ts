import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (SPEC 17.1): el servidor de desarrollo corre con PGlite; las pruebas NO abren la base: leen el
 * enlace de acceso por `GET /api/dev/correo` (D-30). Usa el Chrome/Edge instalado (`E2E_CANAL`), asi
 * no se descargan navegadores aparte.
 */
const puerto = Number(process.env.E2E_PUERTO ?? 3010);
const url = process.env.E2E_URL ?? `http://localhost:${puerto}`;
const canal = process.env.E2E_CANAL ?? 'chrome';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/reiniciar-base.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: url, trace: 'retain-on-failure', locale: 'es-CO', timezoneId: 'America/Bogota' },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], channel: canal } },
    {
      name: 'movil-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 }, channel: canal },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_URL
    ? undefined
    : {
        command: `npx next dev -p ${puerto}`,
        url: `${url}/entrar`,
        reuseExistingServer: true,
        timeout: 120_000,
        env: { APP_URL: url },
      },
});
