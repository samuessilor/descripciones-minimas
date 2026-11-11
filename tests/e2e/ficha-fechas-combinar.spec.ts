/**
 * E2E de la ficha: una fecha tecleada rapido guarda una sola vez y completa (al salir del campo, D-33), y «Combinar»
 * no pega dos textos de una linea. Parte de una ficha propia.
 */
import { expect as expectBase, test, type Locator, type Page } from '@playwright/test';
import { abrirSeccion, contextoAutenticado, entrarComo } from './ayudas';

const expect = expectBase.configure({ timeout: 90_000 });

test.use({ actionTimeout: 90_000, navigationTimeout: 180_000 });
test.beforeEach(() => {
  test.setTimeout(600_000);
});

const bloque = (page: Page, clave: string): Locator => page.locator(`[data-campo="${clave}"]`);
const guardado = /^(guardado|limpio)$/;

async function crearFicha(page: Page): Promise<string> {
  await page.goto('/referencias/nueva');
  await page.getByLabel('Código de referencia').fill(`E2E-AG-${Date.now().toString(36).toUpperCase()}`);
  await page.getByLabel('Descripción según factura').fill('Producto de autoguardado');
  await page.getByRole('radio', { name: /Insumo/ }).check();
  await page.getByLabel('Área responsable').selectOption('Consumibles');
  await page.getByRole('button', { name: 'Crear y seguir' }).click();
  await page.waitForURL(/\/referencias\/[0-9a-f-]{36}$/, { timeout: 120_000 });
  await expect(page.locator('[data-barra-ficha]')).toBeVisible({ timeout: 120_000 });
  return page.url();
}

async function versionesDe(page: Page, id: string, campo: string): Promise<unknown[]> {
  const r = await page.request.get(`/api/colaboracion/ficha/${id}/historial?campo=${campo}`);
  const cuerpo = (await r.json()) as { items?: Array<{ valor?: unknown }> };
  return (cuerpo.items ?? []).map((x) => x.valor);
}

test('una fecha tecleada rapido no guarda valores intermedios: guarda una sola vez y completa al salir del campo', async ({ page, request }) => {
  await entrarComo(page, request, 'solicitante@desarrollo.invalid');
  const id = (await crearFicha(page)).split('/').pop() as string;
  await abrirSeccion(page, 'producto'); // arranca abierta en un borrador nuevo, pero no dependemos de eso

  const antes = (await versionesDe(page, id, 'fecha_solicitud')).length;
  const fecha = page.getByLabel(/^Fecha de solicitud/);
  await fecha.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('15102026', { delay: 80 });
  await expect(fecha).toHaveValue('2026-10-15');
  await expect(bloque(page, 'fecha_solicitud')).toHaveAttribute('data-fase', 'sin_guardar'); // teclear no guarda
  expect(await versionesDe(page, id, 'fecha_solicitud')).toHaveLength(antes);
  // En un campo de fecha, Tab recorre dia, mes y ano: se sale haciendo clic fuera.
  await page.getByRole('heading', { level: 1 }).click();
  await expect(bloque(page, 'fecha_solicitud')).toHaveAttribute('data-fase', guardado, { timeout: 20_000 });

  const despues = await versionesDe(page, id, 'fecha_solicitud');
  expect(despues.length, 'una sola version nueva, sin valores intermedios').toBe(antes + 1);
  expect(despues).toContain('15 de octubre de 2026');
});

test('«Combinar» en un campo de una linea separa los dos textos', async ({ browser, request }) => {
  const a = await contextoAutenticado(browser, request, 'solicitante@desarrollo.invalid');
  const b = await contextoAutenticado(browser, request, 'solicitante2@desarrollo.invalid');
  try {
    const url = await crearFicha(a.page);
    await b.page.goto(url);
    await expect(b.page.locator('[data-barra-ficha]')).toBeVisible({ timeout: 120_000 });
    // El Fabricante vive en Detalle (desde la reunion 2026-11-10), que arranca plegada.
    await abrirSeccion(a.page, 'detalle');
    await abrirSeccion(b.page, 'detalle');

    const fabB = b.page.getByLabel(/^Fabricante/);
    await fabB.click();
    await fabB.pressSequentially('Fabricante de la otra persona', { delay: 5 }); // aun sin guardar en su pantalla
    await a.page.getByLabel(/^Fabricante/).fill('Fabricante de la primera');
    await a.page.keyboard.press('Tab');
    await expect(bloque(a.page, 'fabricante')).toHaveAttribute('data-fase', guardado);

    await b.page.keyboard.press('Tab');
    const choque = b.page.locator('[data-conflicto]');
    await expect(choque).toBeVisible();
    await choque.getByRole('button', { name: 'Combinar' }).click();
    await expect(fabB).toHaveValue('Fabricante de la primera / Fabricante de la otra persona');
  } finally {
    await a.contexto.close();
    await b.contexto.close();
  }
});
