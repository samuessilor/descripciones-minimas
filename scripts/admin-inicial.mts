/**
 * `npm run admin:inicial -- <correo> "<Nombre Apellido>"`: crea el PRIMER administrador en una base nueva.
 * En produccion no hay registro (`disableSignUp`) ni usuarios de ejemplo: sin este paso nadie puede entrar.
 * Despues, ese admin crea al resto desde Administracion > Usuarios. Idempotente: si ya existe, no cambia nada.
 *
 * Usa `DATABASE_URL_UNPOOLED` o `DATABASE_URL` (Neon); sin ninguna, la PGlite local (servidor DETENIDO).
 */
import { eq } from 'drizzle-orm';
import { organizacion, usuario } from '../src/db/esquema/identidad';
import { crearConexion } from '../src/db/conexion';
import { cargarConfig } from '../src/server/config';

const ORG_INTERNA = 'EssilorLuxottica';

const [correoCrudo, ...partesNombre] = process.argv.slice(2);
const email = correoCrudo?.trim().toLowerCase();
const nombre = partesNombre.join(' ').trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nombre) {
  console.error('Uso: npm run admin:inicial -- correo@empresa.com "Nombre Apellido"');
  process.exit(1);
}

const c = cargarConfig();
const url = c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL;
const conexion = crearConexion({ url, pgliteDir: c.PGLITE_DIR });
try {
  const db = conexion.db;
  const [ya] = await db.select({ id: usuario.id, rol: usuario.rol }).from(usuario).where(eq(usuario.email, email)).limit(1);
  if (ya) {
    console.log(`✔ ${email} ya existe (rol ${ya.rol}); no se cambia nada.`);
  } else {
    let [org] = await db.select().from(organizacion).where(eq(organizacion.nombre, ORG_INTERNA)).limit(1);
    if (!org) [org] = await db.insert(organizacion).values({ nombre: ORG_INTERNA, tipo: 'interna' }).returning();
    await db.insert(usuario).values({ nombre, email, organizacionId: org.id, organizacionTipo: org.tipo, rol: 'admin' });
    console.log(`✔ Administrador ${nombre} <${email}> creado en ${ORG_INTERNA}. Ya puede pedir su enlace en /entrar.`);
  }
} finally {
  await conexion.cerrar();
}
