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

/**
 * Una cuenta recien creada (o restablecida) usa la app de una vez con la contrasena de entrega: cambiarla es voluntario.
 * Comprueba que `/referencias` abre sin pasar por «Mi cuenta» y sin ningun aviso de cambio.
 */
export async function verUsoSinCambiarClave(page: Page): Promise<void> {
  await page.goto('/referencias');
  await expect(page).toHaveURL(/\/referencias$/);
  await expect(page.getByRole('heading', { name: 'Referencias' })).toBeVisible();
  await page.goto('/cuenta');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByText(/Cambia tu contraseña|Debes actualizar tu contraseña/)).toHaveCount(0);
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

/** Las tres secciones de la ficha y los bloques de la zona de la aduana: todos arrancan PLEGADOS (reunion 2026-11). */
export const SECCIONES_FICHA = ['producto', 'detalle', 'especificaciones'] as const;
export const BLOQUES_ADUANA = ['aduana-partida', 'aduana-rim', 'aduana-descripciones', 'aduana-restricciones', 'aduana-cierre'] as const;

/** El boton que pliega/despliega una seccion de la ficha (`#producto`) o un bloque de la zona (`#aduana-partida`). */
export function botonDeSeccion(page: Page, id: string): Locator {
  return page.locator(`#${id} > :is(h2, h3) > button[aria-expanded]`).first();
}

/**
 * Abre una seccion o bloque plegado y espera a que quede abierto. Reintenta el clic: antes de que React hidrate la
 * pagina el boton se ve pero todavia no responde. Si ya esta abierto no hace nada.
 */
export async function abrirSeccion(page: Page, id: string): Promise<void> {
  const boton = botonDeSeccion(page, id);
  await boton.waitFor({ state: 'visible', timeout: 60_000 });
  await expect(async () => {
    if ((await boton.getAttribute('aria-expanded')) !== 'true') await boton.click({ timeout: 5_000 });
    await expect(boton).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

/** Abre las tres secciones de la ficha (y, con `{ aduana: true }`, los bloques de la zona de la aduana). */
export async function abrirTodo(page: Page, opciones: { aduana?: boolean } = {}): Promise<void> {
  await page.locator('[data-barra-ficha]').waitFor({ state: 'visible', timeout: 60_000 });
  for (const id of SECCIONES_FICHA) await abrirSeccion(page, id);
  if (opciones.aduana) for (const id of BLOQUES_ADUANA) await abrirSeccion(page, id);
}
