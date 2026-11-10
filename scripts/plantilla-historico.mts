/**
 * `npm run plantilla:historico -- [salida.xlsx] [--desde-bd]`: crea el Excel para cargar el historico (hoja de instrucciones,
 * hoja `Referencias` con listas desplegables y hoja `Listas`). Por defecto lo deja en `..\datos\plantilla-historico.xlsx`
 * (fuera del repositorio). Con --desde-bd las listas de unidad y aspecto salen del catalogo vivo de la base configurada;
 * sin ella, de los valores iniciales.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { crearConexion } from '../src/db/conexion';
import { ASPECTOS_FISICOS, UNIDADES_MEDIDA } from '../src/db/semillas/datos-maestros';
import { cargarConfig } from '../src/server/config';
import { listasDeCatalogos } from '../src/server/importar/historico';
import { crearPlantilla } from '../src/server/importar/plantilla';

const args = process.argv.slice(2);
const raiz = resolve(import.meta.dirname, '..');
const salida = resolve(args.find((a) => !a.startsWith('--')) ?? resolve(raiz, '..', 'datos', 'plantilla-historico.xlsx'));
const rel = relative(raiz, salida);
if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) {
  console.error(`${salida} quedaría dentro del repositorio (${raiz}). Elige una ruta fuera de él.`);
  process.exit(1);
}

let unidades: readonly string[] = UNIDADES_MEDIDA;
let aspectos: readonly string[] = ASPECTOS_FISICOS;
if (args.includes('--desde-bd')) {
  const c = cargarConfig();
  const conexion = crearConexion({ url: c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL, pgliteDir: c.PGLITE_DIR });
  try {
    const l = await listasDeCatalogos(conexion.db);
    if (l.unidad_medida.length > 0) unidades = l.unidad_medida;
    if (l.aspecto_fisico.length > 0) aspectos = l.aspecto_fisico;
  } finally {
    await conexion.cerrar();
  }
}

mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, await crearPlantilla({ unidades, aspectos }));
console.log(`✔ Plantilla en ${salida}`);
