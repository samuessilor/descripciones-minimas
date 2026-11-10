# Descripciones mínimas

Plataforma web de EssilorLuxottica · Supply Chain para construir, entre varias personas y agencias de aduana,
una **ficha viva por referencia** (descripciones mínimas y clasificación arancelaria): se llena una sola vez, se
envía a quien sigue con un clic, queda con historial por campo y, cuando se clasifica, nadie vuelve a pedirla.

Este repositorio contiene **solo la aplicación**. La especificación, los insumos y las notas de trabajo viven fuera.

## Estado

Producto funcionando de punta a punta **en local**, en su versión básica (se mejora a medida que se aprueba):

1. se entra con **usuario y contraseña** (sin correo): las cuentas las crea el administrador o la supervisora, una por área (con un «encargado» opcional) y una por agencia de aduana (la agencia se crea en un solo paso desde Organizaciones; si la crea la supervisora, igual que cualquier cuenta suya, queda pendiente de entrega hasta que el administrador genera la clave); la contraseña de entrega es la de uso (cambiarla en «Mi cuenta» es opcional; mínimo 7 caracteres);
2. se crea una referencia y se llena la ficha (autoguardado por campo, historial por campo, nadie borra lo de otra persona);
3. «Enviar a…» una persona o un área: le queda como pendiente con aviso en la campana y en «Para mí» (no hay correo);
4. la aduana pone la partida (se copia su restricción), pide lo que le falte saber en «Descripciones mínimas adicionales» (le llega al área responsable como pendiente «Responder» y esta contesta en la misma zona), completa restricciones y observaciones y finaliza: la ficha pasa a verde;
5. se busca con la lupa, se ve el listado (amarillos y verdes) y se descarga la base en Excel;
6. la administración crea cuentas (con contraseña temporal que entrega a mano), restablece contraseñas y gestiona usuarios; el resumen muestra qué falta y de quién.

Todo corre sin credenciales externas: base PGlite embebida y archivos locales. Antes de usar datos reales hacen falta las
aprobaciones de TI y el logo oficial (ver «Producción» y `docs/DESPLIEGUE-VERCEL.md`).

## Requisitos

- Node.js 24 (ver `.nvmrc`) y npm 11. No hace falta Docker ni credenciales externas para trabajar en local.

## Arrancar con UN comando

```bash
npm ci            # solo la primera vez
npm run inicio
```

Es el mismo comando en **PowerShell, cmd, bash y zsh**. `npm run inicio` hace `setup` (carpetas y `.env.local` con secretos
nuevos), busca un puerto libre (3000; si está ocupado usa el siguiente y alinea `APP_URL`), arranca el servidor de
desarrollo —que migra y siembra la base— y abre el navegador en `/entrar`. Con otro puerto o sin abrir el navegador:

```powershell
# PowerShell
$env:PORT = '3010'; $env:NO_ABRIR = '1'; npm run inicio
```

```bash
# bash / zsh
PORT=3010 NO_ABRIR=1 npm run inicio
```

(Equivale a `npm run setup` + `npm run dev`, que siguen existiendo por separado.) Si prefieres arrancar tú el servidor en
otro puerto, `APP_URL` debe coincidir con él:

```bash
APP_URL=http://localhost:3010 npx next dev -p 3010                                # Git Bash / macOS / Linux
```

```powershell
$env:APP_URL = 'http://localhost:3010'; npx next dev -p 3010                      # PowerShell (Windows)
```

`npm run setup` escribe `APP_URL=http://localhost:3000` en `.env.local` la primera vez y no lo cambia si el archivo ya
existe. Si el servidor corre en otro puerto, `APP_URL` debe coincidir con él.

### Entrar en local: cuentas de desarrollo

La base local es **PGlite** (Postgres embebido en `.data/pglite`) y el almacén de archivos es local. No hay registro
abierto: solo entra quien un administrador creó (`/admin/usuarios`). En desarrollo ya están estas once cuentas (usuario
= la parte antes de la `@`; todas con el correo `@desarrollo.invalid` y el nombre marcado `[DESARROLLO]`), **todas con la
contraseña de ejemplo `desarrollo-2026`**:

| Usuario | Rol | Organización | Para qué sirve |
|---|---|---|---|
| `admin` | Administradora | EssilorLuxottica | crear cuentas, restablecer contraseñas, catálogos (listas, restricciones, partidas), auditoría |
| `supervisor` | Supervisora general | EssilorLuxottica | igual que el administrador, salvo parámetros y contraseñas: gestiona cuentas (las que crea quedan pendientes de entrega), organizaciones, catálogos y auditoría, pero no crea ni toca administradores ni supervisoras |
| `solicitante` | Solicitante (Consumibles) | EssilorLuxottica | crear y llenar fichas, enviarlas |
| `solicitante2` | Solicitante (Mantenimiento) | EssilorLuxottica | idem; segunda persona para ver historial y conflictos |
| `lector` | Lector | EssilorLuxottica | solo consulta y descarga el Excel |
| `aduana-a` | Aduana | Agencia Demo A | clasifica lo que le envían; no ve lo de la agencia B |
| `aduana-b` | Aduana | Agencia Demo B | idem, en otra agencia |
| `consumibles`, `mantenimiento`, `instrumentos`, `marketing` | Solicitante (cuenta general de cada área) | EssilorLuxottica | ve en «Para mí» lo de su área aunque nadie se lo envíe y recibe las solicitudes de la aduana |

Con `npm run inicio` no se escribe nada: entras como administradora y cambias de cuenta desde el menú de arriba a la
derecha («Ver como», con las once cuentas). Para probar el acceso real, `CON_LOGIN=1 npm run inicio` pide usuario y
contraseña como en producción. La contraseña de ejemplo no existe en producción: allí cada cuenta tiene la suya, generada.

### Datos de ejemplo

Al arrancar con la base vacía se siembran, además de los usuarios, **15 referencias inventadas** (`TEST-0001..0003` y
`EJ-0001..EJ-0012`: resinas, filtros, motores, sensores, cintas…) en todos los estados —borrador, en gestión, pendiente
de información, clasificada (verde) y reabierta—, con varios autores, comentarios, historial con ediciones de personas
distintas, pendientes para cada rol y avisos. No hay ningún dato de los Excel de trabajo. Para volver a ese
punto de partida con el servidor encendido: `POST /api/dev/reset` (con `?ejemplos=0` deja solo los usuarios y las
tres `TEST-*`, que es la semilla que usan las pruebas E2E).

### Avisos

Los avisos de «Enviar a» (también la solicitud de información de la aduana, que le abre al área el pedido «Responder»), de
«Listo por mi parte», de la aduana (clasificada, reabierta, reapertura solicitada) y de las reasignaciones al desactivar
a una persona pasan por el mismo mecanismo: aviso en la campana y en «Para mí», en la misma transacción. **No hay
correo** en ninguna parte de la plataforma.

### PGlite es de un solo proceso

Dos procesos sobre el mismo `.data/pglite` no comparten estado y pueden corromper la base. Por eso:

- solo **el servidor de Next** abre la base mientras corre;
- `npm run seed`, `npm run db:reset` y `npm run db:migrate` se ejecutan **con el servidor detenido** (se niegan a
  abrir la base si detectan que está en uso); con el servidor en marcha usa `POST /api/dev/seed` y
  `POST /api/dev/reset` (solo desarrollo);
- las pruebas E2E no abren la base: entran por la pantalla de entrada con usuario y contraseña de ejemplo.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run inicio` | **Todo en uno para ver la aplicación:** `setup` + servidor de desarrollo en un puerto libre + abre el navegador (ver «Arrancar con UN comando») |
| `npm run dev` / `build` / `start` | Servidor de desarrollo, compilación y servidor de producción. **`start` exige `DATABASE_URL`** (Postgres con el rol `app`, p. ej. Neon) además de `BETTER_AUTH_SECRET`, y las fotos en Vercel Blob (`ALMACEN=blob` + `BLOB_READ_WRITE_TOKEN`): sin ellas el servidor imprime al arrancar `[config] El servidor no puede arrancar. En producción DATABASE_URL es obligatoria…` y todas las páginas responden 500 hasta que la definas. Para probar en local usa `npm run dev` (PGlite) |
| `npm run lint` / `typecheck` | ESLint (incluye las reglas de capas) y TypeScript estricto (pasa desde cero, sin compilar ni generar nada antes) |
| `npm test` | Pruebas unitarias del dominio puro (Vitest) |
| `npm run test:integ` | Pruebas de integración sobre PGlite en memoria (una instancia por archivo) |
| `npm run test:db-real` | Pruebas contra un Postgres **real** con los roles `migrador` y `app` (ver abajo) |
| `npm run test:e2e` | Pruebas de navegador (Playwright con el Chrome/Edge instalado). Usan el servidor de desarrollo del puerto 3010 (lo levantan si no está; con otro: `E2E_URL`) y **reinician la base local con la semilla mínima** al empezar (`POST /api/dev/reset?ejemplos=0`; no se hace con `E2E_FICHA` ni `E2E_SIN_REINICIO=1`). Las capturas van a `E2E_CAPTURAS` o a una carpeta temporal, nunca al repositorio. Al terminar, `POST /api/dev/reset` devuelve los datos de ejemplo |
| `npm run db:generate` | Genera una migración desde el esquema de Drizzle |
| `npm run db:migrate` | Aplica `drizzle/` (paso explícito; nunca parte del `build`) |
| `npm run db:reset` | Borra y recrea la base **local** con semillas (`--sin-ejemplos`: solo usuarios y las 3 `TEST-*`; `--sin-datos-de-desarrollo`: solo datos maestros) |
| `npm run db:roles` | Crea los roles `migrador` y `app` en un Postgres propio |
| `npm run seed` | Datos maestros y, en desarrollo, usuarios y referencias de ejemplo |
| `npm run admin:inicial` | Crea el primer administrador (usuario y contraseña temporal que se muestra una vez) |
| `npm run cuentas:iniciales` | Crea las cuentas por área y por agencia desde un archivo; deja usuarios y contraseñas en un archivo **fuera del repositorio** (`--salida`) |

### Pruebas con Postgres real

`npm run test:db-real` levanta un Postgres embebido (paquete de desarrollo `embedded-postgres`) en un directorio
temporal y un puerto libre, crea los roles `migrador` (dueño) y `app` (no dueño), migra como `migrador` y ejecuta las
pruebas **conectado como `app`**: permisos del historial inmutable, concurrencia real con varias conexiones y
reconstrucción de la proyección. En CI se usa el servicio Postgres del flujo de trabajo (`DATABASE_URL_TEST_ADMIN`).

## Estructura

```
src/
  dominio/      PURO (sin Next ni base): campos, estado, completitud, permisos, partida, días de gestión, cantidad, valores
  db/           esquema de Drizzle, conexión (PGlite / Neon / pg), migraciones y semillas maestras
  server/       políticas (lecturas ya filtradas por el Actor), acciones (núcleo transaccional), acceso, auth, claves
  app/          páginas, Route Handlers y Server Actions (capa delgada)
  componentes/  interfaz (shadcn/ui, Estado, ficha de prueba)
drizzle/        migraciones SQL (generadas + escritas a mano: triggers y permisos)
tests/          unit · integracion · db-real · e2e · fixtures
scripts/        setup, inicio, db-migrate, db-reset, db-roles, seed, admin-inicial, cuentas-iniciales
```

Capas impuestas por ESLint: `dominio` no importa de `db` ni de `server`; `server` importa de `dominio` y `db`; las
páginas y componentes no acceden a la base (usan `server/politicas` y `server/acciones`).

## Decisiones que conviene conocer

- **Nadie borra lo que otro puso.** Cada valor escrito es un hecho inmutable en `campo_historial` (trigger por
  sentencia que rechaza `UPDATE`, `DELETE` y `TRUNCATE`, y permisos del rol `app`). `referencia.datos` es una
  proyección que solo `aplicarEscritura()` modifica; una prueba la reconstruye desde el historial y compara.
- **Reemplazar un valor ajeno** exige un motivo y avisa a su autor; no se puede dejar vacío un valor ajeno. Vale por
  `guardarCampo`, `restaurarCampo` y «Usar el mío» de un conflicto.
- **Concurrencia por campo**: `guardarCampo` recibe la versión esperada; si cambió, devuelve `CONFLICTO` con el valor
  vigente. Nunca hay «el último gana» en silencio.
- **Dos colores de estado** (amarillo y verde, siempre con icono y palabra). Rojo solo para errores de validación.
- **Aislamiento entre agencias** en la capa de políticas del servidor (no con RLS): una ficha ajena responde 404.
- **Acceso por usuario y contraseña, sin correo.** Better Auth (contraseña con scrypt). Sin registro abierto: las crea un
  administrador con una contraseña temporal que se muestra **una sola vez** (en la base solo queda su hash). Mensaje de
  error único (no revela si el usuario existe); 10 intentos fallidos por usuario y 100 por IP cada 15 min; entrar bien no
  gasta el cupo (varias personas comparten la cuenta de un área). «Restablecer contraseña» cierra las sesiones de esa cuenta.

## Producción (resumen)

Vercel + Neon. La aplicación usa `DATABASE_URL` con el rol `app` (no dueño); las migraciones corren en CI con
`DATABASE_URL_UNPOOLED` como `migrador` (`npm run db:migrate`). Variables: ver `.env.example`. Antes de usar datos
reales hacen falta las aprobaciones de TI y el logo oficial. Pasos detallados: `docs/DESPLIEGUE-VERCEL.md`.

Al actualizar una base que ya existía (local o Neon), `npm run db:migrate` aplica solo lo pendiente. La migración
0003 retira las preguntas y plantillas de descripciones mínimas (ahora son un campo de texto de la ficha): borra sus
tablas y conserva el historial (`docs/DESVIACIONES.md`, Parte 8). La 0004 añade el tipo Montura. La 0005 pasa
`usuario.area` al catálogo de cuatro áreas (Consumibles, Mantenimiento, Instrumentos, Marketing; «Insumos» pasa a
Consumibles): el texto libre que no corresponda a ninguna queda vacío, y cada ficha existente toma como área responsable
la de quien la creó. Después de migrar, revisa las áreas en Administración › Usuarios. La 0006 añade `usuario.username` (con lo que se entra)
y la 0007 retira la cola de correo y las preferencias de aviso, que ya no existen. Con PGlite local, con el servidor
detenido.

### Despliegue básico (gratis, sin CI ni roles separados)

Para una primera versión con pocas personas. En volumen todo cabe en los planes gratuitos de Vercel, Neon y Vercel
Blob, pero **Vercel Hobby es solo para uso personal no comercial** (*Fair Use Guidelines*, «Commercial usage»): una
herramienta interna de la empresa cuenta como uso comercial, así que Hobby sirve para un piloto o una demo. Para operar
hace falta Vercel Pro (unos 20 USD/mes por miembro) o la cuenta corporativa si TI la tiene (P-12 en
`docs/03-arquitectura.md`). Neon free y Blob no tienen esa restricción.

Neon free da 100 horas de cómputo (CU-h) al mes y la base solo se suspende tras 5 min sin consultas. Los sondeos de la
interfaz se detienen cuando nadie usa la pestaña (10 min sin tocarla), así que una pestaña olvidada no la mantiene
despierta.

1. **Proyecto en Vercel** con la carpeta `app\` como raíz (framework Next.js; `vercel.json` ya no tiene crons).
2. **Base**: en el proyecto, *Storage → Neon* (gratis). Crea `DATABASE_URL` y `DATABASE_URL_UNPOOLED`. Con el rol
   dueño basta para empezar; los roles `app`/`migrador` (`npm run db:roles`) son el endurecimiento posterior.
   **Región: Washington D.C. / AWS us-east-1**, la misma de las funciones de Vercel (*Settings → Functions*, `iad1`
   por defecto). No elijas São Paulo aunque quede más cerca de Colombia: cada página hace varias consultas en serie
   de la función a la base. Si eliges otra región, cambia también la de las funciones a la misma.
3. **Fotos** (opcionales en la ficha): *Storage → Create Storage → Blob → Continue*, con acceso **Private** (no se
   puede cambiar después; la app usa `access: 'private'` y con un almacén público toda foto falla). Conéctalo al
   proyecto (agrega `BLOB_READ_WRITE_TOKEN`) y pon `ALMACEN=blob`. Sin esto, subir una foto falla, porque el disco de
   Vercel no guarda archivos.
4. **Variables** (*Settings → Environment Variables*), **antes del primer build**:

   | Variable | Valor |
   |---|---|
   | `APP_URL` | la URL final, p. ej. `https://descripciones-minimas.vercel.app`. Se lee al compilar (orígenes de Server Actions) |
   | `BETTER_AUTH_SECRET` | 32+ caracteres aleatorios: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
   | `ALMACEN` y `BLOB_READ_WRITE_TOKEN` | `blob` y el token que agrega Vercel al conectar el Blob |

   No hace falta ningún proveedor de correo: no se envía correo en ninguna parte.
5. **Base lista**, una vez y desde este equipo, con las URLs de Neon en la consola. Estos scripts exigen un
   `BETTER_AUTH_SECRET` aunque no lo usan: lo toman de `.env.local` (lo crea `npm run setup` o `npm run inicio`); en
   un clon nuevo sin ese archivo, defínelo en la misma consola con cualquier valor de 32+ caracteres.

   ```powershell
   $env:DATABASE_URL = '<url de Neon>'; $env:DATABASE_URL_UNPOOLED = '<url directa de Neon>'
   # No definas NODE_ENV=production aquí: en ese modo los scripts exigen también el token de Blob, que se crea después.
   # $env:BETTER_AUTH_SECRET = '<32+ caracteres>'   # solo si este equipo no tiene .env.local
   npm run db:migrate                             # aplica todas las migraciones de drizzle/ (hoy 0000-0011)
   npm run seed -- --solo-maestros                # solo catálogos, restricciones y partidas (sin usuarios ni fichas [DESARROLLO])
   npm run cuentas:iniciales -- ..\datos\cuentas.json --salida ..\datos\claves-entregables.txt   # administrador, una cuenta por area y por agencia (formato: cuentas.ejemplo.json)
   # Contraseña inicial: la de cada cuenta en el archivo (o, sin ella, la convención de docs/DESPLIEGUE-VERCEL.md); se cambia al primer ingreso.
   # (Solo el administrador, con contraseña aleatoria: npm run admin:inicial -- usuario "Nombre Apellido")
   ```

   Cierra esa consola al terminar: las variables solo viven ahí y `npm run inicio` volvería a usar Neon.

6. **Desplegar** y entrar en `APP_URL/entrar` con ese usuario y contraseña. Las demás cuentas se crean desde
   *Administración → Usuarios → Crear cuenta*, o ya quedaron creadas con `cuentas:iniciales`; las contraseñas se
   entregan a mano y cambiarla en «Mi cuenta» es opcional. Límites de los planes gratuitos y qué vigilar:
   `docs/DESPLIEGUE-VERCEL.md` (sección «Costo cero»). Si configuraste fotos, sube una a una ficha y ábrela una vez: así compruebas el
   almacén privado de Blob.

El modo «Ver como» (sin login) y las rutas `/api/dev/*` solo existen con `npm run inicio` en local.
