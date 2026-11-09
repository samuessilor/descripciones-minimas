/**
 * `npm run admin:inicial -- <usuario> "<Nombre Apellido>"`: crea el PRIMER administrador en una base nueva y muestra su
 * contrasena temporal UNA vez. En produccion no hay registro (`disableSignUp`) ni usuarios de ejemplo: sin este paso
 * nadie puede entrar. Despues, ese admin crea al resto desde Administracion > Usuarios. Idempotente: si ya existe, no
 * cambia nada (para una contrasena nueva, usa «Restablecer contrasena» en su ficha).
 *
 * Usa `DATABASE_URL_UNPOOLED` o `DATABASE_URL` (Neon); sin ninguna, la PGlite local (servidor DETENIDO).
 */
import { eq } from 'drizzle-orm';
import { account, organizacion, usuario } from '../src/db/esquema/identidad';
import { crearConexion } from '../src/db/conexion';
import { correoSinCorreo, normalizarUsuario, validarUsuario } from '../src/dominio/credenciales';
import { generarClave, hashearClave } from '../src/server/claves';
import { cargarConfig } from '../src/server/config';

const ORG_INTERNA = 'EssilorLuxottica';

const [usuarioCrudo, ...partesNombre] = process.argv.slice(2);
const username = normalizarUsuario(usuarioCrudo);
const nombre = partesNombre.join(' ').trim();
const problema = validarUsuario(username);
if (problema || !nombre) {
  console.error(problema ?? 'Falta el nombre.');
  console.error('Uso: npm run admin:inicial -- usuario "Nombre Apellido"');
  process.exit(1);
}

const c = cargarConfig();
const url = c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL;
const conexion = crearConexion({ url, pgliteDir: c.PGLITE_DIR });
try {
  const db = conexion.db;
  const [ya] = await db.select({ id: usuario.id, rol: usuario.rol }).from(usuario).where(eq(usuario.username, username)).limit(1);
  if (ya) {
    console.log(`✔ ${username} ya existe (rol ${ya.rol}); no se cambia nada.`);
  } else {
    let [org] = await db.select().from(organizacion).where(eq(organizacion.nombre, ORG_INTERNA)).limit(1);
    if (!org) [org] = await db.insert(organizacion).values({ nombre: ORG_INTERNA, tipo: 'interna' }).returning();
    const clave = generarClave();
    const hash = await hashearClave(clave);
    const [u] = await db
      .insert(usuario)
      .values({ nombre, username, email: correoSinCorreo(username), organizacionId: org.id, organizacionTipo: org.tipo, rol: 'admin', debeCambiarClave: false })
      .returning({ id: usuario.id });
    await db.insert(account).values({ accountId: u!.id, providerId: 'credential', userId: u!.id, password: hash });
    console.log(`✔ Administrador ${nombre} creado en ${ORG_INTERNA}.`);
    console.log(`  Usuario ........ ${username}`);
    console.log(`  Contraseña ..... ${clave}`);
    console.log('  Cópiala ahora: no se vuelve a mostrar.');
  }
} finally {
  await conexion.cerrar();
}
