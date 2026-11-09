/**
 * `npm run setup`: deja el entorno LOCAL listo sin credenciales externas (SPEC 12.2).
 *  - comprueba la version de Node;
 *  - crea `.data/` y `.data/uploads/` (PGlite NO crea directorios padre, 22.5);
 *  - genera `.env.local` con secretos aleatorios si no existe (nunca sobrescribe uno existente).
 * No instala nada global. Dependencias: `npm ci` antes de este comando.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '..');
const secreto = () => randomBytes(32).toString('base64url');

const mayor = Number(process.versions.node.split('.')[0]);
if (mayor < 24) {
  console.error(`Se requiere Node 24 o superior (tienes ${process.versions.node}). Ver .nvmrc.`);
  process.exit(1);
}

for (const dir of ['.data', '.data/uploads']) {
  mkdirSync(resolve(raiz, dir), { recursive: true });
}
console.log('✔ Carpetas .data/ y .data/uploads/ listas');

const archivo = resolve(raiz, '.env.local');
if (existsSync(archivo)) {
  const actual = readFileSync(archivo, 'utf8');
  const faltan = ['BETTER_AUTH_SECRET'].filter((k) => !new RegExp(`^${k}=.+`, 'm').test(actual));
  if (faltan.length === 0) {
    console.log('✔ .env.local ya existe y tiene los secretos (no se toca)');
  } else {
    const extra = faltan.map((k) => `${k}=${secreto()}`).join('\n');
    writeFileSync(archivo, `${actual.trimEnd()}\n${extra}\n`);
    console.log(`✔ .env.local existente: se agregaron ${faltan.join(', ')}`);
  }
} else {
  writeFileSync(
    archivo,
    [
      '# Generado por `npm run setup`. NO se versiona. Todo funciona en local sin credenciales externas.',
      'NODE_ENV=development',
      `APP_URL=${process.env.APP_URL || 'http://localhost:3000'}`,
      `BETTER_AUTH_SECRET=${secreto()}`,
      '# DATABASE_URL vacia => PGlite en .data/pglite (un solo proceso: solo el servidor abre la base).',
      'DATABASE_URL=',
      'ALMACEN=local',
      '',
    ].join('\n'),
  );
  console.log('✔ .env.local creado con secretos nuevos');
}

console.log(`
Listo. Siguientes pasos:
  npm run inicio     TODO en uno: setup + servidor + navegador (usa un puerto libre y alinea APP_URL)
  npm run dev        solo el servidor; migra y siembra la base local solo (http://localhost:3000)
  Cuentas de desarrollo (contraseña de ejemplo: desarrollo-2026): admin, consumibles, mantenimiento, instrumentos,
                          marketing, aduana-a, aduana-b, lector, solicitante, solicitante2
  Con npm run inicio entras sin escribir nada y cambias de cuenta desde el menú de arriba a la derecha.
  Si el puerto 3000 esta ocupado usa npm run inicio o alinea APP_URL (ver README).
`);
