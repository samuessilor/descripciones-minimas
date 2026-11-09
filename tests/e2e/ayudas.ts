import { expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

/** Pide el enlace en la pantalla de entrada y lo lee de `GET /api/dev/correo` (sin abrir la base). */
export async function entrarComo(page: Page, request: APIRequestContext, email: string, siguiente = '/'): Promise<void> {
  // Los limites de tasa son una regla del producto; en desarrollo se reinician entre solicitudes de prueba.
  await request.post('/api/dev/limites', { maxRetries: 3 });
  await page.goto(siguiente === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(siguiente)}`);
  await page.getByLabel('Correo').fill(email);
  await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
  await expect(page.getByText('Si ese correo tiene acceso')).toBeVisible();

  const enlace = await esperarEnlace(request, email);
  await page.goto(enlace);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
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

export async function esperarEnlace(request: APIRequestContext, email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const r = await request.get(`/api/dev/correo?para=${encodeURIComponent(email)}&limite=1`, { maxRetries: 3 });
    const lista = (await r.json()) as Array<{ enlace: string | null }>;
    if (lista[0]?.enlace) return lista[0].enlace;
    await new Promise((res) => setTimeout(res, 300));
  }
  throw new Error(`no llego el correo a ${email}`);
}

export async function contextoAutenticado(browser: Browser, request: APIRequestContext, email: string): Promise<{ contexto: BrowserContext; page: Page }> {
  const contexto = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await contexto.newPage();
  await entrarComo(page, request, email);
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
