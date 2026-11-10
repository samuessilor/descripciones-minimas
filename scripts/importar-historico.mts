/**
 * `npm run importar:historico -- <archivo.xlsx> [--aplicar] [--omitir-errores] [--informe <informe.xlsx>]`
 *
 * Carga al sistema las referencias que se cerraron ANTES de la plataforma (Excel con la plantilla de
 * `npm run plantilla:historico`). Entran como «Clasificadas», con los mismos datos y reglas de la ficha.
 *
 *   sin --aplicar     PRUEBA EN SECO: lee, valida y escribe el informe; no toca la base. Se corre las veces que haga falta.
 *   --aplicar         carga las filas validas. Si hay filas con errores NO carga nada, salvo con --omitir-errores.
 *   --informe <ruta>  donde guardar el informe (por defecto, junto al archivo: «<archivo>-informe.xlsx»).
 *
 * Idempotente: lo que ya esta en la plataforma se omite (nunca se sobrescribe), asi que despues de corregir el Excel se puede
 * volver a correr con el mismo archivo. Usa `DATABASE_URL_UNPOOLED` o `DATABASE_URL` (la de Neon, desde `datos\\desplegar-bd.ps1`
 * con el portapapeles, o la que se defina en la consola); sin ninguna, la PGlite local (con el servidor DETENIDO).
 * El archivo y el informe llevan datos de la empresa: deben quedar FUERA del repositorio.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { crearConexion } from '../src/db/conexion';
import { cargarConfig } from '../src/server/config';
import { aplicarImportacion, planificarImportacion } from '../src/server/importar/historico';
import { crearInforme, resumenEnTexto } from '../src/server/importar/informe';
import { leerLibro } from '../src/server/importar/leer-libro';

const args = process.argv.slice(2);
const valorDe = (bandera: string): string | undefined => {
  const i = args.indexOf(bandera);
  return i >= 0 ? args[i + 1] : undefined;
};
const aplicar = args.includes('--aplicar');
const omitirErrores = args.includes('--omitir-errores');
const archivo = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--informe');
if (!archivo) {
  console.error('Uso: npm run importar:historico -- C:\\ruta\\historico.xlsx [--aplicar] [--omitir-errores] [--informe C:\\ruta\\informe.xlsx]');
  process.exit(1);
}
const ruta = resolve(archivo);
if (!existsSync(ruta)) {
  console.error(`No encuentro el archivo ${ruta}.`);
  process.exit(1);
}
const informe = resolve(valorDe('--informe') ?? join(dirname(ruta), `${basename(ruta, extname(ruta))}-informe.xlsx`));

const raiz = resolve(import.meta.dirname, '..');
for (const p of [ruta, informe]) {
  const rel = relative(raiz, p);
  // Dentro del repositorio = una ruta relativa que no sube de nivel (otra unidad de disco da una ruta absoluta: fuera).
  const dentro = !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  if (dentro) {
    console.error(`${p} quedaría dentro del repositorio (${raiz}). Usa una ruta fuera de él: lleva datos de la empresa.`);
    process.exit(1);
  }
}

const c = cargarConfig();
const url = c.DATABASE_URL_UNPOOLED ?? c.DATABASE_URL;
const conexion = crearConexion({ url, pgliteDir: c.PGLITE_DIR });
let destino = `PGlite local (${c.PGLITE_DIR})`;
if (url) {
  try {
    destino = `${conexion.tipo} · ${new URL(url).host}`;
  } catch {
    destino = conexion.tipo;
  }
}

try {
  console.log(`Base: ${destino}`);
  console.log(`Archivo: ${ruta}`);
  const lectura = await leerLibro(ruta);
  if (lectura.columnasFaltantes.length > 0) {
    console.error(`Al archivo le faltan columnas indispensables: ${lectura.columnasFaltantes.join(', ')}. Usa la hoja «Referencias» de la plantilla.`);
    process.exitCode = 1;
  } else {
    const plan = await planificarImportacion(conexion.db, lectura.filas);
    console.log(['', ...resumenEnTexto(plan, lectura)].join('\n'));
    if (plan.valoresDesconocidos.length > 0) {
      console.log('\nValores de lista que la plataforma no tiene (agrégalos en Administración › Catálogos si son reales):');
      for (const v of plan.valoresDesconocidos.slice(0, 20)) console.log(`  ${v.catalogo === 'unidad_medida' ? 'Unidad' : 'Aspecto'} «${v.valor}» · ${v.filas} fila(s)`);
    }
    if (plan.rechazadas.length > 0) {
      console.log('\nPrimeras filas con errores (todas están en el informe):');
      for (const r of plan.rechazadas.slice(0, 10)) console.log(`  fila ${r.fila}${r.codigo ? ` (${r.codigo})` : ''}: ${r.errores[0]}${r.errores.length > 1 ? ` (+${r.errores.length - 1})` : ''}`);
    }

    let cargada = false;
    if (aplicar) {
      if (plan.rechazadas.length > 0 && !omitirErrores) {
        console.error(`\nNo se cargó nada: hay ${plan.rechazadas.length} fila(s) con errores. Corrígelas y vuelve a correr, o usa --omitir-errores para cargar solo las válidas.`);
        process.exitCode = 1;
      } else if (plan.validas.length === 0) {
        console.log('\nNo hay filas nuevas para cargar.');
      } else {
        console.log(`\nCargando ${plan.validas.length} referencia(s) en ${destino}…`);
        try {
          const r = await aplicarImportacion(conexion.db, plan, {
            archivo: basename(ruta),
            alAvanzar: (hechas, total) => {
              if (hechas === total || hechas % 400 === 0) console.log(`  ${hechas}/${total}`);
            },
          });
          cargada = true;
          console.log(`✔ ${r.creadas} referencia(s) cargada(s) como Clasificadas, ${r.partidasCreadas} partida(s) nueva(s) en el catálogo, ${r.omitidas} fila(s) omitida(s).`);
          if (r.saltadasPorConflicto > 0) console.log(`  ${r.saltadasPorConflicto} se saltaron porque su código se creó a mano mientras tanto.`);
        } catch (err) {
          // Cada lote es una transaccion: lo ya confirmado queda (con su auditoria) y lo demas no. Repetir el mismo comando continua.
          cargada = true;
          console.error(`\nLa carga se interrumpió: ${err instanceof Error ? err.message : String(err)}`);
          console.error('Lo que ya se confirmó quedó guardado; los lotes pendientes no. Vuelve a correr el mismo comando: continúa donde quedó.');
          process.exitCode = 1;
        }
      }
    } else {
      console.log('\nPrueba en seco: no se escribió nada. Para cargar, vuelve a correrlo con --aplicar.');
    }
    writeFileSync(informe, await crearInforme(plan, lectura, cargada));
    console.log(`Informe: ${informe}`);
  }
} finally {
  await conexion.cerrar();
}
