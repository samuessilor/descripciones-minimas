/**
 * E2E de la fundacion visual: entrada (estados), armazon (saltar al contenido, menu de usuario, navegacion),
 * biblioteca de componentes en /dev/ui (teclado: dialogo, popover, menu, pestanas, combobox, avisos),
 * accesibilidad con axe (cero violaciones serias o criticas) y movil a 360 px.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo, vigilarErrores } from './ayudas';

async function graves(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function sinDesbordeHorizontal(page: Page, ruta: string) {
  const { ancho, visible } = await page.evaluate(() => ({
    ancho: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  expect(ancho, `${ruta}: scrollWidth ${ancho} > clientWidth ${visible}`).toBeLessThanOrEqual(visible);
}

test.describe('entrada', () => {
  test('correo invalido: el error va debajo del campo, enlazado y con aria-invalid; sin errores de consola', async ({ page, request }) => {
    const errores = vigilarErrores(page);
    await request.post('/api/dev/limites', { maxRetries: 3 });
    await page.goto('/entrar');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'EssilorLuxottica' }).first()).toBeVisible();
    await page.getByLabel('Correo').fill('no-es-un-correo');
    await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
    const campo = page.getByLabel('Correo');
    await expect(page.getByText('Escribe un correo válido.')).toBeVisible();
    await expect(campo).toHaveAttribute('aria-invalid', 'true');
    const describe = await campo.getAttribute('aria-describedby');
    expect(describe).toContain('-error');
    expect(await graves(page)).toEqual([]);
    expect(errores, errores.join('\n')).toEqual([]);
  });

  test('enlace pedido: confirmacion visible, boton «Reenviar en N s» y cero violaciones', async ({ page, request }) => {
    await request.post('/api/dev/limites', { maxRetries: 3 });
    await page.goto('/entrar');
    await page.getByLabel('Correo').fill('admin@desarrollo.invalid');
    await page.getByRole('button', { name: 'Enviarme el enlace' }).click();
    await expect(page.getByText('Revisa tu correo')).toBeVisible();
    await expect(page.getByText(/Si ese correo tiene acceso/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Reenviar en \d+ s/ })).toBeDisabled();
    expect(await graves(page)).toEqual([]);
  });

  test('confirmar: sin token y con un token que no existe dicen que paso y ofrecen pedir otro', async ({ page }) => {
    await page.goto('/entrar/confirmar');
    await expect(page.getByRole('heading', { level: 1, name: 'No pudimos usar este enlace' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir uno nuevo' })).toHaveAttribute('href', '/entrar');

    await page.goto('/entrar/confirmar?token=desconocido&siguiente=%2Freferencias');
    await expect(page.getByRole('heading', { level: 1, name: 'Confirma que eres tú' })).toBeVisible();
    expect(await graves(page)).toEqual([]);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /enlace/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pedir uno nuevo' })).toHaveAttribute('href', '/entrar?siguiente=%2Freferencias');
    expect(await graves(page)).toEqual([]);
  });
});

test.describe('armazon', () => {
  test('saltar al contenido, landmarks, menu de usuario con teclado, cierre de sesion y cero violaciones', async ({ page, request }) => {
    const errores = vigilarErrores(page);
    await entrarComo(page, request, 'admin@desarrollo.invalid');
    await page.goto('/notificaciones');
    await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones' })).toBeVisible();

    // Landmarks
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' }).first()).toBeVisible();

    // La bandeja de avisos es una pantalla real: filtros y lista (o su estado vacio)
    await expect(page.getByRole('navigation', { name: 'Filtrar avisos' })).toBeVisible();

    // Saltar al contenido: primer Tab, Enter, el foco cae en <main>
    await page.goto('/notificaciones');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#contenido')).toBeFocused();

    // La pagina actual se marca en la navegacion
    const nav = page.getByRole('navigation', { name: 'Principal' }).first();
    await expect(nav.getByRole('link', { name: 'Notificaciones', exact: true })).toHaveAttribute('aria-current', 'page');

    // Menu de usuario
    const boton = page.getByRole('button', { name: 'Ana Admin' });
    await boton.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Cuenta' });
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Administrador')).toBeVisible();
    await expect(menu.getByText('admin@desarrollo.invalid')).toBeVisible();
    expect(await graves(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(boton).toBeFocused();

    // Cerrar sesion
    await boton.click();
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/entrar/);
    expect(errores, errores.join('\n')).toEqual([]);
  });

  test('inicio: cero violaciones y administracion solo para el admin', async ({ page, request }) => {
    await entrarComo(page, request, 'solicitante@desarrollo.invalid');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Principal' }).first();
    await expect(nav.getByRole('link', { name: 'Administración' })).toHaveCount(0);
    expect(await graves(page)).toEqual([]);
  });

  test('404 dentro del armazon: texto del rol y salida', async ({ page, request }) => {
    await entrarComo(page, request, 'solicitante@desarrollo.invalid');
    const r = await page.goto('/referencias/00000000-0000-4000-8000-000000000000');
    expect(r?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'No encontramos esa página' })).toBeVisible();
    await expect(page.getByText('No encontramos esa referencia. Revisa el enlace o búscala por código.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ir a Referencias' })).toBeVisible();
    await expect(page.getByRole('banner')).toBeVisible(); // la barra sigue ahi
    expect(await graves(page)).toEqual([]);
  });
});

test.describe('biblioteca /dev/ui', () => {
  test('carga sin errores y sin violaciones serias o criticas', async ({ page }) => {
    const errores = vigilarErrores(page);
    await page.goto('/dev/ui');
    await expect(page.getByRole('heading', { level: 1, name: /Laboratorio ordenado/ })).toBeVisible();
    expect(await graves(page)).toEqual([]);
    expect(errores, errores.join('\n')).toEqual([]);
  });

  test('dialogo: foco atrapado, Esc cierra y el foco vuelve al boton', async ({ page }) => {
    await page.goto('/dev/ui');
    const abrir = page.getByRole('button', { name: 'Abrir diálogo' });
    await abrir.focus();
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: /Enviar TEST-0001/ });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel('¿A quién?')).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog')), `Tab ${i + 1} salio del dialogo`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(abrir).toBeFocused();
  });

  test('confirmacion con motivo: el boton espera un motivo visible y avisa al terminar', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Confirmar con motivo' }).click();
    const dlg = page.getByRole('dialog', { name: 'Reabrir la clasificación' });
    const reabrir = dlg.getByRole('button', { name: 'Reabrir' });
    await expect(reabrir).toBeDisabled();
    await dlg.getByLabel('Motivo').fill('​  ');
    await expect(reabrir).toBeDisabled(); // un motivo invisible no cuenta (SPEC 9.3)
    await dlg.getByLabel('Motivo').fill('La partida estaba mal');
    await expect(reabrir).toBeEnabled();
    await reabrir.click();
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('list').getByText('Clasificación reabierta')).toBeVisible();
  });

  test('cajon: abre, Esc cierra y devuelve el foco', async ({ page }) => {
    await page.goto('/dev/ui');
    const abrir = page.getByRole('button', { name: 'Abrir cajón' });
    await abrir.click();
    const cajon = page.getByRole('dialog', { name: 'Historial' });
    await expect(cajon).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(cajon).toBeHidden();
    await expect(abrir).toBeFocused();
  });

  test('popover y menu: se abren, se navegan con flechas, Esc cierra y devuelve el foco', async ({ page }) => {
    await page.goto('/dev/ui');
    const pop = page.getByRole('button', { name: 'Popover' });
    await pop.click();
    await expect(page.getByText('Contenido libre')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Contenido libre')).toBeHidden();
    await expect(pop).toBeFocused();

    const menu = page.getByRole('button', { name: 'Descargar Excel' });
    await menu.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Lo que veo (25 filas)' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Toda la base' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Ir a esta sección' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
  });

  test('pestanas: flechas cambian la activa y el panel', async ({ page }) => {
    await page.goto('/dev/ui');
    const tab1 = page.getByRole('tab', { name: /Para mí/ });
    await tab1.focus();
    await expect(tab1).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    const tab2 = page.getByRole('tab', { name: /Esperando a otros/ });
    await expect(tab2).toHaveAttribute('aria-selected', 'true');
    await expect(tab2).toBeFocused();
    await expect(page.getByRole('tabpanel')).toContainText('Las 7 que enviaste');
    await page.keyboard.press('Home');
    await expect(tab1).toHaveAttribute('aria-selected', 'true');
  });

  test('combobox: busca sin tildes, Enter elige, Esc cierra y el valor viaja en el campo oculto', async ({ page }) => {
    await page.goto('/dev/ui');
    const combo = page.getByRole('combobox', { name: 'País de origen' });
    await combo.click();
    await page.keyboard.type('panam');
    await expect(page.getByRole('option', { name: /Panamá/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(combo).toHaveValue('Panamá');
    await expect(page.locator('input[name="pais"]')).toHaveValue('PA');
    await combo.click();
    await page.keyboard.type('zzzz');
    await expect(page.getByText('No hay coincidencias')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(combo).toHaveValue('Panamá'); // lo escrito sin elegir no se queda
  });

  test('avisos: exito desaparece solo; el error NO desaparece y se cierra a mano', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: 'Error (no se va solo)' }).click();
    await page.getByRole('button', { name: 'Éxito' }).click();
    const lista = page.locator('[popover][aria-label="Avisos"]');
    const exito = lista.getByText('Enviamos el aviso a Brian', { exact: true });
    const error = lista.getByText('No pudimos enviar el aviso', { exact: true });
    await expect(exito).toBeVisible();
    await expect(error).toBeVisible();
    await expect(exito).toBeHidden({ timeout: 9000 });
    await expect(error).toBeVisible();
    await lista.getByRole('button', { name: /Cerrar aviso/ }).click();
    await expect(lista).toBeHidden();
  });

  test('seccion de la ficha: el encabezado pliega y el estado se lee con icono y texto', async ({ page }) => {
    await page.goto('/dev/ui');
    const boton = page.getByRole('button', { name: /Producto/ });
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await expect(boton).toContainText('Completa');
    await expect(page.getByRole('button', { name: /Detalle/ })).toContainText('Faltan 3 campos de 8');
  });
});

test.describe('movil 360 px', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('entrada y biblioteca no desbordan; barra inferior y hoja «Más» con cierre de sesion', async ({ page, request }) => {
    await page.goto('/entrar');
    await page.waitForLoadState('networkidle');
    await sinDesbordeHorizontal(page, '/entrar');
    expect(await graves(page)).toEqual([]);

    await page.goto('/dev/ui');
    await page.waitForLoadState('networkidle');
    await sinDesbordeHorizontal(page, '/dev/ui');

    await entrarComo(page, request, 'admin@desarrollo.invalid');
    await page.goto('/notificaciones');
    await page.waitForLoadState('networkidle');
    await sinDesbordeHorizontal(page, '/notificaciones');
    const barra = page.getByRole('navigation', { name: 'Principal' }).last();
    await expect(barra).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(1); // el lateral no se ve (solo la barra inferior)
    expect(await graves(page)).toEqual([]);

    await barra.getByRole('button', { name: 'Más' }).click();
    const hoja = page.getByRole('dialog', { name: 'Más' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByRole('link', { name: 'Administración' })).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hoja).toBeHidden();
  });

  test('la ficha puede ocultar la barra inferior con el marcador data-sin-barra-inferior', async ({ page, request }) => {
    await entrarComo(page, request, 'solicitante@desarrollo.invalid');
    await page.goto('/referencias'); // el marcador lo pone la ficha (ya lo trae); aqui se prueba el mecanismo en una pagina sin el
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(1); // por defecto se ve
    await page.evaluate(() => {
      const m = document.createElement('span');
      m.hidden = true;
      m.setAttribute('data-sin-barra-inferior', '');
      document.body.appendChild(m);
    });
    await expect(page.getByRole('navigation', { name: 'Principal' })).toHaveCount(0);
  });
});
