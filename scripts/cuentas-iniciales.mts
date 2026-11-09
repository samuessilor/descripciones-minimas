/**
 * `npm run cuentas:iniciales -- <archivo.json> [--salida <claves.txt>]`: crea de una vez las cuentas acordadas con el area
 * (reunion 2026-10-29), cada una con usuario y contrasena temporal:
 *   - administradores (organizacion interna EssilorLuxottica),
 *   - UNA cuenta general por area (Consumibles, Mantenimiento, Instrumentos, Marketing), rol solicitante,
 *   - UNA cuenta general por empresa de aduana (su propia organizacion tipo agencia), rol aduana,
 *   - lectores (opcional).
 * Formato: ver `cuentas.ejemplo.json`. Convencion de usuarios: `<cuenta>.essilorluxottica` (areas), `administrador.<nombre>`
 * y `<empresa>.aduana`. La contrasena INICIAL es `clave` si el archivo la trae; si no, una ALEATORIA (XXXX-XXXX-XXXX) que se escribe en el archivo de salida (nunca una
 * contrasena predecible: el repositorio puede ser publico). Es una clave de entrega: cada cuenta queda marcada para cambiarla en su primer ingreso y no puede usar
 * nada mas hasta hacerlo.
 *
 * La lista usuario/contrasena sale en consola o en el archivo de `--salida` (FUERA del repositorio); en la base solo queda el
 * hash. Con esa lista el implementador entrega usuario y contrasena a quien corresponda.
 *
 * Idempotente: lo que ya existe (usuario u organizacion) no se toca ni recibe contrasena nueva. Cambios posteriores
 * (restablecer una contrasena, desactivar una agencia) se hacen en Administracion. Usa `DATABASE_URL_UNPOOLED` o
 * `DATABASE_URL`; sin ninguna, la PGlite local (servidor DETENIDO).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { account, organizacion, usuario } from '../src/db/esquema/identidad';
import { crearConexion } from '../src/db/conexion';
import { esArea } from '../src/dominio/areas';
import { correoSinCorreo, normalizarUsuario, validarUsuario } from '../src/dominio/credenciales';
import { generarClave, hashearClave } from '../src/server/claves';
import { cargarConfig } from '../src/server/config';

const ORG_INTERNA = 'EssilorLuxottica';

interface Cuenta {
  usuario: string;
  nombre: string;
  /** Contrasena inicial; si falta, se genera una aleatoria. */
  clave?: string;
  /** Solo en las cuentas de area: quien las lleva hoy. La cuenta sigue siendo del area. */
  encargado?: string;
}
interface Archivo {
  administradores?: Cuenta[];
  areas?: Array<Cuenta & { area: string }>;
  agencias?: Array<Cuenta & { empresa: string }>;
  lectores?: Cuenta[];
}

const args = process.argv.slice(2);
const ruta = args.find((a) => !a.startsWith('--'));
const iSalida = args.indexOf('--salida');
const salida = iSalida >= 0 ? args[iSalida + 1] : undefined;
if (!ruta) {
  console.error('Uso: npm run cuentas:iniciales -- C:\\ruta\\cuentas.json [--salida C:\\ruta\\claves.txt]   (formato: cuentas.ejemplo.json)');
  process.exit(1);
}
if (salida) {
  const raiz = resolve(import.meta.dirname, '..');
  const rel = relative(raiz, resolve(salida));
  if (!rel.startsWith('..') && !resolve(salida).includes('node_modules')) {
    console.error(`El archivo de contraseñas (${salida}) quedaría dentro del repositorio. Elige una ruta fuera de ${raiz}.`);
    process.exit(1);
  }
}
const datos = JSON.parse(readFileSync(ruta, 'utf8')) as Archivo;

const errores: string[] = [];
const vistos = new Set<string>();
const revisar = (c: Cuenta, donde: string) => {
  const u = normalizarUsuario(c.usuario);
  const p = validarUsuario(u);
  if (p) errores.push(`${donde}: usuario «${c.usuario ?? ''}» no es válido. ${p}`);
  if (vistos.has(u)) errores.push(`${donde}: el usuario «${u}» está repetido en el archivo`);
  vistos.add(u);
  if (!c.nombre?.trim()) errores.push(`${donde}: falta el nombre`);
};
(datos.administradores ?? []).forEach((c, i) => revisar(c, `administradores[${i}]`));
(datos.lectores ?? []).forEach((c, i) => revisar(c, `lectores[${i}]`));
(datos.areas ?? []).forEach((c, i) => {
  revisar(c, `areas[${i}]`);
  if (!esArea(c.area)) errores.push(`areas[${i}]: area «${c.area}» no es Consumibles, Mantenimiento, Instrumentos ni Marketing`);
});
(datos.agencias ?? []).forEach((c, i) => {
  revisar(c, `agencias[${i}]`);
  if (!c.empresa?.trim()) errores.push(`agencias[${i}]: falta la empresa`);
});
if (errores.length) {
  console.error(`El archivo tiene ${errores.length} error(es); no se creó nada:\n  ${errores.join('\n  ')}`);
  process.exit(1);
}

const c = cargarConfig();
const conexion = crearConexion({ url: c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL, pgliteDir: c.PGLITE_DIR });
const db = conexion.db;
let creadas = 0;
let existentes = 0;
const entregables: string[] = [];

async function org(nombre: string, tipo: 'interna' | 'agencia') {
  const [ya] = await db.select().from(organizacion).where(eq(organizacion.nombre, nombre)).limit(1);
  if (ya) return ya;
  const [nueva] = await db.insert(organizacion).values({ nombre, tipo }).returning();
  console.log(`  + organizacion ${nombre} (${tipo})`);
  return nueva!;
}

async function cuenta(cu: Cuenta, rol: 'admin' | 'solicitante' | 'aduana' | 'lector', o: { id: string; tipo: string }, area: string | null) {
  const username = normalizarUsuario(cu.usuario);
  const [ya] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.username, username)).limit(1);
  if (ya) {
    existentes++;
    console.log(`  = ${username} ya existe; no se cambia`);
    return;
  }
  const clave = cu.clave ?? generarClave();
  const hash = await hashearClave(clave);
  const [u] = await db
    .insert(usuario)
    .values({ nombre: cu.nombre.trim(), username, email: correoSinCorreo(username), organizacionId: o.id, organizacionTipo: o.tipo, rol, area, encargado: cu.encargado?.trim() || null, debeCambiarClave: true })
    .returning({ id: usuario.id });
  await db.insert(account).values({ accountId: u!.id, providerId: 'credential', userId: u!.id, password: hash });
  creadas++;
  entregables.push(`${username.padEnd(22)} ${clave}   ${rol}${area ? ` · ${area}` : ''} · ${cu.nombre.trim()}`);
  console.log(`  + ${rol.padEnd(11)} ${username}${area ? ` (${area})` : ''}`);
}

try {
  const interna = await org(ORG_INTERNA, 'interna');
  for (const a of datos.administradores ?? []) await cuenta(a, 'admin', interna, null);
  for (const a of datos.areas ?? []) await cuenta(a, 'solicitante', interna, a.area);
  for (const l of datos.lectores ?? []) await cuenta(l, 'lector', interna, null);
  for (const g of datos.agencias ?? []) await cuenta(g, 'aduana', await org(g.empresa.trim(), 'agencia'), null);
  console.log(`✔ ${creadas} cuenta(s) creada(s), ${existentes} ya existian.`);
  if (entregables.length > 0) {
    const cuerpo = ['USUARIO                CONTRASEÑA        CUENTA', ...entregables].join('\n');
    if (salida) {
      writeFileSync(salida, `${cuerpo}\n`, { encoding: 'utf8' });
      console.log(`  Usuarios y contraseñas iniciales guardados en ${salida}. Entrégalos y bórralo después: la base solo guarda su hash.`);
    } else {
      console.log(`\n${cuerpo}\n\nCada cuenta debe cambiar su contraseña en el primer ingreso. Entrega la lista y bórrala.`);
    }
  }
} finally {
  await conexion.cerrar();
}
