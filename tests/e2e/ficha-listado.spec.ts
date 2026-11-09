/**
 * E2E del hito H2 (ficha, listado, buscador, nueva referencia, foto). Corre contra el servidor de desarrollo
 * (`E2E_URL`). Serial: cada prueba parte de la referencia que crea la primera.
 *
 * Flujo de punta a punta pedido: crear -> llenar las 3 secciones -> ver amarillo -> recargar y comprobar
 * persistencia -> segunda sesion edita el mismo campo y aparece el conflicto -> buscar por lupa -> subir foto.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect as expectBase, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { abrirSeccion, abrirTodo, botonDeSeccion, contextoAutenticado, entrarComo, vigilarErrores } from './ayudas';

// El servidor de desarrollo compila cada ruta la primera vez y la maquina comparte CPU: margen amplio.
const expect = expectBase.configure({ timeout: 150_000 });

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 120_000, navigationTimeout: 240_000 });
test.beforeEach(() => {
  test.setTimeout(900_000);
});

// `E2E_FICHA=id|codigo|nombre` reutiliza una ficha ya llenada por una corrida anterior y salta las tres primeras
// pruebas (solo para repetir las demas mas rapido; la corrida completa NO lo usa).
const REUSO = process.env.E2E_FICHA?.split('|');
const SUFIJO = (REUSO?.[1] ?? '').replace(/^E2E-/, '') || Date.now().toString(36).toUpperCase();
const CODIGO = REUSO?.[1] ?? `E2E-${SUFIJO}`;
const NOMBRE = REUSO?.[2] ?? `Limpiador de prueba ${SUFIJO}`;
let idFicha = REUSO?.[0] ?? '';

// Parte de la semilla minima: otras pruebas (p. ej. las de aduana) dejan referencias clasificadas, y aqui se cuentan filas.
test.beforeAll(async ({ request }) => {
  if (REUSO) return;
  const r = await request.post('/api/dev/reset?ejemplos=0', { maxRetries: 3, timeout: 180_000 });
  expect(r.ok(), 'POST /api/dev/reset?ejemplos=0 (solo desarrollo)').toBe(true);
});

async function graves(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

function bloque(page: Page, clave: string) {
  return page.locator(`[data-campo="${clave}"]`);
}

/** Escribe en un campo, sale de el y espera a que quede guardado (la fase vuelve a `guardado`/`limpio`). */
async function llenar(page: Page, clave: string, escribir: () => Promise<void>) {
  await escribir();
  await page.keyboard.press('Tab');
  await expect(bloque(page, clave)).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
}

async function esperarFicha(page: Page) {
  await expect(page.locator('[data-barra-ficha]')).toBeVisible({ timeout: 60_000 });
}

test('crear: el codigo repetido se avisa con enlace, el parecido no bloquea y la nueva abre su ficha', async ({ page, request }) => {
  test.skip(!!REUSO, 'se reutiliza una ficha ya llenada');
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid');
  await page.goto('/referencias/nueva');
  await expect(page.getByRole('heading', { name: 'Nueva referencia' })).toBeVisible();

  // Duplicado exacto: error con enlace a la existente y no deja crear.
  await page.getByLabel('Código de referencia').fill('test-0001');
  await expect(page.getByText(/Ya existe la referencia TEST-0001/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Abrir la referencia' })).toHaveAttribute('href', /\/referencias\//);
  await expect(page.getByRole('button', { name: 'Crear y seguir' })).toBeDisabled();

  // Parecido por prefijo/contiene: solo avisa.
  await page.getByLabel('Código de referencia').fill('TEST-000');
  await expect(page.getByText('Hay códigos parecidos')).toBeVisible();

  // Validacion al enviar vacio: errores junto a cada campo.
  await page.getByLabel('Código de referencia').fill('');
  await page.getByRole('button', { name: 'Crear y seguir' }).click();
  await expect(page.getByText('Escribe el código de la referencia.')).toBeVisible();
  await expect(page.getByText('Escribe el nombre del producto.')).toBeVisible();
  await expect(page.getByText('Elige el tipo de producto.')).toBeVisible();

  expect(await graves(page), 'axe en /referencias/nueva').toEqual([]);

  await page.getByLabel('Código de referencia').fill(CODIGO);
  await page.getByLabel('Nombre del producto').fill(NOMBRE);
  await page.getByRole('radio', { name: /Insumo/ }).check();
  await page.getByLabel('Área responsable').selectOption('Consumibles');
  await page.getByRole('button', { name: 'Crear y seguir' }).click();
  await page.waitForURL(/\/referencias\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  idFicha = page.url().split('/').pop() as string;
  await esperarFicha(page);
  await expect(page.getByRole('heading', { level: 1, name: NOMBRE })).toBeVisible();
  expect(errores, errores.join('\n')).toEqual([]);
});

test('ficha: llenar las tres secciones, ver amarillo y verde por seccion, y recargar conserva todo', async ({ page, request }) => {
  test.skip(!!REUSO, 'se reutiliza una ficha ya llenada');
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', `/referencias/${idFicha}`);
  await esperarFicha(page);

  // Recien creada: Producto y Detalle en amarillo (icono + texto), sello pendiente.
  const barra = page.locator('[data-barra-ficha]');
  await expect(barra.getByRole('button', { name: /Producto.*Falta/i })).toBeVisible();
  await expect(barra.getByRole('button', { name: /Detalle.*Falta/i })).toBeVisible();
  // Especificaciones no tiene ningun campo obligatorio para el area (foto e informacion adicional son opcionales): nace completa.
  await expect(barra.getByRole('button', { name: /Especificaciones.*Completa/i })).toBeVisible();
  await expect(page.getByRole('status', { name: /Estado de la referencia: pendiente/i })).toBeVisible();

  // Todo plegado por defecto, salvo Producto en un borrador recien creado sin nada lleno (reunion 2026-11).
  await expect(botonDeSeccion(page, 'producto')).toHaveAttribute('aria-expanded', 'true');
  await expect(botonDeSeccion(page, 'detalle')).toHaveAttribute('aria-expanded', 'false');
  await expect(botonDeSeccion(page, 'especificaciones')).toHaveAttribute('aria-expanded', 'false');
  // El encabezado ya dice cuanto falta, sin abrir: amarillo «Faltan N» y «x de N campos».
  await expect(botonDeSeccion(page, 'detalle')).toContainText(/Faltan \d+/);
  await expect(botonDeSeccion(page, 'detalle')).toContainText(/0 de \d+ campos/);
  await abrirTodo(page);

  // Producto
  await llenar(page, 'descripcion_factura', () => page.getByLabel(/^Descripción según factura/).fill('LIMPIADOR ALCALINO (prueba)'));
  await llenar(page, 'uso', () => page.getByLabel(/^Uso$/).fill('Preparar la superficie del lente antes del recubrimiento.'));
  await llenar(page, 'funciones', () => page.getByLabel(/^Funciones$/).fill('Elimina grasa y partículas.'));
  await page.getByLabel('Unidad de medida').click();
  await page.getByRole('option', { name: 'Kilogramos' }).click();
  await expect(bloque(page, 'unidad_medida')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
  await expect(barra.getByRole('button', { name: /Producto.*Completa/i })).toBeVisible({ timeout: 20_000 });

  // Detalle (insumo: composicion con porcentajes)
  await llenar(page, 'materia_constitutiva', async () => {
    await page.getByLabel('Componente 1', { exact: true }).fill('1-metoxi-2-propanol');
    await page.getByLabel('Desde, en porcentaje, del componente 1').fill('50');
    await page.getByLabel('Hasta, en porcentaje, del componente 1').fill('75');
  });
  await expect(page.getByText(/Suma máxima: 75 %/)).toBeVisible();
  await page.getByLabel('Aspecto físico').selectOption('Líquido');
  await expect(bloque(page, 'aspecto_fisico')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
  await llenar(page, 'marca', () => page.getByLabel(/^Marca/).fill('NAGA'));
  await page.getByLabel('País de origen').fill('fran');
  await page.getByRole('option', { name: /Francia/ }).click();
  await expect(bloque(page, 'pais_origen')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
  await llenar(page, 'fabricante', () => page.getByLabel(/^Fabricante/).fill('Fabricante de prueba'));
  await llenar(page, 'proveedor', () => page.getByLabel(/^Proveedor/).fill('Proveedor de prueba'));
  // Tipo de empaque: lista fija sin «No aplica». Con Bidón o Paquete aparece «Contenido por empaque».
  await page.getByLabel(/^Tipo de empaque/).selectOption('Bidón');
  await expect(bloque(page, 'tipo_empaque')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);
  await llenar(page, 'cantidad_empaque', () => page.getByLabel(/^Contenido por empaque/).fill('20 litros'));

  // Especificaciones: el RIM lo responde la aduana, asi que el area no lo ve como campo suyo.
  await expect(page.getByLabel(/^¿Requiere registro de importación/)).toHaveCount(0);

  // Las tres secciones en verde, pero el sello sigue amarillo (solo la aduana cierra).
  for (const s of ['Producto', 'Detalle', 'Especificaciones']) {
    await expect(barra.getByRole('button', { name: new RegExp(`${s}.*Completa`, 'i') })).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByRole('status', { name: /Estado de la referencia: pendiente/i })).toBeVisible();
  await expect(page.getByText('Guardado', { exact: true }).first()).toBeVisible();
  // Lo que la persona abrio sigue abierto aunque la ficha se refresque por detras (los guardados la refrescan).
  for (const s of ['producto', 'detalle', 'especificaciones']) await expect(botonDeSeccion(page, s)).toHaveAttribute('aria-expanded', 'true');

  // Recargar conserva todo, con autor y fecha. Al recargar, todo vuelve a arrancar plegado: el encabezado dice «Completa».
  await page.reload();
  await esperarFicha(page);
  for (const s of ['producto', 'detalle', 'especificaciones']) {
    await expect(botonDeSeccion(page, s)).toHaveAttribute('aria-expanded', 'false');
    await expect(botonDeSeccion(page, s)).toContainText('Completa');
  }
  await abrirTodo(page);
  await expect(page.getByLabel(/^Uso$/)).toHaveValue('Preparar la superficie del lente antes del recubrimiento.');
  await expect(page.getByLabel('Componente 1', { exact: true })).toHaveValue('1-metoxi-2-propanol');
  await expect(page.getByLabel(/^Marca/)).toHaveValue('NAGA');
  await expect(page.getByLabel(/^Contenido por empaque/)).toHaveValue('20 litros');
  await expect(bloque(page, 'uso')).toContainText('Tú');
  expect(errores, errores.join('\n')).toEqual([]);
});

test('segunda sesion: editar un valor ajeno pide motivo y, si se guardo a la vez, aparece el conflicto con sus tres salidas', async ({ browser, request }) => {
  test.skip(!!REUSO, 'se reutiliza una ficha ya llenada');
  const a = await contextoAutenticado(browser, request, 'solicitante@desarrollo.invalid');
  const b = await contextoAutenticado(browser, request, 'solicitante2@desarrollo.invalid');
  try {
    for (const p of [a.page, b.page]) {
      await p.goto(`/referencias/${idFicha}`);
      await esperarFicha(p);
      await abrirTodo(p);
    }

    // Valor ajeno: Carla edita el «Uso» de Edgar -> franja de motivo; sin motivo no se guarda.
    const uso = b.page.getByLabel(/^Uso$/);
    await uso.fill('Preparar la superficie y quitar residuos.');
    await expect(b.page.getByText(/Este valor lo puso/)).toBeVisible();
    // Salir del campo sin motivo no guarda ni pierde el texto: la franja se resalta.
    await b.page.getByRole('heading', { level: 1 }).click();
    await expect(bloque(b.page, 'uso')).toHaveAttribute('data-fase', 'falta_motivo');
    await expect(uso).toHaveValue('Preparar la superficie y quitar residuos.');
    await b.page.getByLabel('Motivo del cambio').fill('Así lo describe la ficha técnica');
    await b.page.getByRole('button', { name: 'Guardar cambio' }).click();
    await expect(bloque(b.page, 'uso')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);

    // Conflicto: ambos ven «Informacion adicional» vacia; Edgar guarda primero y Carla (version vieja) choca.
    await llenar(a.page, 'informacion_adicional', () => a.page.getByLabel(/^Información adicional/).fill('Texto de Edgar'));
    const info = b.page.getByLabel(/^Información adicional/);
    await info.fill('Texto de Carla');
    await b.page.keyboard.press('Tab');
    const choque = b.page.locator('[data-conflicto]');
    await expect(choque).toBeVisible();
    await expect(choque).toContainText('ya guardó este campo');
    await expect(choque).toContainText('Texto de Edgar');
    await expect(info).toHaveValue('Texto de Carla'); // su texto sigue en pantalla
    await expect(choque.getByText('Ver mi texto')).toBeVisible();
    for (const nombre of [/^Dejar el de Edgar/, 'Usar el mío', 'Combinar']) {
      await expect(choque.getByRole('button', { name: nombre })).toBeVisible();
    }
    // «Usar el mío» exige motivo.
    await choque.getByRole('button', { name: 'Usar el mío' }).click();
    await expect(choque.getByText('Escribe el motivo para usar el tuyo.')).toBeVisible();
    await choque.getByLabel(/Motivo/).fill('Es el dato de la factura');
    await choque.getByRole('button', { name: 'Usar el mío' }).click();
    await expect(bloque(b.page, 'informacion_adicional')).toHaveAttribute('data-fase', /^(guardado|limpio)$/);

    // Edgar lo ve al recargar y la ficha de Carla ya no tiene el choque.
    await a.page.reload();
    await esperarFicha(a.page);
    await abrirTodo(a.page); // al recargar todo vuelve a plegado
    await expect(a.page.getByLabel(/^Información adicional/)).toHaveValue('Texto de Carla');

    // Presencia (D-17): quien enfoca un campo aparece como «esta escribiendo» en la otra sesion (sondeo de 15 s)...
    await b.page.getByLabel(/^Proveedor/).focus();
    await expect(a.page.locator('[data-campo="proveedor"]')).toContainText('Carla Solicitante está escribiendo', { timeout: 120_000 });
    await expect(a.page.locator('[data-presencia]')).toContainText('Carla Solicitante');
    await b.page.getByLabel(/^Fabricante/).focus();
    // ...y un valor que cambia en otra sesion llega sin recargar y sin pisar lo que uno escribe.
    await llenar(a.page, 'fabricante', () => a.page.getByLabel(/^Fabricante/).fill('Fabricante actualizado'));
    await expect(b.page.getByLabel(/^Fabricante/)).toHaveValue('Fabricante actualizado', { timeout: 120_000 });
  } finally {
    await a.contexto.close();
    await b.contexto.close();
  }
});

test('buscador con lupa: atajo "/", sugerencias, Enter abre la ficha exacta, listado filtrado y crear con ese codigo', async ({ page, request }) => {
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', '/referencias');
  const buscador = page.getByRole('combobox', { name: 'Buscar referencia' });

  // "/" lo enfoca cuando el foco no esta en un campo editable.
  await page.locator('main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  await expect(buscador).toBeFocused();

  // Sugerencias mientras escribe, con el estado en texto.
  await buscador.fill(SUFIJO.slice(0, 4));
  const opcion = page.getByRole('option').filter({ hasText: CODIGO }).first();
  await expect(opcion).toBeVisible();
  await expect(opcion).toContainText('Pendiente');
  // Con la lista abierta tambien se cumple la accesibilidad (combobox + listbox).
  expect(await graves(page), 'axe con el buscador abierto').toEqual([]);

  // Enter con una sola coincidencia exacta abre la ficha.
  await buscador.fill(CODIGO.toLowerCase());
  await expect(page.getByRole('option').first()).toContainText(CODIGO);
  await buscador.press('Enter');
  await page.waitForURL(new RegExp(`/referencias/${idFicha}$`));
  await esperarFicha(page);

  // Busca por nombre sin tildes ni mayusculas (el nombre exacto lleva a la ficha).
  await page.keyboard.press('Control+k');
  await expect(buscador).toBeFocused();
  await buscador.fill('limpiador de prueba');
  await expect(page.getByRole('option').filter({ hasText: CODIGO })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForURL(new RegExp(`/referencias/${idFicha}$`));
  await esperarFicha(page);

  // Una parte que coincide con varias: «Ver los N resultados» lleva al listado ya filtrado.
  await page.keyboard.press('Control+k');
  await buscador.fill('TEST-000');
  await expect(page.getByRole('option', { name: /Ver los \d+ resultados/ })).toBeVisible();
  await buscador.press('Enter');
  await page.waitForURL(/\/referencias\?q=TEST-000/);
  await expect(page.getByRole('link', { name: /Abrir TEST-0001/ })).toBeVisible();

  // Sin resultados: ofrece crear con ese codigo (el rol puede crear).
  await page.keyboard.press('Control+k');
  await buscador.fill('ZZ-NO-EXISTE-77');
  await expect(page.getByText('No encontramos «ZZ-NO-EXISTE-77».')).toBeVisible();
  await page.getByRole('option', { name: /Crear referencia con el código «ZZ-NO-EXISTE-77»/ }).click();
  await page.waitForURL(/\/referencias\/nueva\?codigo=ZZ-NO-EXISTE-77/);
  await expect(page.getByLabel('Código de referencia')).toHaveValue('ZZ-NO-EXISTE-77');

  // Un caracter de LIKE se busca como literal: «%» no trae toda la base.
  await page.keyboard.press('Control+k');
  await buscador.fill('%%');
  await expect(page.getByText('No encontramos «%%».')).toBeVisible();
  expect(errores, errores.join('\n')).toEqual([]);
});

test('listado: contadores que filtran, filtros en la URL, estado vacio con accion y la agencia solo ve lo suyo', async ({ browser, page, request }) => {
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', '/referencias');
  await expect(page.getByRole('heading', { level: 1, name: 'Referencias' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Estado de las referencias' });
  await expect(nav.getByRole('link', { name: /Pendientes/ })).toBeVisible();
  await nav.getByRole('link', { name: /Pendientes/ }).click();
  await expect(page).toHaveURL(/estado=amarillas/);
  await expect(page.getByRole('link', { name: new RegExp(`Abrir ${CODIGO}`) })).toBeVisible();
  await nav.getByRole('link', { name: /Clasificadas/ }).click();
  await expect(page).toHaveURL(/estado=verdes/);
  await expect(page.getByText('No hay referencias con esos filtros')).toBeVisible();

  // Filtro por tipo y texto, y «Limpiar filtros».
  await page.goto('/referencias');
  await page.getByLabel('Tipo de producto').selectOption('REPUESTO');
  await expect(page).toHaveURL(/tipo=REPUESTO/);
  await expect(page.getByRole('link', { name: /Abrir TEST-0002/ })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(`Abrir ${CODIGO}`) })).toHaveCount(0);
  await page.getByRole('link', { name: 'Limpiar filtros' }).click();
  await expect(page).toHaveURL(/\/referencias$/);
  await page.getByLabel('Buscar en la lista').fill('naga');
  await expect(page).toHaveURL(/q=naga/);
  await expect(page.getByRole('link', { name: new RegExp(`Abrir ${CODIGO}`) })).toBeVisible();

  // La fila lleva el estado, la seccion que falta y los dias.
  const fila = page.getByRole('row').filter({ hasText: CODIGO });
  await expect(fila).toContainText('Pendiente');
  await expect(fila).toContainText('Solo falta la aduana');

  expect(await graves(page), 'axe en /referencias').toEqual([]);

  // La agencia B no ve fichas que no tiene asignadas: ni en la lista ni por enlace directo (404).
  const b = await contextoAutenticado(browser, request, 'aduana-b@desarrollo.invalid');
  try {
    await b.page.goto('/referencias');
    await expect(b.page.getByText('Todavía no tienes referencias asignadas')).toBeVisible();
    const r = await b.page.goto(`/referencias/${idFicha}`);
    expect(r?.status()).toBe(404);
    await expect(b.page.getByText(/no está asignada a tu cuenta/i)).toBeVisible();
  } finally {
    await b.contexto.close();
  }
  expect(errores, errores.join('\n')).toEqual([]);
});

test('foto: sube con el clip, reprocesa, no se sirve sin permiso, rechaza un archivo falso y se retira con motivo', async ({ page, request, browser }) => {
  const errores = vigilarErrores(page);
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', `/referencias/${idFicha}`);
  await esperarFicha(page);
  await abrirSeccion(page, 'especificaciones'); // las fotos viven en Especificaciones, plegada por defecto

  const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: { r: 20, g: 80, b: 160 } } }).png().toBuffer();
  await page.locator('input[data-adjuntar]').setInputFiles({ name: 'foto-prueba.png', mimeType: 'image/png', buffer: png });
  const miniatura = page.getByRole('img', { name: /Foto foto-prueba/ }).last();
  await expect(miniatura).toBeVisible();
  await miniatura.scrollIntoViewIfNeeded(); // las miniaturas cargan al acercarse (loading=lazy)
  await expect.poll(() => miniatura.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const src = (await miniatura.getAttribute('src')) as string;
  const idFoto = /\/api\/adjuntos\/([0-9a-f-]{36})/.exec(src)?.[1] as string;
  expect(idFoto).toBeTruthy();

  // Un archivo que dice ser JPG pero no lo es: se rechaza por su contenido real, con salida clara.
  await page.locator('input[data-adjuntar]').setInputFiles({ name: 'falsa.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('esto no es una imagen, es texto') });
  await expect(page.getByText(/Solo se aceptan fotos JPG, PNG o WebP/)).toBeVisible();

  // La descarga pasa por sesion y permiso: sin sesion no hay foto, con otra agencia es 404.
  const anonimo = await browser.newContext({ baseURL: page.url().split('/referencias')[0] });
  const sin = await anonimo.request.get(`/api/adjuntos/${idFoto}`, { maxRedirects: 0 });
  expect([307, 308, 401, 403, 404]).toContain(sin.status());
  await anonimo.close();
  const otra = await contextoAutenticado(browser, request, 'aduana-b@desarrollo.invalid');
  try {
    const r = await otra.page.request.get(`/api/adjuntos/${idFoto}`);
    expect(r.status()).toBe(404);
  } finally {
    await otra.contexto.close();
  }
  const propia = await page.request.get(`/api/adjuntos/${idFoto}`);
  expect(propia.status()).toBe(200);
  // El navegador reduce las fotos grandes a JPEG antes de subirlas; si no, el servidor deja WebP. Nunca el formato original.
  expect(propia.headers()['content-type']).toMatch(/^image\/(jpeg|webp)$/);
  const mini = await page.request.get(`/api/adjuntos/${idFoto}?m=1`);
  expect(mini.headers()['content-type']).toBe('image/webp');
  expect(propia.headers()['x-content-type-options']).toBe('nosniff');

  // Retirar: pide motivo y la foto sale de la vista (queda en «Fotos retiradas», no se borra).
  await page.getByRole('button', { name: 'Retirar', exact: true }).last().click();
  await page.getByLabel('Motivo').fill('Se ve borrosa');
  await page.getByRole('button', { name: 'Retirar foto' }).click();
  await expect(page.getByText(/Fotos retiradas \(\d+\)/)).toBeVisible();
  await expect(page.locator(`img[src*="${idFoto}"]`)).toHaveCount(0);
  expect(errores.filter((e) => !/400|422/.test(e)), errores.join('\n')).toEqual([]);
});

test('ficha: sin desborde horizontal en 360 px, todas las secciones plegadas y axe sin violaciones serias', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', `/referencias/${idFicha}`);
  await esperarFicha(page);
  // En escritorio tambien arrancan plegadas (esta ficha ya tiene datos, asi que ni Producto se abre solo).
  for (const s of ['producto', 'detalle', 'especificaciones']) await expect(botonDeSeccion(page, s)).toHaveAttribute('aria-expanded', 'false');
  expect(await graves(page), 'axe en la ficha plegada').toEqual([]);
  await abrirTodo(page);
  expect(await graves(page), 'axe en la ficha desplegada').toEqual([]);

  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  await esperarFicha(page);
  const { ancho, visible } = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: document.documentElement.clientWidth }));
  expect(ancho).toBeLessThanOrEqual(visible);
  // En movil tambien: todo plegado.
  await expect(botonDeSeccion(page, 'producto')).toHaveAttribute('aria-expanded', 'false');
  expect(await graves(page), 'axe en la ficha a 360 px').toEqual([]);

  await page.goto('/referencias');
  const m = await page.evaluate(() => ({ ancho: document.documentElement.scrollWidth, visible: document.documentElement.clientWidth }));
  expect(m.ancho).toBeLessThanOrEqual(m.visible);
  expect(await graves(page), 'axe en el listado a 360 px').toEqual([]);
});

test('ficha: el encabezado se opera con teclado y un enlace con ancla abre solo su seccion', async ({ page, request }) => {
  await entrarComo(page, request, 'solicitante@desarrollo.invalid', '/referencias');
  await page.goto(`/referencias/${idFicha}#detalle`);
  await esperarFicha(page);
  // El ancla abre Detalle y deja las demas plegadas.
  await expect(botonDeSeccion(page, 'detalle')).toHaveAttribute('aria-expanded', 'true');
  await expect(botonDeSeccion(page, 'producto')).toHaveAttribute('aria-expanded', 'false');
  await expect(botonDeSeccion(page, 'especificaciones')).toHaveAttribute('aria-expanded', 'false');

  // Con teclado: el boton recibe foco y Enter abre y cierra; el contenido plegado no es alcanzable.
  const producto = botonDeSeccion(page, 'producto');
  await producto.focus();
  await expect(producto).toBeFocused();
  await expect(page.getByLabel(/^Uso$/)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(producto).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByLabel(/^Uso$/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(producto).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByLabel(/^Uso$/)).toBeHidden();

  // La zona de la aduana: bloques plegados, con su estado en el encabezado, y el atajo de arriba abre el bloque.
  const partida = botonDeSeccion(page, 'aduana-partida');
  await expect(partida).toHaveAttribute('aria-expanded', 'false');
  await expect(partida).toContainText(/Falta 1|Completa/);
  await page.getByRole('navigation', { name: 'Pasos de la zona de la aduana' }).getByRole('link', { name: /Partida/ }).click();
  await expect(partida).toHaveAttribute('aria-expanded', 'true');
});
