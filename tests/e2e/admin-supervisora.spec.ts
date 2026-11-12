/**
 * E2E de la supervisora general (rol `supervisor`), en navegador real contra el servidor de desarrollo (`E2E_URL`).
 *
 * Es igual al administrador en la administracion, con dos excepciones: no tiene Parametros y no administra claves.
 *  - El menu no ofrece Parametros y /admin/parametros pinta el aviso de permiso; la ficha de una persona trae todos los
 *    controles de gestion (datos, rol, organizacion, sesiones, desactivar) salvo «Restablecer contraseña»; la ficha de un
 *    administrador es solo lectura para ella.
 *  - Crea una cuenta suelta y una agencia: la pantalla NO muestra clave, explica que queda pendiente de entrega y la
 *    cuenta aparece «Pendiente de entrega» (sin credencial, no puede entrar).
 *  - El administrador recibe el aviso `cuenta_creada` de cada una, abre la cuenta y la entrega con «Restablecer
 *    contraseña»: ahora si se muestra una clave (una sola vez), el aviso queda resuelto y la cuenta entra.
 *
 * Reinicia la base LOCAL al empezar (`POST /api/dev/reset`, solo desarrollo): corre contra TU servidor, con TU base
 * (`PGLITE_DIR` propio), nunca contra uno compartido.
 */
import { expect as expectBase, test, type Page } from '@playwright/test';
import { contextoAutenticado, entrarComo, pulsarHidratado } from './ayudas';

test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.setTimeout(600_000);
});
test.use({ navigationTimeout: 240_000, actionTimeout: 90_000 });
// En desarrollo la primera visita a cada ruta compila: margen amplio.
const expect = expectBase.configure({ timeout: 120_000 });

const SUPERVISORA = 'supervisor@desarrollo.invalid';
const ADMIN = 'admin@desarrollo.invalid';
const SUFIJO = Date.now().toString(36);
const AGENCIA = `Agencia Supervisada ${SUFIJO}`;
const CUENTA = `Cuenta Supervisada ${SUFIJO}`;
const USUARIO_CUENTA = `cuenta-sup-${SUFIJO}`;
const EDGAR = 'Edgar Solicitante [DESARROLLO]';
const ADMINISTRADOR = 'Samuel Galeano [DESARROLLO]';
const FORMATO_CLAVE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;

/** Lo que crea la supervisora y el administrador entrega despues: nombre, usuario y enlace de la cuenta. */
const creadas: Record<'agencia' | 'cuenta', { nombre: string; usuario: string; cuentaId: string }> = {
  agencia: { nombre: AGENCIA, usuario: '', cuentaId: '' },
  cuenta: { nombre: CUENTA, usuario: USUARIO_CUENTA, cuentaId: '' },
};

const idDeLaCuenta = (page: Page) => new URL(page.url()).pathname.split('/').pop() ?? '';

test.beforeAll(async ({ request }) => {
  const r = await request.post('/api/dev/reset?ejemplos=0', { maxRetries: 3 });
  expect(r.ok(), 'POST /api/dev/reset (solo desarrollo)').toBe(true);
});

test('la supervisora no ve Parámetros: ni en el menú, ni en el resumen, ni por la ruta directa', async ({ page, request }) => {
  await entrarComo(page, request, SUPERVISORA);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { level: 1, name: 'Administración' })).toBeVisible();
  const menu = page.getByRole('navigation', { name: 'Principal' }).first();
  await expect(menu.getByRole('link', { name: 'Administración' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Usuarios' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Organizaciones' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Catálogos' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Auditoría' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Parámetros' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Parámetros/ })).toHaveCount(0); // ni el atajo del resumen

  // La ruta directa tampoco le abre nada: el aviso de permiso, sin los parametros detras.
  await page.goto('/admin/parametros');
  await expect(page.getByRole('heading', { name: 'No tienes permiso para ver esto' })).toBeVisible();
  await expect(page.getByText('CIERRE_MODO')).toHaveCount(0);
});

test('la ficha de una persona tiene todos los controles de gestión, menos «Restablecer contraseña»', async ({ page, request }) => {
  await entrarComo(page, request, SUPERVISORA);
  await page.goto('/admin/usuarios');
  await expect(page.getByRole('link', { name: 'Crear cuenta' })).toBeVisible();
  await page.getByRole('link', { name: `Abrir a ${EDGAR}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Edgar Solicitante/ })).toBeVisible();

  // Datos, rol, organizacion, sesiones y desactivar: igual que el administrador.
  for (const seccion of ['Datos', 'Rol', 'Organización', 'Desactivar']) {
    await expect(page.getByRole('heading', { name: seccion, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Guardar datos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cambiar rol' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Desactivar a/ })).toBeVisible();
  // Puede dar solicitante, aduana o lector; nunca administrador ni supervisora.
  await expect(page.getByRole('radio', { name: /^Solicitante/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Aduana/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Lector/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Administrador/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^Supervisora general/ })).toHaveCount(0);

  // Lo unico que no tiene son las claves.
  await expect(page.getByRole('button', { name: 'Restablecer contraseña' })).toHaveCount(0);
  await expect(page.getByTestId('restablecer-clave')).toHaveCount(0);
});

test('la ficha del administrador es solo lectura para la supervisora', async ({ page, request }) => {
  await entrarComo(page, request, SUPERVISORA);
  await page.goto('/admin/usuarios');
  await page.getByRole('link', { name: `Abrir a ${ADMINISTRADOR}` }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Samuel Galeano/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Datos' })).toBeVisible();
  await expect(page.getByText('Solo lectura', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Restablecer contraseña|Desactivar|Cambiar rol|Cambiar de organización|Guardar datos|Cerrar sesión|Cerrar todas/ })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Sesiones abiertas' })).toHaveCount(0);
});

test('la supervisora crea una cuenta suelta: no ve ninguna clave y la cuenta nace con su clave, que solo ve el administrador', async ({ page, request }) => {
  await entrarComo(page, request, SUPERVISORA);
  await page.goto('/admin/usuarios/nueva');
  await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();

  // El formulario explica lo que va a pasar y no ofrece roles que ella no puede dar.
  await expect(page.getByText('La contraseña la entrega el administrador')).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Administrador/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^Supervisora general/ })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: /^Solicitante/ })).toBeVisible();

  await page.getByLabel(/^Nombre/).fill(CUENTA);
  await page.getByLabel('Usuario', { exact: true }).fill(USUARIO_CUENTA);
  await page.getByLabel(/^Área/).selectOption('Consumibles');
  await pulsarHidratado(page.getByRole('button', { name: 'Crear la cuenta' }));

  await expect(page.getByRole('heading', { name: `Cuenta creada: ${CUENTA}` })).toBeVisible();
  await expect(page.getByText('Cuenta lista: el administrador entrega la contraseña')).toBeVisible();
  await expect(page.getByTestId('credenciales-entrega')).toHaveCount(0);
  await expect(page.getByTestId('credencial-contraseña')).toHaveCount(0);
  await expect(page.getByText('Quedan guardadas: las puedes volver a ver')).toHaveCount(0);

  // La ficha la marca «Pendiente de entrega» y no ofrece generar la clave.
  await page.getByRole('link', { name: 'Ver la cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: CUENTA })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restablecer contraseña' })).toHaveCount(0);
  creadas.cuenta.cuentaId = idDeLaCuenta(page);
  expect(creadas.cuenta.cuentaId).toMatch(/^[0-9a-f-]{36}$/);
});

test('la supervisora crea una agencia: no ve ninguna clave y la cuenta nace con su clave, que solo ve el administrador', async ({ page, request }) => {
  await entrarComo(page, request, SUPERVISORA);
  await page.goto('/admin/organizaciones');
  await page.getByLabel('Nombre de la empresa').fill(AGENCIA);
  const campoUsuario = page.getByLabel('Usuario', { exact: true });
  await expect(campoUsuario).toHaveValue(/\.aduana$/);
  creadas.agencia.usuario = await campoUsuario.inputValue();
  await pulsarHidratado(page.getByRole('button', { name: 'Crear agencia' }));

  await expect(page.getByRole('heading', { name: `Agencia creada: ${AGENCIA}` })).toBeVisible();
  await expect(page.getByText('Cuenta lista: el administrador entrega la contraseña')).toBeVisible();
  await expect(page.getByTestId('credenciales-entrega')).toHaveCount(0);
  await expect(page.getByTestId('credencial-contraseña')).toHaveCount(0);
  await expect(page.getByText('Quedan guardadas: las puedes volver a ver')).toHaveCount(0);

  await page.getByRole('link', { name: 'Ver la cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: AGENCIA })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restablecer contraseña' })).toHaveCount(0);
  creadas.agencia.cuentaId = idDeLaCuenta(page);
  expect(creadas.agencia.cuentaId).toMatch(/^[0-9a-f-]{36}$/);
});

for (const clave of ['cuenta', 'agencia'] as const) {
  test(`el administrador recibe el aviso de la ${clave === 'cuenta' ? 'cuenta suelta' : 'agencia'}, ve su usuario y contraseña y esa contraseña entra`, async ({ browser, request }) => {
    const { nombre, usuario, cuentaId } = creadas[clave];
    const admin = await contextoAutenticado(browser, request, ADMIN);
    const page = admin.page;

    // El aviso llega a la bandeja, sin leer, y lleva a la ficha de la cuenta.
    await page.goto('/notificaciones');
    const fila = page.getByTestId('fila-notificacion').filter({ hasText: usuario });
    await expect(fila).toHaveCount(1);
    await expect(fila).toContainText('Cuenta nueva');
    await expect(fila).toContainText('revisa su clave y entrégala');
    await expect(fila).toHaveAttribute('data-leida', 'no');
    const destino = await fila.getAttribute('href');
    expect(destino).toBe(`/admin/usuarios/${cuentaId}`);

    // La ficha muestra el usuario; la contraseña se ve al pedirla (no viaja con la pagina).
    await page.goto(destino!);
    await expect(page.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
    await expect(page.getByText('Contraseña actual')).toHaveCount(0);
    await pulsarHidratado(page.getByTestId('ver-clave-boton'));
    await expect(page.getByText('Contraseña actual')).toBeVisible();
    const claveVista = (await page.getByTestId('ver-clave').getByTestId('texto-copiable').last().innerText()).trim();
    expect(claveVista).toMatch(FORMATO_CLAVE);

    // Verla da el aviso por atendido.
    await page.goto('/notificaciones');
    await expect(page.getByTestId('fila-notificacion').filter({ hasText: usuario })).toHaveAttribute('data-leida', 'si');

    // La cuenta entra con esa contraseña, tal como estaba guardada.
    const cuenta = await contextoAutenticado(browser, request, usuario, claveVista);
    await expect(cuenta.page).not.toHaveURL(/\/entrar/);
    await cuenta.contexto.close();
    await admin.contexto.close();
  });
}
