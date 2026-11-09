import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** Contrasena de las cuentas de ejemplo (`@desarrollo.invalid`): ver `CLAVE_DESARROLLO` en `server/cuentas-demo.ts`. */
export const CLAVE_EJEMPLO = 'desarrollo-2026';

/**
 * Entra por la pantalla de entrada REAL (usuario y contrasena). `quien` es el usuario (`admin`) o el correo de ejemplo
 * (`admin@desarrollo.invalid`, de donde sale el usuario). Para cuentas creadas en la prueba, pasa su contrasena.
 */
export async function entrarComo(page: Page, request: APIRequestContext, quien: string, siguiente = '/', clave: string = CLAVE_EJEMPLO): Promise<void> {
  // Los limites de intentos son una regla del producto; en desarrollo se reinician entre solicitudes de prueba.
  await request.post('/api/dev/limites', { maxRetries: 3 });
  await page.goto(siguiente === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(siguiente)}`);
  await page.getByLabel('Usuario').fill(quien.includes('@') ? quien.split('@')[0]! : quien);
  await page.getByLabel('Contraseña', { exact: true }).fill(clave);
  await pulsarHidratado(page.getByRole('button', { name: 'Entrar', exact: true }));
  // En desarrollo la primera visita compila la pagina destino (puede tardar): margen amplio.
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 60_000 });
}

/** Pulsa un boton de formulario solo cuando React ya lo hidrato (si no, un envio temprano recarga la pagina y pierde el envio). */
export async function pulsarHidratado(boton: Locator): Promise<void> {
  await boton.waitFor({ state: 'visible' });
  await boton.evaluate(
    (el) =>
      new Promise<void>((resolver) => {
        const t = setInterval(() => {
          if (Object.keys(el).some((k) => k.startsWith('__reactProps'))) {
            clearInterval(t);
            resolver();
          }
        }, 100);
      }),
  );
  await boton.click();
}

export async function contextoAutenticado(browser: Browser, request: APIRequestContext, quien: string, clave: string = CLAVE_EJEMPLO): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await contexto.newPage();
  await entrarComo(page, request, quien, '/', clave);
  return { contexto, page };
}

/** Recoge errores de consola y de pagina (incluye violaciones de CSP). */
export function vigilarErrores(page: Page): string[] {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(`console: ${m.text()} (${m.location().url})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/dev/')) errores.push(`http ${r.status()}: ${r.url()}`);
  });
  return errores;
}
