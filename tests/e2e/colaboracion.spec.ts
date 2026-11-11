/**
 * E2E de H3 · Colaboracion (SPEC 14, F3, F7, F8, 9.6, 17.1): navegador real, dos o tres personas a la vez.
 *  - A envia a B -> B ve la campana con contador -> marca "Listo por mi parte" -> A recibe el aviso. Y el enlace
 *    directo a la ficha SIN sesion pasa por /entrar y vuelve a ella.
 *  - Restaurar un valor anterior con motivo desde el acceso «Historial» del campo.
 *  - Recordar con tope diario, comentarios con alcance y el pendiente vive en la bandeja sin correo.
 *  - Envio en lote, movil a 360 px y axe sin violaciones serias o criticas.
 * Corre contra el servidor de desarrollo (E2E_URL): los avisos
 * viven en la campana y en «Para mi». No hay correo.
 * Cada persona entra UNA vez (en `beforeAll`) y las pruebas reutilizan su sesion: iniciar sesion es lo mas lento de
 * cada escenario.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { abrirSeccion, CLAVE_EJEMPLO, entrarComo, pulsarHidratado } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);

const CORREOS = {
  A: 'solicitante@desarrollo.invalid', // Edgar
  B: 'solicitante2@desarrollo.invalid', // Carla
  ADUANA: 'aduana-a@desarrollo.invalid', // Andres, Agencia Demo A
  ADMIN: 'admin@desarrollo.invalid', // Ana
} as const;
type Quien = keyof typeof CORREOS;

const SUFIJO = Date.now().toString(36).toUpperCase();

const sesiones = {} as Record<Quien, { contexto: BrowserContext; page: Page }>;
const errores = {} as Record<Quien, string[]>;
/** Lo que el primer escenario deja para el segundo (las pruebas corren en serie). */
const compartido: { id?: string; enlace?: string } = {};

async function entrar(page: Page, request: APIRequestContext, email: string, siguiente = '/'): Promise<void> {
  await entrarComo(page, request, email, siguiente);
}

function vigilar(page: Page, quien: Quien): void {
  errores[quien] = [];
  page.on('pageerror', (e) => errores[quien].push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errores[quien].push(`console: ${m.text()}`));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/dev/')) errores[quien].push(`http ${r.status()}: ${r.url()}`);
  });
}

async function abrirSesion(browser: Browser, request: APIRequestContext, quien: Quien): Promise<void> {
  const contexto = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
  const page = await contexto.newPage();
  vigilar(page, quien);
  await entrar(page, request, CORREOS[quien]);
  sesiones[quien] = { contexto, page };
}

/** Entra (una sola vez) con cada persona que la prueba necesita; las siguientes pruebas reutilizan la sesion. */
async function garantizar(browser: Browser, request: APIRequestContext, ...quienes: Quien[]): Promise<void> {
  for (const q of quienes) if (!sesiones[q]) await abrirSesion(browser, request, q);
}

test.afterAll(async () => {
  for (const s of Object.values(sesiones)) await s?.contexto.close().catch(() => undefined);
});

test.beforeEach(() => {
  for (const q of Object.keys(errores) as Quien[]) errores[q].length = 0;
});

/** Crea una referencia por la interfaz y devuelve su id. */
async function crearFicha(page: Page, codigo: string, nombre: string): Promise<string> {
  await page.goto('/referencias/nueva');
  await page.getByLabel('Código de referencia').fill(codigo);
  await page.getByLabel('Descripción según factura').fill(nombre);
  await page.getByRole('radio', { name: /^Insumo/ }).check();
  await page.getByLabel('Área responsable').selectOption('Consumibles');
  await page.getByRole('button', { name: /Crear y seguir/ }).click();
  await expect(page).toHaveURL(/\/referencias\/[0-9a-f-]{36}/, { timeout: 120_000 });
  return /\/referencias\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

/** Deja a la persona sin avisos pendientes de lectura: asi el contador de la campana es predecible. */
async function limpiarAvisos(page: Page): Promise<void> {
  await page.goto('/notificaciones');
  const marcar = page.getByRole('button', { name: 'Marcar todas como leídas' }).first();
  await expect(marcar).toBeVisible();
  if (await marcar.isEnabled()) {
    await marcar.click();
    await expect(marcar).toBeDisabled({ timeout: 60_000 });
  }
}

/** Cuantos avisos sin leer dice la campana (0 si no hay contador). */
async function contadorCampana(page: Page): Promise<number> {
  const nombre = (await page.getByRole('button', { name: /^Notificaciones/ }).first().getAttribute('aria-label')) ?? '';
  return Number(/(\d+) sin leer/.exec(nombre)?.[1] ?? 0);
}

async function esperarContador(page: Page, esperado: number): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        return contadorCampana(page);
      },
      { timeout: 120_000, intervals: [1000, 3000, 5000] },
    )
    .toBe(esperado);
}

async function abrirEnviarA(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Enviar a…' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function enviarAPersona(page: Page, busqueda: string, nombre: string, opciones: { mensaje?: string } = {}): Promise<void> {
  await abrirEnviarA(page);
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('¿A quién?').fill(busqueda);
  await dialogo.getByRole('group', { name: /Personas a las que puedes enviar/ }).getByText(nombre, { exact: false }).first().click();
  if (opciones.mensaje) await dialogo.getByLabel(/^Mensaje/).fill(opciones.mensaje);
  await dialogo.getByRole('button', { name: /^Enviar a / }).click();
  await expect(dialogo.getByTestId('resultado-envio')).toBeVisible({ timeout: 120_000 });
}

test('A envia a B: B ve la campana con contador y marca listo; A recibe el aviso', async ({ browser, request }) => {
  await garantizar(browser, request, 'A', 'B');
  const codigo = `E2E-${SUFIJO}-1`;
  const a = sesiones.A.page;
  const b = sesiones.B.page;
  const id = await crearFicha(a, codigo, 'Producto de la prueba de colaboración');
  // Lo que usa el escenario F8: el enlace directo a la ficha (el mismo que llevaria el correo).
  compartido.id = id;
  compartido.enlace = new URL(`/referencias/${id}`, a.url()).toString();

  // B ya esta dentro y sin avisos cuando A envia: asi se prueba el sondeo de la campana.
  await limpiarAvisos(b);
  await b.goto('/');
  await expect(b.getByRole('heading', { name: /Hola, Carla/ })).toBeVisible();
  expect(await contadorCampana(b)).toBe(0);

  await enviarAPersona(a, 'Carla', 'Carla Solicitante', { mensaje: 'Carla, falta Detalle; el resto está listo.' });
  const resultado = a.getByTestId('resultado-envio');
  await expect(resultado).toContainText('Enviado a Carla');
  await expect(resultado).toContainText('Ya tiene el pendiente en su bandeja');
  // Con el correo apagado no hay linea de correo: el aviso vive solo en la aplicacion.
  await expect(resultado).not.toContainText(/correo/i);
  await a.getByRole('button', { name: 'Listo', exact: true }).click();

  // B: la campana muestra el contador sin recargar (sondeo) y el aviso dice quien, que y para que.
  await esperarContador(b, 1);
  await b.getByRole('button', { name: 'Notificaciones, 1 sin leer' }).click();
  const panel = b.getByRole('dialog', { name: 'Notificaciones' });
  await expect(panel.getByText(new RegExp(`Edgar Solicitante te envió ${codigo} para completar`))).toBeVisible();
  await b.keyboard.press('Escape');

  // B abre la ficha: su pendiente pasa a "en curso" y su aviso queda leido.
  await b.goto(`/referencias/${id}`);
  await expect(b.getByRole('heading', { name: 'Producto de la prueba de colaboración' })).toBeVisible();
  await esperarContador(b, 0);

  // B marca "Listo por mi parte".
  await b.getByRole('button', { name: 'Listo por mi parte' }).first().click();
  await expect(b.getByText('Listo. Avisamos a quien te la envió', { exact: true })).toBeVisible({ timeout: 120_000 });

  // A recibe el aviso (pagina de notificaciones) y ya no la espera.
  await a.goto('/notificaciones');
  await expect(a.getByTestId('fila-notificacion').filter({ hasText: `Carla Solicitante terminó su parte en ${codigo}` })).toBeVisible({ timeout: 60_000 });
  await a.goto('/');
  await a.getByRole('tab', { name: /Esperando a otros/ }).click();
  await expect(a.getByText(codigo)).toHaveCount(0);

  expect(errores.A, errores.A.join('\n')).toEqual([]);
  expect(errores.B, errores.B.join('\n')).toEqual([]);
});

test('enlace directo a la ficha SIN sesion: pasa por /entrar conservando el destino y vuelve a la ficha (F8)', async ({ browser, request }) => {
  const { id, enlace } = compartido;
  expect(enlace, 'el primer escenario debe haber dejado el enlace').toBeTruthy();
  const c = await browser.newContext({ locale: 'es-CO', timezoneId: 'America/Bogota' });
  const p = await c.newPage();
  await p.goto(enlace!);
  await expect(p).toHaveURL(`${new URL(enlace!).origin}/entrar?siguiente=${encodeURIComponent(`/referencias/${id}`)}`, { timeout: 60_000 });
  await request.post('/api/dev/limites', { maxRetries: 3 });
  await p.getByLabel('Usuario').fill(CORREOS.B.split('@')[0]!);
  await p.getByLabel('Contraseña', { exact: true }).fill(CLAVE_EJEMPLO);
  await pulsarHidratado(p.getByRole('button', { name: 'Entrar', exact: true }));
  await expect(p).toHaveURL(new RegExp(`/referencias/${id}$`), { timeout: 120_000 });
  await expect(p.getByRole('heading', { name: 'Producto de la prueba de colaboración' })).toBeVisible();
  await c.close();
});

test('restaurar un valor anterior desde el campo: siempre pide motivo y deja una version nueva', async ({ browser, request }) => {
  await garantizar(browser, request, 'A', 'B');
  const a = sesiones.A.page;
  const b = sesiones.B.page;
  const id = await crearFicha(a, `E2E-${SUFIJO}-2`, 'Producto para restaurar');

  // A escribe, B (otra persona) lo reemplaza con motivo.
  await abrirSeccion(a, 'detalle');
  const campoA = a.getByLabel('Nombre comercial');
  await campoA.fill('LIMPIADOR VERSION UNO');
  await campoA.blur();
  // El aviso «Guardado» es efimero: se espera a lo duradero, el acceso al historial de ese campo (ya tiene version).
  await expect(a.locator('[data-campo="descripcion_factura"]').getByRole('button', { name: /Ver el historial de este campo/ })).toBeVisible({ timeout: 180_000 });

  await b.goto(`/referencias/${id}`);
  await abrirSeccion(b, 'detalle');
  const campoB = b.getByLabel('Nombre comercial');
  await campoB.fill('LIMPIADOR VERSION DOS');
  await campoB.blur();
  await b.getByLabel(/Motivo|por qué/i).first().fill('Así aparece en la factura');
  await b.getByRole('button', { name: /Guardar cambio/ }).click();
  await expect(b.locator('[data-campo="descripcion_factura"]').getByRole('button', { name: /Ver el historial de este campo \(2 versiones\)/ })).toBeVisible({ timeout: 180_000 });

  // B abre el historial DE ESE campo y restaura la version 1, con motivo.
  await b.reload();
  await abrirSeccion(b, 'detalle'); // tras recargar todo vuelve a plegado
  const bloque = b.locator('[data-campo="descripcion_factura"]');
  await bloque.getByRole('button', { name: /Ver el historial de este campo/ }).click();
  const versiones = b.getByRole('dialog', { name: 'Versiones de este campo' });
  await expect(versiones.getByTestId('entrada-historial')).toHaveCount(2, { timeout: 60_000 });
  await expect(versiones).toContainText('LIMPIADOR VERSION UNO');
  await expect(versiones).toContainText('Motivo: Así aparece en la factura');
  await versiones.getByRole('button', { name: /Restaurar «Nombre comercial» a la versión 1/ }).click();

  const dialogo = b.getByRole('dialog', { name: /Restaurar/ });
  const confirmar = dialogo.getByRole('button', { name: 'Restaurar este valor' });
  await expect(confirmar).toBeDisabled(); // sin motivo no se puede
  await dialogo.getByLabel('Motivo').fill('Era el texto correcto de la factura');
  await confirmar.click();
  await expect(b.getByText('Restauraste «Nombre comercial»', { exact: true })).toBeVisible({ timeout: 60_000 });

  // Quedo una version NUEVA (3), con su motivo, y nada se borro.
  await b.getByRole('button', { name: 'Historial y comentarios' }).first().click();
  const panel = b.getByRole('dialog', { name: 'Actividad de la referencia' });
  await expect(panel.getByText('restauraste un valor anterior').first()).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText('Motivo: Era el texto correcto de la factura')).toBeVisible();
  await expect(panel.getByTestId('entrada-historial').filter({ hasText: 'Nombre comercial' })).toHaveCount(3);
  await b.keyboard.press('Escape');
  expect(errores.B, errores.B.join('\n')).toEqual([]);
});

test('recordar con tope diario, comentarios con alcance y el pendiente vive en la bandeja sin correo', async ({ browser, request }) => {
  await garantizar(browser, request, 'A', 'ADUANA');
  const codigo = `E2E-${SUFIJO}-3`;
  const a = sesiones.A.page;
  const adu = sesiones.ADUANA.page;
  const id = await crearFicha(a, codigo, 'Producto para recordar');

  // Con el correo apagado el envio crea el pendiente y el aviso en la aplicacion; el panel lo dice.
  await enviarAPersona(a, 'Andr', 'Andrés Aduana A');
  await a.getByRole('button', { name: 'Listo', exact: true }).click();
  await a.getByRole('button', { name: 'Historial y comentarios' }).first().click();
  const panel = a.getByRole('dialog', { name: 'Actividad de la referencia' });
  await panel.getByRole('tab', { name: /Envíos/ }).click();
  const envio = panel.getByTestId('envio-abierto');
  await expect(envio).toContainText('Andrés Aduana A');
  await a.keyboard.press('Escape');

  // El pendiente de la agencia NO depende del correo: esta en su bandeja.
  await adu.goto('/');
  await expect(adu.getByTestId('fila-pendiente').filter({ hasText: codigo })).toBeVisible({ timeout: 60_000 });

  // Recordar: una vez al dia; despues queda deshabilitado con su razon.
  await a.goto('/');
  await a.getByRole('tab', { name: /Esperando a otros/ }).click();
  const fila = a.getByTestId('fila-esperando').filter({ hasText: codigo });
  await expect(fila).toBeVisible({ timeout: 60_000 });
  await fila.getByRole('button', { name: /Recordar a Andrés/ }).click();
  await expect(a.getByText('Le recordamos a Andrés Aduana A', { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(fila.getByRole('button', { name: /Recordado hoy/ })).toBeDisabled({ timeout: 60_000 });

  // Comentarios con alcance: un comentario interno no llega a la agencia; uno para todos si.
  await a.goto(`/referencias/${id}`);
  await a.getByRole('button', { name: 'Historial y comentarios' }).first().click();
  const cajon = a.getByRole('dialog', { name: 'Actividad de la referencia' });
  await cajon.getByRole('tab', { name: 'Comentarios' }).click();
  await cajon.getByLabel('Nuevo comentario').fill('Nota interna: ojo con el proveedor');
  await cajon.getByRole('button', { name: 'Publicar comentario' }).click();
  await expect(cajon.getByTestId('comentario').filter({ hasText: 'Nota interna' })).toContainText('Solo equipo interno', { timeout: 60_000 });
  await cajon.getByLabel('Nuevo comentario').fill('Andrés, confirma el fabricante');
  await cajon.getByLabel('También la aduana').check();
  await cajon.getByRole('button', { name: 'Publicar comentario' }).click();
  await expect(cajon.getByTestId('comentario').filter({ hasText: 'confirma el fabricante' })).toContainText('Visible para la aduana', { timeout: 60_000 });

  await adu.goto(`/referencias/${id}`);
  await adu.getByRole('button', { name: 'Historial y comentarios' }).first().click();
  const cajonAdu = adu.getByRole('dialog', { name: 'Actividad de la referencia' });
  await cajonAdu.getByRole('tab', { name: 'Comentarios' }).click();
  await expect(cajonAdu.getByTestId('comentario').filter({ hasText: 'confirma el fabricante' })).toBeVisible({ timeout: 60_000 });
  await expect(cajonAdu.getByText('Nota interna')).toHaveCount(0);
  await adu.keyboard.press('Escape');
  expect(errores.ADUANA, errores.ADUANA.join('\n')).toEqual([]);
});

test('envio en lote: dos referencias a una persona, quedan en su bandeja', async ({ browser, request }) => {
  await garantizar(browser, request, 'A', 'B');
  const a = sesiones.A.page;
  const c1 = `E2E-${SUFIJO}-L1`;
  const c2 = `E2E-${SUFIJO}-L2`;
  await crearFicha(a, c1, 'Lote uno');
  await crearFicha(a, c2, 'Lote dos');
  await a.goto('/dev/colaboracion');
  await a.getByLabel(`Seleccionar ${c1}`).check();
  await a.getByLabel(`Seleccionar ${c2}`).check();
  const barra = a.getByRole('region', { name: 'Envío en lote' });
  await expect(barra).toContainText('2 referencias seleccionadas');
  await barra.getByRole('button', { name: 'Enviar a…' }).click();
  const dialogo = a.getByRole('dialog');
  await expect(dialogo.getByText(/Vas a enviar 2 referencias/)).toBeVisible();
  await dialogo.getByLabel('¿A quién?').fill('Carla');
  await dialogo.getByRole('group', { name: /Personas a las que puedes enviar/ }).getByText('Carla Solicitante').first().click();
  await dialogo.getByRole('button', { name: /^Enviar 2 referencias a Carla/ }).click();
  const resultado = dialogo.getByTestId('resultado-envio');
  await expect(resultado).toContainText('Enviado a Carla', { timeout: 120_000 });
  await expect(resultado).toContainText('Ya tiene 2 pendientes en su bandeja');
  await dialogo.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(barra).toHaveCount(0); // la seleccion se limpio

  // Sin correo, Carla tiene un aviso por ficha en la aplicacion (el resumen del lote solo existe como correo).
  const b = sesiones.B.page;
  await b.goto('/notificaciones');
  for (const codigo of [c1, c2]) {
    await expect(b.getByTestId('fila-notificacion').filter({ hasText: `Edgar Solicitante te envió ${codigo}` })).toBeVisible({ timeout: 60_000 });
  }
});

test('accesibilidad: axe sin violaciones serias o criticas en inicio, notificaciones, campana, dialogo y panel', async ({ browser, request }) => {
  await garantizar(browser, request, 'ADMIN');
  const a = sesiones.ADMIN.page;
  const analizar = async (donde: string) => {
    const r = await new AxeBuilder({ page: a }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const graves = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(graves, `${donde}: ${graves.map((v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(' | ')})`).join('; ')}`).toEqual([]);
  };

  await a.goto('/');
  await expect(a.getByRole('heading', { name: /Hola, Samuel/ })).toBeVisible();
  await analizar('inicio');
  await a.getByRole('button', { name: /^Notificaciones/ }).click();
  await expect(a.getByRole('dialog', { name: 'Notificaciones' })).toBeVisible();
  await analizar('campana abierta');
  await a.keyboard.press('Escape');

  await a.goto('/notificaciones');
  await expect(a.getByRole('heading', { name: 'Notificaciones', level: 1 })).toBeVisible();
  await analizar('/notificaciones');

  await crearFicha(a, `E2E-${SUFIJO}-AX`, 'Producto de accesibilidad');
  await abrirEnviarA(a);
  await expect(a.getByRole('dialog').getByRole('group', { name: /Personas a las que puedes enviar/ })).toBeVisible({ timeout: 60_000 });
  await analizar('dialogo Enviar a');
  await a.keyboard.press('Escape');

  await a.getByRole('button', { name: 'Historial y comentarios' }).first().click();
  const panel = a.getByRole('dialog', { name: 'Actividad de la referencia' });
  await expect(panel.getByRole('tab', { name: 'Historial' })).toBeVisible();
  await analizar('panel de actividad');
  await panel.getByRole('tab', { name: 'Comentarios' }).click();
  await expect(panel.getByLabel('Nuevo comentario')).toBeVisible({ timeout: 60_000 });
  await analizar('panel: comentarios');
  await a.keyboard.press('Escape');
});

test.describe('movil 360 px', () => {
  test('inicio, campana y dialogo "Enviar a" sin scroll horizontal y con objetivos tactiles', async ({ browser, request }) => {
    await garantizar(browser, request, 'A');
    // La misma sesion de Edgar, en un telefono: no hace falta iniciar sesion otra vez.
    const estado = await sesiones.A.contexto.storageState();
    const contexto = await browser.newContext({
      storageState: estado,
      locale: 'es-CO',
      timezoneId: 'America/Bogota',
      viewport: { width: 360, height: 740 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const a = await contexto.newPage();
      const sinDesborde = async (donde: string) => {
        const { ancho, vista } = await a.evaluate(() => ({ ancho: document.documentElement.scrollWidth, vista: window.innerWidth }));
        expect(ancho, `${donde}: scroll horizontal (${ancho} > ${vista})`).toBeLessThanOrEqual(vista);
      };
      await a.goto('/');
      await expect(a.getByRole('heading', { name: /Hola, Edgar/ })).toBeVisible();
      await sinDesborde('inicio');

      await a.getByRole('button', { name: /^Notificaciones/ }).click();
      const campana = a.getByRole('dialog', { name: 'Notificaciones' });
      await expect(campana).toBeVisible();
      const caja = await campana.boundingBox();
      expect(caja!.x).toBeGreaterThanOrEqual(0);
      expect(caja!.x + caja!.width).toBeLessThanOrEqual(360);
      await a.keyboard.press('Escape');

      await crearFicha(a, `E2E-${SUFIJO}-M`, 'Producto móvil');
      await abrirEnviarA(a);
      await expect(a.getByRole('dialog').getByRole('group', { name: /Personas a las que puedes enviar/ })).toBeVisible({ timeout: 60_000 });
      const d = await a.getByRole('dialog').boundingBox();
      expect(d!.x).toBeGreaterThanOrEqual(0);
      expect(d!.x + d!.width).toBeLessThanOrEqual(360);
      await sinDesborde('dialogo enviar a');
      const boton = await a.getByRole('dialog').getByRole('button', { name: /^Enviar/ }).boundingBox();
      expect(boton!.height).toBeGreaterThanOrEqual(44);
    } finally {
      await contexto.close();
    }
  });
});
