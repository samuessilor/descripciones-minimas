/**
 * E2E de administracion y cuenta (H5), en navegador real contra el servidor de desarrollo (`E2E_URL`).
 *
 *  - Un no-admin no entra (ni a las paginas ni al CSV).
 *  - Admin invita -> el invitado entra por el enlace -> reenviar -> cambiar rol -> desactivar con reasignacion
 *    (la sesion de quien se desactiva se cierra en el acto) -> reactivar.
 *  - Partida nueva con su restriccion (sin plantillas: las descripciones minimas las escribe la aduana en la ficha).
 *  - Auditoria con filtros y CSV, cola de correo y vista previa, parametros, mi cuenta (preferencias y sesiones).
 *  - axe sin violaciones serias o criticas, y sin scroll horizontal a 360 px.
 *
 * Reinicia la base LOCAL al empezar (`POST /api/dev/reset`, solo desarrollo): corre contra TU servidor, con TU base
 * (`PGLITE_DIR` propio), nunca contra uno compartido.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect as expectBase, test, type Browser, type Locator, type Page } from '@playwright/test';
import { contextoAutenticado, entrarComo, esperarEnlace, vigilarErrores } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.setTimeout(600_000);
});
test.use({ navigationTimeout: 240_000, actionTimeout: 90_000 });
// En desarrollo la primera visita a cada ruta compila: margen amplio.
const expect = expectBase.configure({ timeout: 120_000 });

const ADMIN = 'admin@desarrollo.invalid';
const SUFIJO = Date.now().toString(36);
const MARTA = { nombre: 'Marta E2E', email: `marta-${SUFIJO}@desarrollo.invalid` };
const CARLOS = { nombre: 'Carlos E2E', email: `carlos-${SUFIJO}@desarrollo.invalid` };
const ANDRES = 'Andrés Aduana A [DESARROLLO]';

/** Aviso (toast) visible: se busca dentro de su region para no chocar con la copia que lee el lector de pantalla. */
const aviso = (page: Page, texto: string | RegExp) => page.getByRole('region', { name: 'Avisos' }).getByText(texto);

/**
 * Pulsa un boton cuando su pagina ya se hidrato. En desarrollo, con la maquina cargada, el HTML llega mucho antes que
 * el JavaScript: un clic en ese hueco no hace nada y la prueba parece fallar sin que la aplicacion falle.
 */
async function pulsar(boton: Locator) {
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

async function graves(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

async function invitar(page: Page, p: { nombre: string; email: string; organizacion: string; rol?: RegExp; area?: string }) {
  await page.goto('/admin/usuarios/invitar');
  await page.getByLabel('Nombre completo').fill(p.nombre);
  await page.getByLabel('Correo').fill(p.email);
  await page.getByLabel('Organización').selectOption({ label: p.organizacion });
  if (p.rol) await page.getByRole('radio', { name: p.rol }).check();
  if (p.area) await page.getByLabel(/^Área/).selectOption(p.area);
  await pulsar(page.getByRole('button', { name: 'Invitar y enviar el enlace' }));
  await expect(page.getByRole('heading', { level: 1, name: p.nombre })).toBeVisible();
}

async function entrarConEnlace(browser: Browser, request: Parameters<typeof esperarEnlace>[0], email: string) {
  const contexto = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await contexto.newPage();
  const enlace = await esperarEnlace(request, email);
  await page.goto(enlace);
  await pulsar(page.getByRole('button', { name: 'Entrar', exact: true }));
  await expect(page).not.toHaveURL(/\/entrar/, { timeout: 120_000 });
  return { contexto, page };
}

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/dev/reset?ejemplos=0', { maxRetries: 3 });
  expect(r.ok(), 'POST /api/dev/reset (solo desarrollo)').toBe(true);
});

test('un no-admin no entra: ve el aviso de permiso, sin trazas, y no descarga la auditoria', async ({ browser, request }) => {
  for (const email of ['solicitante@desarrollo.invalid', 'aduana-a@desarrollo.invalid', 'lector@desarrollo.invalid']) {
    const { contexto, page } = await contextoAutenticado(browser, request, email);
    const errores = vigilarErrores(page);
    for (const ruta of ['/admin', '/admin/usuarios', '/admin/auditoria', '/admin/correo', '/admin/parametros']) {
      await page.goto(ruta);
      await expect(page.getByRole('heading', { name: 'No tienes permiso para ver esto' }), `${email} ${ruta}`).toBeVisible();
      await expect(page.getByText(/Error:|at .*\.tsx|stack/i)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /^(Administración|Usuarios|Auditoría|Cola de correo|Parámetros)$/ })).toHaveCount(0); // ni el titulo de la seccion
    }
    // el menu no ofrece la administracion
    await expect(page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Administración' })).toHaveCount(0);
    // ni la accion ni la descarga
    const csv = await page.request.get('/api/admin/auditoria/exportar');
    expect(csv.status(), email).toBe(403);
    expect(await csv.text()).not.toMatch(/invitar|login/);
    expect(errores.filter((e) => !/403|permiso/.test(e)), errores.join('\n')).toEqual([]);
    await contexto.close();
  }
});

test('admin invita, el invitado entra por el enlace, se le reenvia el acceso y se le cambia el rol', async ({ browser, request, page }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Administración' })).toBeVisible();
  await expect(page.getByText('personas aún no han entrado')).toBeVisible();

  await invitar(page, { nombre: MARTA.nombre, email: MARTA.email, organizacion: 'EssilorLuxottica [DESARROLLO]', rol: /^Solicitante/, area: 'Consumibles' });
  await expect(page.getByText('Sin ingresar').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reenviar invitación' })).toBeVisible();

  // Un correo repetido da el error en el campo, sin crear otra persona.
  await page.goto('/admin/usuarios/invitar');
  await page.getByLabel('Nombre completo').fill('Otra Marta');
  await page.getByLabel('Correo').fill(MARTA.email.toUpperCase());
  await pulsar(page.getByRole('button', { name: 'Invitar y enviar el enlace' }));
  await expect(page.getByText('Ya existe un usuario con ese correo.').first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/usuarios\/invitar/);

  // La invitada entra por el enlace del correo.
  const marta = await entrarConEnlace(browser, request, MARTA.email);
  await expect(marta.page.getByRole('heading', { name: /Hola, Marta/ })).toBeVisible();
  await marta.page.goto('/admin/usuarios');
  await expect(marta.page.getByRole('heading', { name: 'No tienes permiso para ver esto' })).toBeVisible(); // solicitante: sin administracion
  await marta.contexto.close();

  // El administrador ve que ya entro y le envia un enlace nuevo.
  await page.goto('/admin/usuarios');
  await page.locator('#f-q').fill('marta');
  await pulsar(page.getByRole('button', { name: 'Filtrar' }));
  await page.getByRole('link', { name: `Abrir a ${MARTA.nombre}` }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: MARTA.nombre })).toBeVisible();
  await expect(page.getByText('Sin ingresar')).toHaveCount(0);
  await request.post('/api/dev/limites', { maxRetries: 3 }); // la espera de 30 s entre enlaces es una regla del producto
  await pulsar(page.getByRole('button', { name: 'Enviar enlace de acceso' }));
  await expect(aviso(page, `Enviamos un enlace de acceso nuevo a ${MARTA.nombre}.`)).toBeVisible();
  const correos = (await (await request.get(`/api/dev/correo?para=${encodeURIComponent(MARTA.email)}&limite=10`, { maxRetries: 3 })).json()) as unknown[];
  expect(correos.length).toBeGreaterThanOrEqual(2);

  // Cambia el rol.
  await page.getByRole('radio', { name: /^Lector/ }).check();
  await pulsar(page.getByRole('button', { name: 'Cambiar rol' }));
  await expect(aviso(page, 'Cambiamos el rol.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Lector/ })).toBeChecked();
  await expect(page.getByText('Lector').first()).toBeVisible();
});

test('desactivar con pendientes obliga a reasignar y cierra la sesion al instante; luego se reactiva', async ({ browser, request, page }) => {
  await entrarComo(page, request, ADMIN);
  // Una persona de la misma agencia que recibira lo pendiente.
  await invitar(page, { nombre: CARLOS.nombre, email: CARLOS.email, organizacion: 'Agencia Demo A [DESARROLLO]' });
  await expect(page.getByText('Rol: Aduana').first()).toBeVisible();

  // Andres entra y deja una sesion abierta en otro navegador.
  const andres = await contextoAutenticado(browser, request, 'aduana-a@desarrollo.invalid');
  await andres.page.goto('/');
  await expect(andres.page).not.toHaveURL(/\/entrar/);

  await page.goto('/admin/usuarios');
  await page.getByRole('link', { name: `Abrir a ${ANDRES}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Andrés Aduana A/ })).toBeVisible();
  await expect(page.getByText('Sesiones abiertas')).toBeVisible();
  await expect(page.getByText(/Chrome en Windows|Chrome en Mac|Chrome en Linux|Chrome/).first()).toBeVisible();

  const desactivar = page.locator('#desactivar');
  await expect(desactivar.getByText(/tiene 1 referencia pendiente\. ¿A quién la reasignas\?/)).toBeVisible();
  await expect(desactivar.getByRole('link', { name: 'TEST-0002' })).toBeVisible();
  const boton = desactivar.getByRole('button', { name: 'Reasignar y desactivar' });
  await expect(boton).toBeDisabled(); // sin destino no se puede
  await expect(desactivar.getByText('0 de 1 con nueva persona.')).toBeVisible();

  const selector = desactivar.getByLabel('Reasignar TEST-0002 a');
  const valor = await selector.locator('option', { hasText: CARLOS.nombre }).getAttribute('value');
  expect(valor).toBeTruthy();
  await selector.selectOption(valor!);
  await expect(desactivar.getByText('Todas tienen nueva persona.')).toBeVisible();
  await expect(boton).toBeEnabled();
  await boton.click();
  await expect(aviso(page, /Desactivamos al usuario, reasignamos 1 referencia y cerramos \d+ sesi/)).toBeVisible();
  await expect(page.getByText('Inactivo').first()).toBeVisible();

  // Su sesion ya no vale: la siguiente peticion vuelve a /entrar.
  await andres.page.goto('/referencias');
  await expect(andres.page).toHaveURL(/\/entrar/);
  await andres.contexto.close();

  // Lo pendiente quedo con Carlos.
  await page.goto('/admin/usuarios');
  await page.getByRole('link', { name: `Abrir a ${CARLOS.nombre}` }).click();
  await expect(page.getByText('1 referencia', { exact: true })).toBeVisible();

  // Reactivar.
  await page.goto('/admin/usuarios');
  await page.getByRole('link', { name: `Abrir a ${ANDRES}` }).click();
  await pulsar(page.getByRole('button', { name: /Reactivar a Andrés/ }));
  await pulsar(page.getByRole('dialog').getByRole('button', { name: 'Reactivar', exact: true }));
  await expect(aviso(page, 'Reactivamos al usuario.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Inactivo')).toHaveCount(0);
});

test('organizaciones: crear un area, una agencia y retirar el acceso de una agencia a una referencia', async ({ page, request }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/admin/organizaciones');
  await page.getByLabel('Nombre', { exact: true }).fill(`Agencia Globalco ${SUFIJO}`);
  await page.getByRole('radio', { name: /^Agencia de aduana/ }).check();
  await pulsar(page.getByRole('button', { name: 'Crear organización' }));
  await expect(aviso(page, 'Creamos la organización.')).toBeVisible();
  await expect(page.getByRole('link', { name: `Abrir Agencia Globalco ${SUFIJO}` })).toBeVisible();

  // Nombre repetido: error en el campo.
  await page.getByLabel('Nombre', { exact: true }).fill(`Agencia Globalco ${SUFIJO}`);
  await pulsar(page.getByRole('button', { name: 'Crear organización' }));
  await expect(page.getByText('Ya existe una organización con ese nombre.').first()).toBeVisible();

  // Una organizacion con gente activa no se desactiva; se explica por que.
  await page.getByRole('link', { name: 'Abrir EssilorLuxottica [DESARROLLO]' }).click();
  await expect(page.getByText('No se puede desactivar todavía')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Desactivar organización' })).toBeDisabled();

  // Retirar el acceso de la Agencia Demo A a TEST-0002.
  await page.goto('/admin/organizaciones');
  await page.getByRole('link', { name: 'Abrir Agencia Demo A [DESARROLLO]' }).click();
  await expect(page.getByRole('heading', { name: 'Referencias con acceso' })).toBeVisible();
  await expect(page.getByText('TEST-0002').first()).toBeVisible();
  await pulsar(page.getByRole('button', { name: /Retirar acceso de Agencia Demo A \[DESARROLLO\] a TEST-0002/ }));
  const dialogo = page.getByRole('dialog', { name: /Retirar el acceso a TEST-0002/ });
  await expect(dialogo.getByText(/Lo que escribió se conserva/)).toBeVisible();
  await pulsar(dialogo.getByRole('button', { name: 'Retirar acceso' }));
  await expect(aviso(page, /Retiramos el acceso\. La agencia ya no ve esta referencia/)).toBeVisible();
  await expect(page.getByText('No tiene referencias abiertas')).toBeVisible();
});

test('partida nueva con su restricción; las plantillas ya no existen', async ({ page, request }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/admin/catalogos?seccion=partidas');
  await page.locator('#nueva-partida').getByLabel('Partida', { exact: true }).fill('8413 70 00 00');
  await page.locator('#nueva-partida').getByLabel('Descripción').fill('Bombas centrífugas');
  await page.locator('#nueva-partida').getByLabel('Restricción').selectOption({ label: 'RES-SIN' });
  await expect(page.locator('#nueva-partida').getByLabel('Plantilla de preguntas')).toHaveCount(0);
  await pulsar(page.locator('#nueva-partida').getByRole('button', { name: 'Crear partida' }));
  await expect(aviso(page, 'Guardamos la partida 8413.70.00.00.')).toBeVisible();
  await expect(page.getByText('8413.70.00.00').first()).toBeVisible();
  await expect(page.getByText('Bombas centrífugas · Restricción: RES-SIN').first()).toBeVisible();

  // La pantalla de plantillas ya no existe ni aparece en el menu de administracion.
  const r = await page.goto('/admin/plantillas');
  expect(r?.status()).toBe(404);
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: /^Plantillas/ })).toHaveCount(0);
});
test('catalogos: agregar y desactivar un valor, paises y tipos de producto de solo lectura', async ({ page, request }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/admin/catalogos');
  await page.getByLabel('Valor', { exact: true }).fill('Metros');
  await pulsar(page.getByRole('button', { name: 'Agregar al final de la lista' }));
  await expect(aviso(page, 'Agregamos el valor al final de la lista.')).toBeVisible();
  await expect(page.getByText('Metros', { exact: true })).toBeVisible();
  await pulsar(page.getByRole('button', { name: 'Desactivar Metros' }));
  await expect(aviso(page, /Desactivamos el valor\. Ya no se ofrece/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activar Metros' })).toBeVisible();

  await page.goto('/admin/catalogos?seccion=paises');
  await expect(page.getByText('Francia').first()).toBeVisible();
  await expect(page.getByText('China').first()).toBeVisible();
  await page.goto('/admin/catalogos?seccion=tipos');
  for (const t of ['Insumo', 'Repuesto', 'Accesorio']) await expect(page.getByText(t).first()).toBeVisible();
  await expect(page.getByText('Fijo').first()).toBeVisible();
});

test('auditoria: filtros, detalle y CSV; cola de correo y vista previa; parametros', async ({ page, request }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/admin/auditoria');
  await expect(page.locator('tbody').getByText('Invitó a una persona').first()).toBeVisible();
  await page.getByLabel('Acción').selectOption({ label: 'Invitó a una persona' });
  await pulsar(page.getByRole('button', { name: 'Filtrar' }));
  await expect(page).toHaveURL(/accion=invitar/);
  const filas = page.getByRole('table').first().locator('tbody tr');
  expect(await filas.count()).toBeGreaterThanOrEqual(2);
  for (const t of await filas.locator('td:nth-child(3)').allInnerTexts()) expect(t).toContain('Invitó a una persona');
  await filas.first().getByText('Ver detalle').click();
  await expect(page.getByText('Dirección IP').first()).toBeVisible();

  // CSV: BOM, encabezados, el filtro se respeta y deja constancia en la propia auditoria.
  const href = await page.getByRole('link', { name: 'Descargar CSV' }).getAttribute('href');
  expect(href).toContain('accion=invitar');
  const csv = await page.request.get(href!);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  expect(csv.headers()['content-disposition']).toMatch(/auditoria-\d{4}-\d{2}-\d{2}\.csv/);
  const texto = await csv.text();
  expect(texto.startsWith('﻿')).toBe(true);
  expect(texto).toContain('id,fecha_bogota,persona');
  const lineas = texto.trim().split('\r\n').slice(1);
  expect(lineas.length).toBeGreaterThanOrEqual(2);
  for (const l of lineas) expect(l).toContain(',invitar,');
  await page.goto('/admin/auditoria?accion=exportar');
  await expect(page.locator('tbody').getByText('Descargó una exportación').first()).toBeVisible();

  // Una referencia que no existe lo dice.
  await page.goto('/admin/auditoria?ficha=NO-EXISTE-99');
  await expect(page.getByText('No existe esa referencia')).toBeVisible();

  // Cola de correo: los correos de acceso salieron por consola y se pueden ver (token tapado).
  await page.goto('/admin/correo');
  await expect(page.getByRole('heading', { level: 1, name: 'Cola de correo' })).toBeVisible();
  await expect(page.getByText('Correos de desarrollo')).toBeVisible();
  await page.getByRole('link', { name: `Ver el correo de desarrollo a ${MARTA.email}` }).first().click();
  await expect(page.getByText('Cómo lo ve quien lo recibe')).toBeVisible();
  const marco = page.frameLocator('iframe[title^="Vista previa del correo"]');
  await expect(marco.locator('p').filter({ hasText: /te dio acceso a Descripciones mínimas/ }).first()).toBeVisible();
  await expect(page.getByText('token=••••••').first()).toBeVisible();
  expect(await page.content()).not.toMatch(/token=[A-Za-z0-9_-]{12,}/);

  // Parametros: solo lectura, con como cambiarlos y sin secretos.
  await page.goto('/admin/parametros');
  await expect(page.getByText('Se cambian por variables de entorno')).toBeVisible();
  for (const t of ['CIERRE_MODO', 'ENLACE_VIGENCIA_MINUTOS', 'RECORDATORIO_MANUAL_MAX_DIA', 'Pedir enlace, por correo']) await expect(page.getByText(t).first()).toBeVisible();
  const cuerpo = await page.locator('main').innerText();
  expect(cuerpo).not.toMatch(/postgres(ql)?:\/\/|smtp:\/\/|re_[A-Za-z0-9]{10,}/);
  await expect(page.getByRole('textbox')).toHaveCount(0); // nada que editar
});

test('mi cuenta: preferencias que persisten y cierre de las otras sesiones', async ({ browser, request, page }) => {
  await entrarComo(page, request, ADMIN);
  await page.goto('/cuenta');
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByText('Esta sesión', { exact: true })).toBeVisible();

  // Con AVISOS_POR_CORREO apagado (el valor por defecto) no se ofrece elegir el canal: no tendria efecto.
  await expect(page.getByText('Los avisos llegan a la campana y a «Para mí».')).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Avísame por correo/ })).toHaveCount(0);
  await page.getByRole('switch', { name: /Atajo «\/»/ }).uncheck();
  await pulsar(page.getByRole('button', { name: 'Guardar preferencias' }));
  await expect(aviso(page, 'Guardamos tus preferencias.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('switch', { name: /Atajo «\/»/ })).not.toBeChecked();
  await page.getByRole('switch', { name: /Atajo «\/»/ }).check();
  await pulsar(page.getByRole('button', { name: 'Guardar preferencias' }));
  await expect(aviso(page, 'Guardamos tus preferencias.')).toBeVisible();

  // Otra sesion del mismo usuario: se cierra desde esta, y ella vuelve a /entrar.
  const otra = await contextoAutenticado(browser, request, ADMIN);
  await page.reload();
  await pulsar(page.getByRole('button', { name: /Cerrar las otras \(\d+\)/ }));
  await pulsar(page.getByRole('dialog').getByRole('button', { name: 'Cerrar las otras' }));
  await expect(aviso(page, /Cerramos \d+ sesi.*Esta sigue abierta\./)).toBeVisible();
  await otra.page.goto('/cuenta');
  await expect(otra.page).toHaveURL(/\/entrar/);
  await otra.contexto.close();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible(); // la actual sigue viva
});

const PAGINAS = [
  '/admin',
  '/admin/usuarios',
  '/admin/usuarios/invitar',
  '/admin/organizaciones',
  '/admin/catalogos',
  '/admin/catalogos?seccion=paises',
  '/admin/catalogos?seccion=restricciones',
  '/admin/catalogos?seccion=partidas',
  '/admin/auditoria',
  '/admin/correo',
  '/admin/parametros',
  '/cuenta',
];

// Las de detalle se alcanzan desde su lista (el primer enlace «Abrir …» visible).
const DETALLES = [
  ['/admin/usuarios', /^Abrir a /],
  ['/admin/organizaciones', /^Abrir /],
] as const;

/** Una pagina en escritorio (axe) y a 360 px (sin scroll horizontal y axe). Un caso por pantalla: si una falla, las demas siguen. */
async function revisar(page: Page, etiqueta: string) {
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(await graves(page), `escritorio ${etiqueta}`).toEqual([]);
  await page.setViewportSize({ width: 360, height: 740 });
  const { ancho, visible } = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: document.documentElement.clientWidth }));
  expect(ancho, `${etiqueta}: desborde horizontal a 360 px (${ancho} > ${visible})`).toBeLessThanOrEqual(visible);
  expect(await graves(page), `360 px ${etiqueta}`).toEqual([]);
}

test.describe('accesibilidad (axe) y movil 360 px', () => {
  test.describe.configure({ mode: 'default' });

  for (const ruta of PAGINAS) {
    test(`axe + 360 px: ${ruta}`, async ({ page, request }) => {
      await entrarComo(page, request, ADMIN);
      const errores = vigilarErrores(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(ruta);
      await revisar(page, ruta);
      expect(errores.filter((e) => !/\/api\/dev\//.test(e)), errores.join('\n')).toEqual([]);
    });
  }

  for (const [lista, enlace] of DETALLES) {
    test(`axe + 360 px: detalle desde ${lista}`, async ({ page, request }) => {
      await entrarComo(page, request, ADMIN);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(lista);
      await page.getByRole('link', { name: enlace }).first().click();
      await revisar(page, `detalle de ${lista}`);
    });
  }
});
