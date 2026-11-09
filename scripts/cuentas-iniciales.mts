/**
 * `npm run cuentas:iniciales -- <archivo.json>`: crea de una vez las cuentas acordadas con el area (reunion 2026-10-29):
 *   - administradores (organizacion interna EssilorLuxottica),
 *   - UNA cuenta general por area (Consumibles, Mantenimiento, Instrumentos, Marketing), rol solicitante,
 *   - UNA cuenta general por empresa de aduana (su propia organizacion tipo agencia), rol aduana,
 *   - lectores (opcional).
 * Formato: ver `cuentas.ejemplo.json`. El archivo real lleva correos de la empresa: va FUERA del repositorio.
 *
 * Idempotente: lo que ya existe (correo u organizacion) no se toca. Cambios posteriores (desactivar una agencia,
 * cambiar de proveedor) se hacen en Administracion. Usa `DATABASE_URL_UNPOOLED` o `DATABASE_URL`; sin ninguna, la
 * PGlite local (servidor DETENIDO).
 */
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { organizacion, usuario } from '../src/db/esquema/identidad';
import { crearConexion } from '../src/db/conexion';
import { esArea } from '../src/dominio/areas';
import { cargarConfig } from '../src/server/config';

const ORG_INTERNA = 'EssilorLuxottica';

interface Cuenta {
  correo: string;
  nombre: string;
}
interface Archivo {
  administradores?: Cuenta[];
  areas?: Array<Cuenta & { area: string }>;
  agencias?: Array<Cuenta & { empresa: string }>;
  lectores?: Cuenta[];
}

const ruta = process.argv[2];
if (!ruta) {
  console.error('Uso: npm run cuentas:iniciales -- C:\\ruta\\cuentas.json   (formato: cuentas.ejemplo.json)');
  process.exit(1);
}
const datos = JSON.parse(readFileSync(ruta, 'utf8')) as Archivo;

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const errores: string[] = [];
const revisar = (c: Cuenta, donde: string) => {
  if (!c.correo || !CORREO.test(c.correo.trim())) errores.push(`${donde}: correo invalido «${c.correo ?? ''}»`);
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
  console.error(`El archivo tiene ${errores.length} error(es); no se creo nada:\n  ${errores.join('\n  ')}`);
  process.exit(1);
}

const c = cargarConfig();
const conexion = crearConexion({ url: c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL, pgliteDir: c.PGLITE_DIR });
const db = conexion.db;
let creadas = 0;
let existentes = 0;

async function org(nombre: string, tipo: 'interna' | 'agencia') {
  const [ya] = await db.select().from(organizacion).where(eq(organizacion.nombre, nombre)).limit(1);
  if (ya) return ya;
  const [nueva] = await db.insert(organizacion).values({ nombre, tipo }).returning();
  console.log(`  + organizacion ${nombre} (${tipo})`);
  return nueva;
}

async function cuenta(c: Cuenta, rol: 'admin' | 'solicitante' | 'aduana' | 'lector', o: { id: string; tipo: string }, area: string | null) {
  const email = c.correo.trim().toLowerCase();
  const [ya] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, email)).limit(1);
  if (ya) {
    existentes++;
    console.log(`  = ${email} ya existe; no se cambia`);
    return;
  }
  await db.insert(usuario).values({ nombre: c.nombre.trim(), email, organizacionId: o.id, organizacionTipo: o.tipo, rol, area });
  creadas++;
  console.log(`  + ${rol.padEnd(11)} ${email}${area ? ` (${area})` : ''}`);
}

try {
  const interna = await org(ORG_INTERNA, 'interna');
  for (const a of datos.administradores ?? []) await cuenta(a, 'admin', interna, null);
  for (const a of datos.areas ?? []) await cuenta(a, 'solicitante', interna, a.area);
  for (const l of datos.lectores ?? []) await cuenta(l, 'lector', interna, null);
  for (const g of datos.agencias ?? []) await cuenta(g, 'aduana', await org(g.empresa.trim(), 'agencia'), null);
  console.log(`✔ ${creadas} cuenta(s) creada(s), ${existentes} ya existian. Cada una entra pidiendo su enlace en /entrar.`);
} finally {
  await conexion.cerrar();
}
