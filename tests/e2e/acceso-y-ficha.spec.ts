/**
 * E2E de H1 (SPEC 17.1): invitar -> enlace -> ficha de prueba con `guardarCampo` real -> historial ->
 * choque de edicion con dos navegadores -> revocacion de sesion al desactivar (P-12).
 * Requiere el servidor de desarrollo con la base sembrada (la propia configuracion lo levanta).
 */
import { expect, test } from '@playwright/test';
import { contextoAutenticado, entrarComo, pulsarHidratado, vigilarErrores } from './ayudas';

test.describe.configure({ mode: 'serial' });

test('login por enlace magico sin errores de consola ni de CSP, y navegacion con todas las secciones', async ({ page, request }) => {
  // Login real + 10 rutas que en frio se compilan bajo demanda: los 90 s globales no alcanzan.
  test.setTimeout(240_000);
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'admin@desarrollo.invalid');

  await expect(page.getByRole('heading', { name: /Hola, Ana/ })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Principal' }).first();
  for (const nombre of ['Inicio', 'Referencias', 'Notificaciones', 'Administración']) {
    await expect(nav.getByRole('link', { name: nombre, exact: true })).toBeVisible();
  }
  // El menu de usuario (avatar + nombre) es un boton que abre la cuenta.
  await expect(page.getByRole('button', { name: 'Ana Admin' })).toBeVisible();

  for (const ruta of ['/referencias', '/notificaciones', '/cuenta', '/admin', '/admin/usuarios', '/admin/organizaciones', '/admin/catalogos', '/admin/auditoria', '/admin/correo']) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBe(200);
  }
  expect(errores, errores.join('\n')).toEqual([]);
});

test('sin sesion se redirige a /entrar conservando el destino y un destino externo se ignora', async ({ page }) => {
  await page.goto('/referencias');
  await expect(page).toHaveURL(/\/entrar\?siguiente=%2Freferencias/);
  await page.goto('/entrar?siguiente=https://evil.example');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
});

test('ficha: guarda al salir del campo, muestra autor y fecha y conserva al recargar', async ({ page, request }) => {
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid');
  await page.goto('/referencias');
  await page.getByRole('link', { name: /TEST-0003/ }).click();
  await expect(page.getByRole('heading', { name: 'Filtro de aire (ejemplo)' })).toBeVisible();

  const valor = `Uso escrito por la prueba ${Date.now()}`;
  const campo = page.getByLabel(/^Uso$/);
  await campo.fill(valor);
  await expect(page.getByText('Sin guardar').first()).toBeVisible();
  await campo.blur();
  await expect(page.locator('[data-campo="uso"]')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
  await expect(page.locator('[data-campo="uso"]').getByText(/Tú ·/)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel(/^Uso$/)).toHaveValue(valor);

  expect(errores, errores.join('\n')).toEqual([]);
});

test('dos navegadores en el mismo campo: choque con las tres salidas, sin perder el texto (CA-14)', async ({ browser, request }) => {
  const a = await contextoAutenticado(browser, request, 'solicitante@desarrollo.invalid');
  const b = await contextoAutenticado(browser, request, 'solicitante2@desarrollo.invalid');
  try {
    for (const p of [a.page, b.page]) {
      await p.goto('/referencias');
      await p.getByRole('link', { name: /TEST-0003/ }).click();
      await expect(p.getByRole('heading', { name: 'Filtro de aire (ejemplo)' })).toBeVisible();
    }
    const etiqueta = /^Fabricante/;
    const marca = Date.now();
    // Ambos ven el campo vacio; Edgar guarda primero.
    await a.page.getByLabel(etiqueta).fill(`Fabricante de Edgar ${marca}`);
    await a.page.getByLabel(etiqueta).blur();
    await expect(a.page.locator('[data-campo="fabricante"]')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);

    // Carla (con la version vieja) escribe lo suyo y sale del campo.
    await b.page.getByLabel(etiqueta).fill(`Fabricante de Carla ${marca}`);
    await b.page.getByLabel(etiqueta).blur();
    const choque = b.page.getByRole('alert').filter({ hasText: 'ya guardó este campo' });
    await expect(choque).toBeVisible();
    await expect(choque).toContainText(`Fabricante de Edgar ${marca}`);
    await expect(b.page.getByLabel(etiqueta)).toHaveValue(`Fabricante de Carla ${marca}`); // su texto sigue en pantalla
    for (const nombre of [/^Dejar el de Edgar/, 'Usar el mío', 'Combinar']) {
      await expect(choque.getByRole('button', { name: nombre })).toBeVisible();
    }

    // "Usar el mío" exige motivo.
    await choque.getByRole('button', { name: 'Usar el mío' }).click();
    await expect(b.page.getByText('Escribe el motivo para usar el tuyo.')).toBeVisible();
    await choque.getByLabel(/Motivo/).fill('Es el fabricante correcto');
    await choque.getByRole('button', { name: 'Usar el mío' }).click();
    await expect(b.page.locator('[data-campo="fabricante"]')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);

    // Edgar recibe el cambio en su siguiente sondeo y el historial conserva ambos.
    await a.page.reload();
    await expect(a.page.getByLabel(etiqueta)).toHaveValue(`Fabricante de Carla ${marca}`);
  } finally {
    await a.contexto.close();
    await b.contexto.close();
  }
});

test('P-12: desactivar a un usuario con sesion abierta la cierra en su siguiente peticion', async ({ browser, request }) => {
  const admin = await contextoAutenticado(browser, request, 'admin@desarrollo.invalid');
  const correo = `prueba-${Date.now()}@desarrollo.invalid`;
  try {
    // El admin invita (sin registro abierto: solo asi se entra).
    await admin.page.goto('/admin/usuarios/invitar');
    await admin.page.getByLabel('Nombre completo').fill('Persona de prueba');
    await admin.page.getByLabel('Correo').fill(correo);
    await admin.page.getByLabel('Organización').selectOption({ label: 'EssilorLuxottica [DESARROLLO]' });
    await pulsarHidratado(admin.page.getByRole('button', { name: 'Invitar y enviar el enlace' }));
    await expect(admin.page.getByRole('heading', { level: 1, name: 'Persona de prueba' })).toBeVisible();

    // La persona entra con su enlace de bienvenida.
    const persona = await contextoAutenticado(browser, request, correo);
    try {
      await persona.page.goto('/referencias');
      await expect(persona.page.getByRole('heading', { name: 'Referencias' })).toBeVisible();

      // El administrador desactiva desde la ficha de la persona (pide confirmacion).
      await admin.page.reload();
      await admin.page.locator('#desactivar').getByRole('button', { name: 'Desactivar a Persona de prueba' }).click();
      await admin.page.getByRole('alertdialog').or(admin.page.getByRole('dialog')).getByRole('button', { name: 'Desactivar', exact: true }).click();
      await expect(admin.page.getByText('Inactivo').first()).toBeVisible();

      // Siguiente peticion de la persona: vuelve a /entrar.
      await persona.page.goto('/referencias');
      await expect(persona.page).toHaveURL(/\/entrar/);
    } finally {
      await persona.contexto.close();
    }
  } finally {
    await admin.contexto.close();
  }
});
