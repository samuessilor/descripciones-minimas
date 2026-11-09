/**
 * E2E del lado aduana (H4), en navegador real contra el servidor de desarrollo (E2E_URL):
 * aduana abre una ficha enviada -> escribe la partida -> se copia su restriccion -> cierra con advertencia (sin descripciones
 * minimas) -> verde en la zona y en el listado -> reabrir -> amarillo -> escribe la solicitud de descripciones minimas
 * adicionales -> el area responde -> observaciones «No aplica» -> cierre limpio -> Excel descargado y leido.
 * Las capturas van a `E2E_CAPTURAS` (o a una carpeta temporal): nunca dentro del repositorio.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect as esperar, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirSeccion, BLOQUES_ADUANA, contextoAutenticado, vigilarErrores } from './ayudas';

// Varias areas comparten la maquina y el servidor de desarrollo compila al vuelo: margen amplio.
const expect = esperar.configure({ timeout: 60_000 });

// Las capturas van fuera del repositorio: `E2E_CAPTURAS` o, por defecto, una carpeta temporal del sistema.
const CAPTURAS = process.env.E2E_CAPTURAS ?? join(tmpdir(), 'descripciones-minimas-capturas');
mkdirSync(CAPTURAS, { recursive: true });

const sufijo = Date.now().toString(36).toUpperCase();
const CODIGO = `TEST-ADU-${sufijo}`;

async function preparar(request: APIRequestContext, baseURL: string, codigo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await request.post('/api/dev/aduana-preparar', { headers: { origin: baseURL }, data: { codigo, ...extra }, maxRetries: 3 });
  expect(r.ok(), await r.text()).toBe(true);
  return ((await r.json()) as { id: string }).id;
}

async function abrirZona(page: Page, id: string): Promise<void> {
  await page.goto(`/aduana-dev/${id}`);
  await expect(page.getByRole('heading', { name: 'Zona de la aduana' })).toBeVisible({ timeout: 60_000 });
  // Espera a que la carga termine (el esqueleto desaparece y aparece el primer bloque).
  await expect(page.getByRole('heading', { name: 'Partida arancelaria' })).toBeVisible();
  // Los bloques de la zona arrancan PLEGADOS (reunion 2026-11): las pruebas los abren para trabajar.
  for (const bloque of BLOQUES_ADUANA) await abrirSeccion(page, bloque);
}

const zona = (page: Page) => page.locator('[data-zona="aduana"]');

test.describe.configure({ mode: 'serial', timeout: 180_000 });

let idFicha = '';
let aduana: { contexto: BrowserContext; page: Page };
let area: { contexto: BrowserContext; page: Page };

test.beforeAll(async ({ browser, request, baseURL }) => {
  idFicha = await preparar(request, baseURL as string, CODIGO, { nombre: 'Motor E2E (ejemplo)' });
  aduana = await contextoAutenticado(browser as Browser, request, 'aduana-a@desarrollo.invalid');
  area = await contextoAutenticado(browser as Browser, request, 'solicitante@desarrollo.invalid');
});
test.afterAll(async () => {
  await aduana?.contexto.close();
  await area?.contexto.close();
});

test('la zona de la aduana se ve y no tiene errores de consola', async () => {
  const errores = vigilarErrores(aduana.page);
  await aduana.page.setViewportSize({ width: 1440, height: 900 });
  await abrirZona(aduana.page, idFicha);
  await expect(zona(aduana.page).getByText('Aquí clasificas')).toBeVisible();
  await expect(aduana.page.getByText('Falta la partida arancelaria')).toBeVisible();
  await aduana.page.screenshot({ path: `${CAPTURAS}/10-zona-vacia-1440.png`, fullPage: true });
  expect(errores).toEqual([]);
});

test('partida: la mascara pone los puntos (sin desplegable) y si esta en el catalogo se copia su restricción', async () => {
  const p = aduana.page;
  const campo = p.getByLabel('Número de partida');
  await campo.click();
  await campo.pressSequentially('8501', { delay: 40 });
  await expect(campo).toHaveValue('8501.');
  // Sin desplegable en la partida (el select nativo del cierre si tiene opciones: se mira solo el bloque de la partida).
  await expect(p.getByRole('group', { name: 'Partida arancelaria' }).getByRole('option')).toHaveCount(0);
  await campo.pressSequentially('312000', { delay: 40 });
  await expect(campo).toHaveValue('8501.31.20.00');
  await campo.press('Enter');
  await expect(p.getByText('Copiamos la restricción de esta partida', { exact: true })).toBeVisible();
  // La restriccion de la partida queda visible con el nombre de las normas.
  await expect(p.locator('[data-restricciones]')).toContainText('RETIE');
  await expect(zona(p).getByText('Normas citadas')).toBeVisible();
  await expect(zona(p).getByText('RAEE', { exact: true })).toBeVisible();
  // Las descripciones minimas son un texto que escribe la aduana: todavia vacio.
  await expect(p.getByLabel('Lo que la aduana necesita saber')).toHaveValue('');
  await p.screenshot({ path: `${CAPTURAS}/12-partida-y-restriccion-1440.png`, fullPage: true });
});
test('una partida incompleta dice cuántos dígitos faltan y no se guarda', async () => {
  const p = aduana.page;
  const campo = p.getByLabel('Número de partida');
  await campo.fill('');
  await campo.pressSequentially('84213', { delay: 20 });
  await campo.blur();
  await expect(p.getByText(/La partida lleva 10 dígitos\. Ejemplo: 8421\.39\.90\.00/)).toBeVisible();
  await campo.fill('');
  await campo.pressSequentially('8501312000', { delay: 20 });
  await campo.blur();
  await expect(p.getByText(/La partida lleva 10 dígitos/)).toHaveCount(0);
});

test('RIM: la aduana responde Sí/No en su zona, el área lo ve en solo lectura y sin responderlo no se cierra', async () => {
  const p = aduana.page;
  const etiqueta = '¿Requiere registro de importación (RIM)?';
  const ayuda = 'Si es Sí, Comercio Exterior gestiona el registro por fuera de la plataforma.';
  await abrirZona(p, idFicha);
  const rim = zona(p).getByLabel(etiqueta);
  await expect(rim).toBeVisible();
  await expect(rim).toHaveValue('');
  await expect(zona(p).getByText(ayuda)).toBeVisible();

  // Sin responder el RIM no se puede cerrar: el cierre lo dice y lleva al bloque.
  await p.getByLabel('Clasificación finalizada').selectOption('SI');
  const dialogo = p.getByRole('dialog', { name: 'Cerrar la clasificación' });
  await expect(dialogo.getByText(/Falta responder «¿Requiere registro de importación \(RIM\)\?»/)).toBeVisible();
  await expect(dialogo.getByRole('button', { name: /Cerrar/ })).toHaveCount(0);
  await dialogo.getByRole('button', { name: 'Entendido' }).click();

  await rim.selectOption('NO');
  await expect(zona(p).getByText('Guardado').first()).toBeVisible();
  await abrirZona(p, idFicha);
  await expect(zona(p).getByLabel(etiqueta)).toHaveValue('NO');

  // El área no lo escribe: lo ve como texto.
  await abrirZona(area.page, idFicha);
  await expect(zona(area.page).getByLabel(etiqueta)).toHaveCount(0);
  await expect(zona(area.page).getByText(ayuda)).toBeVisible();
});

test('el área ve la zona de la aduana en solo lectura', async () => {
  await abrirZona(area.page, idFicha);
  await expect(
    area.page.getByText('Esta zona la completa la agencia de aduana. Si pide información adicional, te llega como pendiente y la respondes aquí.'),
  ).toBeVisible();
  await expect(area.page.getByLabel('Número de partida')).toHaveCount(0);
  await expect(area.page.getByLabel('Lo que la aduana necesita saber')).toHaveCount(0);
  await expect(area.page.getByText('La aduana todavía no ha dicho si necesita información adicional.')).toBeVisible();
  await area.page.screenshot({ path: `${CAPTURAS}/13-vista-del-area-1440.png`, fullPage: true });
});
test('cerrar con pendientes: lista exacta, motivo obligatorio y paso a verde', async () => {
  const p = aduana.page;
  await abrirZona(p, idFicha);
  await p.getByLabel('Clasificación finalizada').selectOption('SI');
  const dialogo = p.getByRole('dialog', { name: 'Cerrar la clasificación' });
  await expect(dialogo.getByText('Vas a cerrar la clasificación. La referencia quedará en verde')).toBeVisible();
  await expect(dialogo.getByText('Antes de cerrar, esto sigue pendiente')).toBeVisible();
  await expect(dialogo.getByText('Las descripciones mínimas adicionales están vacías')).toBeVisible();
  const cerrar = dialogo.getByRole('button', { name: 'Cerrar de todos modos' });
  await expect(cerrar).toBeDisabled();
  await dialogo.screenshot({ path: `${CAPTURAS}/15-advertencia-cierre.png` });
  await dialogo.getByLabel('¿Por qué cierras con pendientes?').fill('La agencia ya despachó la mercancía.');
  await expect(cerrar).toBeEnabled();
  await cerrar.click();

  await expect(p.getByText('quedó clasificada').first()).toBeVisible();
  await expect(p.locator('[data-cierre="cerrada"]')).toContainText('Cerrada por');
  await expect(zona(p).getByText('Clasificada').first()).toBeVisible();
  await expect(p.getByLabel('Número de partida')).toHaveCount(0); // ya es de solo lectura
  await p.screenshot({ path: `${CAPTURAS}/16-ficha-verde-1440.png`, fullPage: true });
});

test('el listado muestra la referencia en verde', async () => {
  await aduana.page.goto('/referencias');
  // El listado es de otra area: se busca la fila (tabla o tarjeta) que contiene el codigo.
  const fila = aduana.page.getByText(CODIGO, { exact: true }).first().locator('xpath=ancestor::*[self::tr or self::li or self::article][1]');
  await expect(fila).toContainText('Clasificada');
  await aduana.page.screenshot({ path: `${CAPTURAS}/17-listado-verde-1440.png` });
});

test('el área no puede cerrar ni reabrir, pero sí solicitar la reapertura', async () => {
  const p = area.page;
  await abrirZona(p, idFicha);
  await expect(p.getByRole('button', { name: 'Reabrir clasificación' })).toHaveCount(0);
  await p.getByRole('button', { name: 'Solicitar reapertura' }).click();
  const d = p.getByRole('dialog', { name: 'Solicitar reapertura' });
  await expect(d.getByText('Cuéntale al administrador por qué hay que reabrirla.')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Enviar solicitud' })).toBeDisabled();
  await d.getByLabel('Motivo').fill('El proveedor es otro.');
  await d.getByRole('button', { name: 'Enviar solicitud' }).click();
  await expect(p.getByText('Enviamos tu solicitud').first()).toBeVisible();
});

test('la aduana ve la solicitud y reabre: vuelve a amarillo y la partida sigue', async () => {
  const p = aduana.page;
  await abrirZona(p, idFicha);
  await expect(p.getByText(/pidió reabrirla/)).toBeVisible();
  await p.getByRole('button', { name: 'Reabrir clasificación' }).click();
  const d = p.getByRole('dialog', { name: 'Reabrir la clasificación' });
  await expect(d.getByText(`Vas a reabrir la clasificación de ${CODIGO}`)).toBeVisible();
  await d.getByLabel('Motivo').fill('Cambió el proveedor.');
  await d.getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect(p.getByText('Esta clasificación fue reabierta')).toBeVisible();
  await expect(p.getByLabel('Número de partida')).toHaveValue('8501.31.20.00');
  await expect(zona(p).getByText('Reabierta').first()).toBeVisible();
  await p.screenshot({ path: `${CAPTURAS}/18-reabierta-1440.png`, fullPage: true });
});

test('la aduana pide información, el área responde, observaciones «No aplica» y cierre sin advertencias', async () => {
  const p = aduana.page;
  await abrirZona(p, idFicha);
  const dm = p.getByLabel('Lo que la aduana necesita saber');
  await dm.fill('Producto: motor eléctrico\nMarca: MARCA-DEMO\nPotencia: 400 W\nTipo de corriente: alterna');
  await dm.press('Tab');
  await expect(zona(p).getByText('Guardado').first()).toBeVisible();
  await abrirZona(p, idFicha);
  await expect(p.getByLabel('Lo que la aduana necesita saber')).toHaveValue(/Potencia: 400 W/);
  await expect(zona(p).getByRole('button', { name: /Ver el historial de este campo/ }).first()).toBeVisible();
  // La solicitud deja la parte pendiente hasta que el area responda (A2).
  await expect(zona(p).getByText('Pendiente de respuesta del área')).toBeVisible();
  await p.screenshot({ path: `${CAPTURAS}/19-descripciones-minimas-1440.png`, fullPage: true });

  // El area responde en la misma zona.
  await abrirZona(area.page, idFicha);
  const respuesta = area.page.getByLabel('Tu respuesta');
  await respuesta.fill('Es de corriente alterna, 2,1 A.');
  await respuesta.press('Tab');
  await expect(zona(area.page).getByText('Guardado').first()).toBeVisible();

  // La aduana marca las observaciones como «No aplica» (A4) y ya no queda nada pendiente.
  await abrirZona(p, idFicha);
  await expect(zona(p).getByText('Pendiente de respuesta del área')).toHaveCount(0);
  await p.getByRole('group', { name: 'Restricciones y observaciones' }).getByRole('checkbox', { name: 'No aplica' }).last().check();
  await expect(zona(p).getByText('Guardado').first()).toBeVisible();
  await abrirZona(p, idFicha);

  await expect(p.getByText('Todo está listo para cerrar')).toBeVisible();
  await p.getByLabel('Clasificación finalizada').selectOption('SI');
  const dialogo = p.getByRole('dialog', { name: 'Cerrar la clasificación' });
  await expect(dialogo.getByText('No hay nada pendiente')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Cerrar clasificación' }).click();
  await expect(p.locator('[data-cierre="cerrada"]')).toBeVisible();
});
test('Excel: se descarga, se abre y trae la referencia clasificada con su color y texto', async () => {
  const p = aduana.page;
  // El resumen de filas se pide al ABRIR el menu, no al montar la pantalla.
  const resumenes: string[] = [];
  p.on('request', (r) => {
    if (r.url().includes('/api/exportar') && r.url().includes('resumen=1')) resumenes.push(r.url());
  });
  await abrirZona(p, idFicha);
  await p.waitForTimeout(1_500);
  expect(resumenes, 'el resumen no se pide al montar la pantalla').toHaveLength(0);
  await p.getByRole('button', { name: /Descargar Excel/ }).click();
  await expect(p.getByRole('menuitem', { name: /Toda la base/ })).toBeVisible();
  await expect(p.getByRole('menuitem', { name: /Toda la base/ })).toContainText(/[0-9]+ filas?/);
  expect(resumenes.length).toBeGreaterThanOrEqual(1);
  await p.screenshot({ path: `${CAPTURAS}/20-menu-excel.png`, clip: { x: 600, y: 0, width: 840, height: 400 } });
  const [descarga] = await Promise.all([p.waitForEvent('download'), p.getByRole('menuitem', { name: /Toda la base/ }).click()]);
  expect(descarga.suggestedFilename()).toMatch(/^descripciones-minimas_\d{8}_\d{4}\.xlsx$/);
  const ruta = `${CAPTURAS}/${descarga.suggestedFilename()}`;
  await descarga.saveAs(ruta);

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(readFileSync(ruta) as unknown as ArrayBuffer);
  expect(libro.worksheets.map((h) => h.name)).toEqual(['Base', 'Leyenda']);
  const base = libro.getWorksheet('Base')!;
  let fila: ExcelJS.Row | undefined;
  base.eachRow((r) => {
    if (r.getCell(1).text === CODIGO) fila = r;
  });
  expect(fila, `no está ${CODIGO} en el Excel`).toBeTruthy();
  // Las columnas se leen por su encabezado, no por posicion: una columna nueva no rompe la prueba.
  const columna = new Map<string, number>();
  base.getRow(1).eachCell((c, n) => columna.set(c.text, n));
  const celda = (encabezado: string) => fila!.getCell(columna.get(encabezado) ?? 0);
  expect(celda('Estado').text).toBe('Clasificada');
  expect((celda('Estado').fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC6EFCE');
  expect(celda('Partida arancelaria final').text).toBe('8501.31.20.00');
  expect(celda('Descripciones mínimas adicionales').text).toContain('Potencia: 400 W');
  expect(celda('Respuesta del área').text).toContain('corriente alterna');
  expect(celda('Restricciones').text).toContain('RETIE');
  expect(celda('Clasificación finalizada').text).toBe('SÍ');
  // Ninguna celda del libro es una formula.
  libro.eachSheet((h) => h.eachRow((r) => r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula))));
  await expect(p.getByText('Excel descargado').first()).toBeVisible();
});

test('la zona ya está montada en la ficha real, bajo las tres secciones', async () => {
  const p = aduana.page;
  await p.goto(`/referencias/${idFicha}`);
  await expect(p.getByRole('heading', { name: 'Zona de la aduana' })).toBeVisible({ timeout: 90_000 });
  await expect(p.getByRole('heading', { name: 'Partida arancelaria' })).toBeVisible();
  await p.screenshot({ path: `${CAPTURAS}/42-ficha-real-aduana.png`, fullPage: true });
});

test('la agencia B no ve la referencia de la agencia A (404) ni en el Excel', async ({ browser, request }) => {
  const b = await contextoAutenticado(browser, request, 'aduana-b@desarrollo.invalid');
  const r = await b.page.goto(`/aduana-dev/${idFicha}`);
  expect(r?.status()).toBe(404);
  const csv = await b.page.request.get('/api/exportar?alcance=toda');
  expect(csv.ok()).toBe(true);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load((await csv.body()) as unknown as ArrayBuffer);
  let hay = false;
  libro.getWorksheet('Base')!.eachRow((fila) => {
    if (fila.getCell(1).text === CODIGO) hay = true;
  });
  expect(hay).toBe(false);
  await b.contexto.close();
});

test('móvil 360 px: sin desplazamiento horizontal y con las capturas de la zona', async ({ browser, request, baseURL }) => {
  const id = await preparar(request, baseURL as string, `TEST-ADU-M${sufijo}`, { nombre: 'Motor móvil (ejemplo)' });
  const m = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota', viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await m.newPage();
  const { entrarComo } = await import('./ayudas');
  await entrarComo(page, request, 'aduana-a@desarrollo.invalid');
  await abrirZona(page, id);
  const campo = page.getByLabel('Número de partida');
  await campo.fill('');
  await campo.pressSequentially('8501312000', { delay: 20 });
  await campo.blur();
  await expect(page.locator('[data-restricciones]')).toContainText('RETIE');
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `${CAPTURAS}/30-movil-360.png`, fullPage: true });
  await page.getByLabel('Clasificación finalizada').selectOption('SI');
  await expect(page.getByRole('dialog', { name: 'Cerrar la clasificación' })).toBeVisible();
  await page.screenshot({ path: `${CAPTURAS}/31-movil-360-cierre.png` });
  await m.close();
});

test('accesibilidad: axe sin violaciones serias en la zona (aduana y área)', async () => {
  for (const pagina of [aduana.page, area.page]) {
    await pagina.setViewportSize({ width: 1440, height: 900 });
    await abrirZona(pagina, idFicha);
    const r = await new AxeBuilder({ page: pagina }).include('#zona-aduana').analyze();
    const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
  }
});

test('las lecturas de la zona van por GET con la misma autenticación y el mismo aislamiento de agencia', async ({ browser, request }) => {
  // La zona se lee con GET (no con Server Action) para que un sondeo no haga esperar a un guardado.
  const propia = await aduana.page.request.get(`/api/aduana/${idFicha}/vista`);
  expect(propia.status()).toBe(200);
  const vista = (await propia.json()) as { referenciaId: string; permisos: { editar: boolean } };
  expect(vista.referenciaId).toBe(idFicha);
  expect(vista.permisos.editar).toBeDefined();

  // Otra agencia no ve la ficha (404, como en el resto de la plataforma); sin sesion, 401.
  const otra = await contextoAutenticado(browser as Browser, request, 'aduana-b@desarrollo.invalid');
  try {
    expect((await otra.page.request.get(`/api/aduana/${idFicha}/vista`)).status()).toBe(404);
  } finally {
    await otra.contexto.close();
  }
  expect((await request.get(`/api/aduana/${idFicha}/vista`)).status()).toBe(401);
  expect((await aduana.page.request.get('/api/aduana/no-es-un-uuid/vista')).status()).toBe(422);

  // Sugerencias del catalogo de partidas: mismo contrato que antes y tope de largo.
  const sug = await aduana.page.request.get('/api/aduana/partidas?q=8501');
  expect(sug.status()).toBe(200);
  expect(JSON.stringify(await sug.json())).toContain('8501.31.20.00');
  expect((await aduana.page.request.get(`/api/aduana/partidas?q=${'x'.repeat(61)}`)).status()).toBe(422);
  expect((await request.get('/api/aduana/partidas?q=8501')).status()).toBe(401);
});
