/** Responsive (CA-01, 11.6): sin scroll horizontal a 360 px en entrar, listado y ficha. */
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './ayudas';

async function sinScrollHorizontal(page: Page, ruta: string) {
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  expect(ancho, `${ruta}: scrollWidth ${ancho} > clientWidth ${visible}`).toBeLessThanOrEqual(visible);
}

test('360 px: /entrar, listado y ficha no hacen scroll horizontal', async ({ page, request }) => {
  await sinScrollHorizontal(page, '/entrar');
  await entrarComo(page, request, 'solicitante@desarrollo.invalid');
  await sinScrollHorizontal(page, '/referencias');
  await page.goto('/referencias');
  await page.getByRole('link', { name: /TEST-0001/ }).click();
  await expect(page.getByRole('heading', { name: /NSR E1/ })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  expect(ancho).toBeLessThanOrEqual(visible);
  // En la ficha la barra inferior de navegacion se oculta (manda el pie con «Enviar a…», RV-43); en el listado si existe.
  if ((page.viewportSize()?.width ?? 1280) < 1024) await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  await page.goto('/referencias');
  await expect(page.getByRole('navigation', { name: 'Principal' }).last()).toBeVisible();
});
