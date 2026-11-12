/**
 * E2E de la reunion del 2026-11-10, en navegador real contra el servidor de desarrollo (E2E_URL):
 *  - el orden nuevo de la ficha (Producto / Detalle) y Arancel + IVA en la zona de la aduana;
 *  - el aviso grande para designar la agencia aduanera cuando las tres secciones estan completas;
 *  - eliminar una referencia (boton arriba a la derecha) solo para administrador y supervisora;
 *  - el administrador ve el usuario y la contrasena de una cuenta; eliminar una cuenta y una agencia;
 *  - «Mi cuenta» y la ficha de la cuenta ya no listan sesiones abiertas.
 */
import { expect as esperar, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { abrirSeccion, abrirTodo, BLOQUES_ADUANA, contextoAutenticado, entrarComo, pulsarHidratado, vigilarErrores } from './ayudas';

const expect = esperar.configure({ timeout: 60_000 });
test.describe.configure({ mode: 'serial', timeout: 300_000 });
test.use({ navigationTimeout: 120_000, actionTimeout: 60_000 });

const SUFIJO = Date.now().toString(36).toUpperCase();
const FORMATO_CLAVE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;

async function preparar(request: APIRequestContext, baseURL: string, codigo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await request.post('/api/dev/aduana-preparar', { headers: { origin: baseURL }, data: { codigo, ...extra }, maxRetries: 3 });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { id: string }).id;
}

const clavesDeCampo = (page: Page, seccion: string) =>
  page.evaluate((s) => [...document.querySelectorAll(`#${s} [data-campo]`)].map((el) => (el as HTMLElement).dataset.campo ?? ''), seccion);

let admin: { contexto: BrowserContext; page: Page };
let supervisora: { contexto: BrowserContext; page: Page };
let area: { contexto: BrowserContext; page: Page };
let aduana: { contexto: BrowserContext; page: Page };

test.beforeAll(async ({ browser, request }) => {
  const r = await request.post('/api/dev/reset?ejemplos=0', { maxRetries: 3 });
  expect(r.ok(), 'POST /api/dev/reset (solo desarrollo)').toBe(true);
  admin = await contextoAutenticado(browser as Browser, request, 'admin@desarrollo.invalid');
  supervisora = await contextoAutenticado(browser as Browser, request, 'supervisor@desarrollo.invalid');
  area = await contextoAutenticado(browser as Browser, request, 'solicitante@desarrollo.invalid');
  aduana = await contextoAutenticado(browser as Browser, request, 'aduana-a@desarrollo.invalid');
});
test.afterAll(async () => {
  for (const c of [admin, supervisora, area, aduana]) await c?.contexto.close();
});

test('la ficha sigue el orden nuevo: Producto es identificación y compra, Detalle empieza por nombre comercial, uso, máquina, función y fabricante', async ({ request, baseURL }) => {
  const id = await preparar(request, baseURL as string, `TEST-ORD-${SUFIJO}`, { tipo: 'REPUESTO' });
  const errores = vigilarErrores(admin.page);
  await admin.page.goto(`/referencias/${id}`);
  await abrirTodo(admin.page);

  const producto = (await clavesDeCampo(admin.page, 'producto')).filter((c) => c !== 'codigo');
  expect(producto.slice(0, 7)).toEqual(['nombre_producto', 'tipo_producto', 'area_responsable', 'pais_origen', 'unidad_medida', 'proveedor', 'reembolsable'].filter((c) => producto.includes(c)));
  const orden = (lista: string[], esperado: string[]) => esperado.map((c) => lista.indexOf(c));
  const p = orden(producto, ['tipo_producto', 'area_responsable', 'pais_origen', 'unidad_medida', 'proveedor', 'reembolsable']);
  expect(p.every((n) => n >= 0)).toBe(true);
  expect([...p].sort((a, b) => a - b)).toEqual(p);
  expect(producto).not.toContain('uso');
  expect(producto).not.toContain('fabricante');
  expect(producto).not.toContain('descripcion_factura');

  const detalle = await clavesDeCampo(admin.page, 'detalle');
  const d = orden(detalle, ['descripcion_factura', 'uso', 'maquina_destino', 'funciones', 'fabricante', 'materia_constitutiva']);
  expect(d.every((n) => n >= 0), detalle.join(',')).toBe(true);
  expect([...d].sort((a, b) => a - b)).toEqual(d);

  // Las etiquetas pedidas.
  await expect(admin.page.getByLabel(/^Uso\/Función específica del producto$/)).toBeVisible();
  await expect(admin.page.getByLabel(/^Unidad de medida según factura$/)).toBeVisible();
  await expect(admin.page.getByLabel(/^Máquina de destino$/)).toBeVisible();
  expect(errores.filter((e) => !e.includes('/api/dev/'))).toEqual([]);
});

test('la aduana elige arancel e IVA de una lista después de la partida y queda guardado', async ({ request, baseURL }) => {
  const id = await preparar(request, baseURL as string, `TEST-IMP-${SUFIJO}`);
  const p = aduana.page;
  await p.goto(`/aduana-dev/${id}`);
  await expect(p.getByRole('heading', { name: 'Zona de la aduana' })).toBeVisible({ timeout: 60_000 });
  for (const b of BLOQUES_ADUANA) await abrirSeccion(p, b);

  // El orden de los bloques: partida, arancel e IVA, RIM...
  const titulos = await p.locator('[data-zona="aduana"] h3').allInnerTexts();
  const i = titulos.map((t) => /Partida arancelaria/.test(t)).lastIndexOf(true);
  expect(titulos[i + 1]).toMatch(/Arancel e IVA/);

  const arancel = p.locator('[data-campo="arancel"]');
  const iva = p.locator('[data-campo="iva"]');
  await expect(arancel.locator('option')).toHaveText(['Elige el arancel', '0 %', '5 %', '10 %', '15 %']);
  await expect(iva.locator('option')).toHaveText(['Elige el IVA', '0 %', '19 %']);
  await arancel.selectOption('5%');
  await iva.selectOption('19%');
  await expect(p.getByText('Guardado').first()).toBeVisible();

  await p.reload();
  await expect(p.getByRole('heading', { name: 'Zona de la aduana' })).toBeVisible({ timeout: 60_000 });
  await abrirSeccion(p, 'aduana-impuestos');
  await expect(p.locator('[data-campo="arancel"]')).toHaveValue('5%');
  await expect(p.locator('[data-campo="iva"]')).toHaveValue('19%');
});

test('con las tres secciones completas aparece el aviso grande y «Designar» ofrece solo las agencias de aduana', async ({ request, baseURL }) => {
  const codigo = `TEST-DES-${SUFIJO}`;
  const id = await preparar(request, baseURL as string, codigo, { enviar: false });
  const p = area.page;
  await p.goto(`/referencias/${id}`);
  await expect(p.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });

  const aviso = p.getByTestId('designar-aduana');
  await expect(aviso).toBeVisible();
  await expect(aviso.getByRole('heading', { name: 'Las tres secciones están completas' })).toBeVisible();
  // Debajo de las secciones y antes de la zona de la aduana.
  const orden = await p.evaluate(() => {
    const y = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
    return { espec: y('#especificaciones'), aviso: y('[data-testid="designar-aduana"]'), zona: y('#zona-aduana') };
  });
  expect(orden.aviso).toBeGreaterThan(orden.espec);
  expect(orden.aviso).toBeLessThan(orden.zona);

  await pulsarHidratado(aviso.getByTestId('designar-aduana-boton'));
  const dialogo = p.getByRole('dialog', { name: new RegExp(`Designar la agencia aduanera de ${codigo}`) });
  await expect(dialogo).toBeVisible();
  const personas = dialogo.getByRole('group', { name: /Personas a las que puedes enviar/ });
  await expect(personas.getByRole('heading', { name: 'Agentes aduaneros' })).toBeVisible();
  await expect(personas.getByRole('heading', { name: 'Áreas de EssilorLuxottica' })).toHaveCount(0);
  await expect(personas.getByText('Edgar')).toHaveCount(0);

  await personas.getByRole('checkbox').first().check();
  await dialogo.getByRole('button', { name: /^Designar a / }).click();
  // Al terminar el titulo del dialogo cambia («Agencia designada»): se busca por rol, no por el nombre anterior.
  const final = p.getByRole('dialog');
  await expect(final.getByText(/Enviado|Agencia designada/).first()).toBeVisible();
  await final.getByRole('button', { name: 'Listo' }).click();

  // Con agencia designada, el aviso grande ya no sale; queda la cabecera «Pendiente de …».
  await p.reload();
  await expect(p.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });
  await expect(p.getByTestId('designar-aduana')).toHaveCount(0);
  await expect(p.getByTestId('pendiente-de-aduana')).toContainText('Pendiente de');
});

test('solo el administrador y la supervisora ven «Eliminar»; el área y la aduana no', async ({ request, baseURL }) => {
  const id = await preparar(request, baseURL as string, `TEST-PER-${SUFIJO}`);
  for (const [p, ve] of [
    [area.page, false],
    [aduana.page, false],
    [supervisora.page, true],
    [admin.page, true],
  ] as const) {
    await p.goto(`/referencias/${id}`);
    await expect(p.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });
    await expect(p.getByTestId('eliminar-referencia')).toHaveCount(ve ? 1 : 0);
  }
});

test('el administrador elimina una referencia pendiente y la supervisora una cerrada: desaparecen y el código queda libre', async ({ request, baseURL }) => {
  const codigo = `TEST-DEL-${SUFIJO}`;
  const id = await preparar(request, baseURL as string, codigo);
  const p = admin.page;
  await p.goto(`/referencias/${id}`);
  await expect(p.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });
  await pulsarHidratado(p.getByTestId('eliminar-referencia'));
  const dialogo = p.getByRole('dialog', { name: `Eliminar la referencia ${codigo}` });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('No se puede deshacer.')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Todavía no' }).click(); // cancelar no borra nada
  await expect(p.getByTestId('eliminar-referencia')).toBeVisible();
  await pulsarHidratado(p.getByTestId('eliminar-referencia'));
  await p.getByRole('dialog').getByRole('button', { name: 'Eliminar referencia' }).click();
  await expect(p).toHaveURL(/\/referencias$/, { timeout: 60_000 });

  // Ya no existe: ni por la direccion ni en el listado; el codigo se puede crear de nuevo.
  await p.goto(`/referencias/${id}`);
  await expect(p.getByText(/no existe|No encontramos|404/i).first()).toBeVisible();
  await p.goto(`/referencias?q=${encodeURIComponent(codigo)}`);
  await expect(p.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(p.getByRole('heading', { name: `No encontramos «${codigo}»` })).toBeVisible();
  const nueva = await preparar(request, baseURL as string, codigo);
  expect(nueva).not.toBe(id);

  // Una referencia CERRADA la elimina la supervisora.
  const cerrada = await preparar(request, baseURL as string, `TEST-CER-${SUFIJO}`);
  await request.post('/api/dev/aduana-preparar', { headers: { origin: baseURL as string }, data: { codigo: `TEST-CER-${SUFIJO}-B`, enviar: true } });
  const s = supervisora.page;
  await s.goto(`/referencias/${cerrada}`);
  await expect(s.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });
  await pulsarHidratado(s.getByTestId('eliminar-referencia'));
  await s.getByRole('dialog').getByRole('button', { name: 'Eliminar referencia' }).click();
  await expect(s).toHaveURL(/\/referencias$/, { timeout: 60_000 });
});

test('el administrador ve el usuario y la contraseña de una cuenta creada por la supervisora, la copia y esa contraseña entra', async ({ browser, request }) => {
  const nombre = `Agencia Visible ${SUFIJO}`;
  const s = supervisora.page;
  await s.goto('/admin/organizaciones');
  await s.getByLabel('Nombre de la empresa').fill(nombre);
  await pulsarHidratado(s.getByRole('button', { name: /Crear agencia/ }));
  await expect(s.getByText(/Creamos la agencia/).first()).toBeVisible({ timeout: 60_000 });
  // La supervisora NO ve ninguna contrasena.
  await expect(s.getByTestId('credenciales-entrega')).toHaveCount(0);

  const a = admin.page;
  await a.goto('/admin/usuarios');
  await a.getByRole('link', { name: `Abrir a ${nombre}` }).click();
  await expect(a.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
  const usuario = (await a.getByTestId('texto-copiable').first().innerText()).trim();
  expect(usuario).toMatch(/\.aduana$/);
  await expect(a.getByText(/Contraseña actual/)).toHaveCount(0);
  await pulsarHidratado(a.getByTestId('ver-clave-boton'));
  await expect(a.getByText('Contraseña actual')).toBeVisible();
  const clave = (await a.getByTestId('ver-clave').getByTestId('texto-copiable').last().innerText()).trim();
  expect(clave).toMatch(FORMATO_CLAVE);
  await a.getByRole('button', { name: 'Ocultar contraseña' }).click();
  await expect(a.getByText(clave)).toHaveCount(0);

  // Esa contraseña entra de verdad.
  const ctx = await browser.newContext({ locale: 'es-CO' });
  const nueva = await ctx.newPage();
  await entrarComo(nueva, request, usuario, '/', clave);
  await expect(nueva).not.toHaveURL(/\/entrar/);
  await ctx.close();
});

test('«Mi cuenta» y la ficha de una cuenta ya no listan sesiones abiertas, pero siguen el cierre de sesión', async () => {
  const p = admin.page;
  await p.goto('/cuenta');
  await expect(p.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Sesiones abiertas' })).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Cerrar todas mis sesiones' })).toBeVisible();
  await p.goto('/admin/usuarios');
  await p.getByRole('link', { name: /Abrir a Edgar/ }).click();
  await expect(p.getByRole('heading', { level: 1, name: /Edgar/ })).toBeVisible();
  await expect(p.getByRole('heading', { name: 'Sesiones abiertas' })).toHaveCount(0);
});

test('eliminar una cuenta que no trabajó: la ficha lo explica, pide confirmar y se va; con la única cuenta de una agencia se va la agencia', async () => {
  const nombre = `Agencia Efimera ${SUFIJO}`;
  const a = admin.page;
  await a.goto('/admin/organizaciones');
  await a.getByLabel('Nombre de la empresa').fill(nombre);
  await pulsarHidratado(a.getByRole('button', { name: /Crear agencia/ }));
  await expect(a.getByRole('heading', { name: `Agencia creada: ${nombre}` })).toBeVisible({ timeout: 60_000 });

  await a.goto('/admin/usuarios');
  await a.getByRole('link', { name: `Abrir a ${nombre}` }).click();
  await expect(a.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
  await expect(a.getByText(/se elimina también la agencia/).first()).toBeVisible();
  await pulsarHidratado(a.getByRole('button', { name: 'Eliminar cuenta' }));
  await a.getByRole('dialog').getByRole('button', { name: 'Eliminar cuenta' }).click();
  await expect(a).toHaveURL(/\/admin\/usuarios$/, { timeout: 60_000 });
  await expect(a.getByRole('link', { name: `Abrir a ${nombre}` })).toHaveCount(0);
  await a.goto('/admin/organizaciones');
  await expect(a.getByText(nombre)).toHaveCount(0);

  // Una cuenta que SI trabajo (Edgar creo referencias) tambien se puede eliminar: avisa que su nombre queda en el historial (no se pulsa).
  await a.goto('/admin/usuarios');
  await a.getByRole('link', { name: /Abrir a Edgar/ }).click();
  await expect(a.getByRole('heading', { level: 1, name: /Edgar/ })).toBeVisible();
  await expect(a.getByText('No se puede eliminar')).toHaveCount(0);
  await expect(a.getByText(/Ya trabajó en referencias: su cuenta se elimina/)).toBeVisible();
  await expect(a.getByRole('button', { name: 'Eliminar cuenta' })).toBeVisible();
});

test('borrar una agencia desde su página la elimina con su cuenta', async () => {
  const nombre = `Agencia Para Borrar ${SUFIJO}`;
  const a = admin.page;
  await a.goto('/admin/organizaciones');
  await a.getByLabel('Nombre de la empresa').fill(nombre);
  await pulsarHidratado(a.getByRole('button', { name: /Crear agencia/ }));
  await expect(a.getByRole('heading', { name: `Agencia creada: ${nombre}` })).toBeVisible({ timeout: 60_000 });
  await a.goto('/admin/organizaciones');
  await a.getByRole('link', { name: new RegExp(nombre) }).first().click();
  await expect(a.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
  await expect(a.getByText(/Se borra la agencia junto con su cuenta/)).toBeVisible();
  await pulsarHidratado(a.getByRole('button', { name: 'Borrar organización' }));
  await a.getByRole('dialog').getByRole('button', { name: 'Borrar organización' }).click();
  await expect(a).toHaveURL(/\/admin\/organizaciones$/, { timeout: 60_000 });
  await expect(a.getByText(`Borramos ${nombre} y su cuenta.`).first()).toBeVisible(); // el aviso confirma; la lista ya no la trae
  await a.goto('/admin/organizaciones');
  await expect(a.getByText(nombre)).toHaveCount(0);
  await a.goto('/admin/usuarios');
  await expect(a.getByText(nombre)).toHaveCount(0);
});
