/**
 * P-06 / CA-25: el Excel se relee con exceljs y se compara con los datos sembrados. Sin formulas, `=1+1` como texto,
 * tildes y saltos de linea intactos, codigo y partida como texto, archivadas solo con la casilla, aislamiento de
 * agencias, filtros, auditoria, limite de uso y reautenticacion de externos.
 */
import { and, eq } from 'drizzle-orm';
import type ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, limiteTasa } from '@/db/esquema';
import { archivar, finalizar } from '@/server/acciones/aduana';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { COLUMNAS_BASE } from '@/server/exportar/columnas';
import { contarExportable, exportarBase, nombreDeArchivo } from '@/server/exportar';
import { asignarAAduana, nuevoEscenario, type Escenario } from './ayudas';
import { abrirLibro, escribir, fichaEnAduana } from './ayudas-aduana';

let e: Escenario;
let pendiente: string;
let clasificada: string;
let archivada: string;
let deB: string;

const AHORA = new Date('2026-10-21T20:30:00Z'); // 15:30 en Bogota

beforeAll(async () => {
  e = await nuevoEscenario();

  // 1) Pendiente, con formulas "maliciosas" y texto con tildes y saltos de linea.
  pendiente = await fichaEnAduana(e, { llena: true, codigo: '00123-AB', nombre: '=1+1' });
  await escribir(e, e.edward, pendiente, 'materia_constitutiva', 'Línea uno con ñandú\nLínea dos');
  await escribir(e, e.edward, pendiente, 'uso', '@SUM(A1:A9)');
  await escribir(e, e.edward, pendiente, 'proveedor', '+cmd|calc');
  await escribir(e, e.edward, pendiente, 'tipo_empaque', '-2+3');
  await escribir(e, e.edward, pendiente, 'requiere_rim', 'SI');
  await escribir(e, e.edward, pendiente, 'cantidad_rim', '13x12');
  await fijarPartida(e.ctx(e.brian), { referenciaId: pendiente, partida: '8479.90.00.00', versionEsperada: 0 });
  await escribir(e, e.brian, pendiente, 'descripciones_minimas', 'Producto: bomba de vacío\nDestino: mesa de deposición\n=Lote: 42');

  // 2) Clasificada.
  clasificada = await fichaEnAduana(e, { llena: true, codigo: 'TEST-CLAS-1', nombre: 'Producto clasificado' });
  await fijarPartida(e.ctx(e.brian), { referenciaId: clasificada, partida: '8421.39.90.00', versionEsperada: 0 });
  await escribir(e, e.edward, clasificada, 'proveedor', { mismo_fabricante: true });
  await escribir(e, e.brian, clasificada, 'descripciones_minimas', 'Producto: filtro de aire\nTipo de filtro: coalescente');
  await escribir(e, e.edward, clasificada, 'respuesta_area', 'Es coalescente de 5 micras.');
  await finalizar(e.ctx(e.brian, AHORA), { referenciaId: clasificada, motivoCerrarDeTodosModos: 'Prueba.' });

  // 3) Archivada.
  archivada = await fichaEnAduana(e, { codigo: 'TEST-ARCH-X', nombre: 'Archivada' });
  await archivar(e.ctx(e.admin), { referenciaId: archivada, motivo: 'Prueba.' });

  // 4) De la agencia B.
  const r = await crearReferencia(e.ctx(e.edward), { codigo: 'TEST-B-1', nombreProducto: 'Solo de la agencia B', tipoProducto: 'REPUESTO' });
  deB = r.id;
  await asignarAAduana(e, deB, e.brianB);
});
afterAll(async () => {
  await e.c.cerrar();
});

async function descargar(actor = e.admin, entrada: Parameters<typeof exportarBase>[1] = { alcance: 'toda' }, ahora = AHORA) {
  // El limite de 5 por hora es una regla del producto; se prueba aparte. Aqui se reinicia para poder comparar contenido.
  await e.db.delete(limiteTasa);
  const r = await exportarBase(e.ctx(actor, ahora), entrada);
  const libro = await abrirLibro(r.flujo);
  return { libro, r };
}

function filas(hoja: ExcelJS.Worksheet): ExcelJS.Row[] {
  const out: ExcelJS.Row[] = [];
  hoja.eachRow((row, n) => {
    if (n > 1) out.push(row);
  });
  return out;
}
const col = (clave: string) => COLUMNAS_BASE.findIndex((c) => c.clave === clave) + 1;
const filaDe = (hoja: ExcelJS.Worksheet, codigo: string) => filas(hoja).find((f) => f.getCell(1).text === codigo);

async function fallo(p: Promise<unknown>): Promise<ErrorAccion> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err;
    throw err;
  }
  throw new Error('se esperaba un ErrorAccion');
}

describe('estructura del libro (P-06)', () => {
  it('nombre de archivo con la fecha de Bogota, dos hojas y encabezados legibles', async () => {
    const { libro, r } = await descargar();
    expect(r.nombreArchivo).toBe('descripciones-minimas_20261021_1530.xlsx');
    expect(nombreDeArchivo(AHORA)).toBe(r.nombreArchivo);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Base', 'Leyenda']);

    const base = libro.getWorksheet('Base')!;
    const encabezados = (base.getRow(1).values as string[]).slice(1);
    expect(encabezados).toHaveLength(COLUMNAS_BASE.length);
    expect(encabezados.slice(0, 6)).toEqual(['Código', 'Nombre del producto', 'Tipo de producto', 'Área responsable', 'Estado', 'Etiqueta de estado']);
    expect(encabezados).toEqual(
      expect.arrayContaining(['Partida arancelaria final', 'Restricciones', 'Descripciones mínimas adicionales', 'Respuesta del área', 'Requiere RIM', 'Días en gestión', 'Producto: última edición por']),
    );
    expect(encabezados).not.toContain('Primer clasificador');
    expect(encabezados).not.toContain('Valor unitario (USD)');
    // Las columnas del SPEC 15.1 con los cambios de la reunion (sin valor, cantidad a radicar ni clasificadores; con el area
    // responsable) mas la autoria por seccion (6).
    expect(COLUMNAS_BASE.length).toBe(41);
  });

  it('congela la fila 1 y la primera columna, y deja autofiltro sobre todos los encabezados', async () => {
    const { libro } = await descargar();
    const base = libro.getWorksheet('Base')!;
    expect(base.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    const af = base.autoFilter as unknown as { from: { row: number; column: number }; to: { row: number; column: number } } | string;
    if (typeof af === 'string') expect(af).toMatch(/^A1:/);
    else expect(af.to.column).toBe(COLUMNAS_BASE.length);
    expect(base.getColumn(1).width).toBeGreaterThan(10);
  });

  it('una fila por referencia visible; las archivadas solo con la casilla', async () => {
    const sin = await descargar(e.admin, { alcance: 'toda' });
    const codigos = filas(sin.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text);
    expect(codigos.sort()).toEqual(['00123-AB', 'TEST-B-1', 'TEST-CLAS-1']);
    expect(sin.r.filas).toBe(3);

    const con = await descargar(e.admin, { alcance: 'toda', incluirArchivadas: true });
    const fa = filaDe(con.libro.getWorksheet('Base')!, 'TEST-ARCH-X')!;
    expect(fa.getCell(col('estado')).text).toBe('Archivada');
    expect((fa.getCell(col('estado')).fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb).toBeUndefined(); // "sin color propio"
  });
});

describe('contenido', () => {
  it('estado con color Y texto; dias congelados en la clasificada', async () => {
    const { libro } = await descargar();
    const base = libro.getWorksheet('Base')!;
    const p = filaDe(base, '00123-AB')!;
    const c = filaDe(base, 'TEST-CLAS-1')!;
    expect(p.getCell(col('estado')).text).toBe('Pendiente');
    expect((p.getCell(col('estado')).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFFFFFA6');
    expect(c.getCell(col('estado')).text).toBe('Clasificada');
    expect((c.getCell(col('estado')).fill as ExcelJS.FillPattern).fgColor?.argb).toBe('FFC6EFCE');
    expect(c.getCell(col('etiqueta')).text).toBe('Clasificada');
    expect(c.getCell(col('finalizada')).text).toBe('SÍ');
    expect(typeof c.getCell(col('dias')).value).toBe('number');
  });

  it('fechas reales, numeros reales, partida y codigo como texto, tildes y saltos de linea intactos', async () => {
    const { libro } = await descargar();
    const p = filaDe(libro.getWorksheet('Base')!, '00123-AB')!;
    expect(p.getCell(col('fecha_solicitud')).value).toBeInstanceOf(Date);
    expect(p.getCell(col('actualizada')).value).toBeInstanceOf(Date);
    expect(p.getCell(col('requiere_rim')).text).toBe('Sí');
    expect(p.getCell(col('cantidad_rim')).value).toBe(156);
    expect(p.getCell(1).value).toBe('00123-AB'); // texto, con ceros a la izquierda
    // La partida de trabajo de una pendiente no sale (L1: solo la final, como el listado); la clasificada la trae como texto.
    expect(p.getCell(col('partida')).value).toBeNull();
    const c = filaDe(libro.getWorksheet('Base')!, 'TEST-CLAS-1')!;
    expect(c.getCell(col('partida')).value).toBe('8421.39.90.00');
    expect(c.getCell(col('partida')).numFmt).toBe('@');
    expect(p.getCell(col('materia_constitutiva')).value).toBe('Línea uno con ñandú\nLínea dos');
    expect(p.getCell(col('pais_origen')).text).toBe('Francia');
    expect(p.getCell(col('tipo')).text).toBe('Insumo');
  });

  it('ninguna celda es formula y los textos que empiezan con = + - @ quedan como texto', async () => {
    const { libro } = await descargar();
    let celdas = 0;
    libro.eachSheet((hoja) =>
      hoja.eachRow((fila) =>
        fila.eachCell((celda) => {
          celdas += 1;
          expect(celda.type, `${hoja.name}!${celda.address}`).not.toBe(6 /* Formula */);
          expect(celda.formula).toBeUndefined();
        }),
      ),
    );
    expect(celdas).toBeGreaterThan(100);

    const p = filaDe(libro.getWorksheet('Base')!, '00123-AB')!;
    for (const [clave, valor] of [['nombre', '=1+1'], ['uso', '@SUM(A1:A9)'], ['proveedor', '+cmd|calc'], ['tipo_empaque', '-2+3']] as const) {
      const c = p.getCell(col(clave));
      expect(c.value, clave).toBe(valor);
      expect(typeof c.value).toBe('string');
      expect(c.numFmt, clave).toBe('@');
    }
  });

  it('descripciones minimas: una columna de texto entre la partida y las restricciones, como en el F-ADI-30', async () => {
    const { libro } = await descargar();
    const base = libro.getWorksheet('Base')!;
    const encabezados = (base.getRow(1).values as string[]).slice(1);
    const enPartida = encabezados.indexOf('Partida arancelaria final');
    expect(encabezados.slice(enPartida, enPartida + 4)).toEqual(['Partida arancelaria final','Descripciones mínimas adicionales', 'Respuesta del área', 'Restricciones']);

    const p = filaDe(base, '00123-AB')!;
    const celda = p.getCell(col('descripciones_minimas'));
    expect(celda.value).toBe('Producto: bomba de vacío\nDestino: mesa de deposición\n=Lote: 42'); // saltos de linea intactos
    expect(celda.type).not.toBe(6 /* Formula */);
    expect(filaDe(base, 'TEST-CLAS-1')!.getCell(col('descripciones_minimas')).text).toBe('Producto: filtro de aire\nTipo de filtro: coalescente');
    expect(filaDe(base, 'TEST-B-1')!.getCell(col('descripciones_minimas')).value).toBeNull();
  });
  it('autor y fecha de la ultima edicion por seccion', async () => {
    const { libro } = await descargar();
    const p = filaDe(libro.getWorksheet('Base')!, '00123-AB')!;
    expect(p.getCell(col('producto_por')).text).toBe('Edward');
    expect(p.getCell(col('detalle_por')).text).toBe('Edward');
    // Brian escribio la partida y las descripciones minimas despues: Especificaciones es suya.
    expect(p.getCell(col('especificaciones_por')).text).toBe('Brian');
    expect(p.getCell(col('especificaciones_en')).value).toBeInstanceOf(Date);
  });

  it('pendiente con: quien tiene la ficha abierta', async () => {
    const { libro } = await descargar();
    const p = filaDe(libro.getWorksheet('Base')!, '00123-AB')!;
    expect(p.getCell(col('pendiente_con')).text).toContain('Brian');
  });

  it('la clasificada trae partida, restriccion, respuesta del area, proveedor vinculado y fecha de clasificacion en hora de Bogota', async () => {
    const { libro } = await descargar();
    const c = filaDe(libro.getWorksheet('Base')!, 'TEST-CLAS-1')!;
    expect(c.getCell(col('partida')).value).toBe('8421.39.90.00');
    expect(c.getCell(col('restricciones')).text).toContain('Sin Restricciones');
    expect(c.getCell(col('respuesta_area')).text).toBe('Es coalescente de 5 micras.');
    // «El proveedor es el mismo fabricante» sale con el nombre del fabricante.
    expect(c.getCell(col('proveedor')).text).toBe(c.getCell(col('fabricante')).text);
    expect(c.getCell(col('proveedor')).text).not.toBe('');
    // Sin RIM: la cantidad no aplica y queda en blanco.
    expect(c.getCell(col('requiere_rim')).text).toBe('No');
    expect(c.getCell(col('cantidad_rim')).value).toBeNull();
    expect((c.getCell(col('fecha_clasificacion')).value as Date).toISOString().slice(0, 10)).toBe('2026-10-21');
  });

  it('la leyenda dice quien, cuando, el alcance y el significado de los colores', async () => {
    const { libro } = await descargar();
    const ley = libro.getWorksheet('Leyenda')!;
    const textos: string[] = [];
    ley.eachRow((f) => textos.push(`${f.getCell(1).text} ${f.getCell(2).text}`));
    const todo = textos.join('\n');
    expect(todo).toContain('Ana Admin (admin)');
    expect(todo).toContain('2026-10-21 15:30');
    expect(todo).toContain('Referencias exportadas 3');
    expect(todo).toContain('Pendiente');
    expect(todo).toContain('Clasificada');
  });
});

describe('visibilidad y filtros', () => {
  it('una agencia exporta solo lo que ve; otra agencia no recibe fichas ajenas', async () => {
    const a = await descargar(e.brian, { alcance: 'toda' });
    expect(filas(a.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text).sort()).toEqual(['00123-AB', 'TEST-CLAS-1']);
    const b = await descargar(e.brianB, { alcance: 'toda' });
    expect(filas(b.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['TEST-B-1']);
  });

  it('la agencia ve su gente por nombre y la ajena como "Otra agencia"', async () => {
    const { libro } = await descargar(e.brianB, { alcance: 'toda' });
    const fila = filaDe(libro.getWorksheet('Base')!, 'TEST-B-1')!;
    expect(fila.getCell(col('creada_por')).text).toBe('Edward'); // interno: con nombre
    expect(fila.getCell(col('pendiente_con')).text).toBe('Brenda');
  });

  it('el acceso de 30 dias vencido saca la ficha del Excel de la agencia', async () => {
    const tarde = new Date(AHORA.getTime() + 31 * 86_400_000);
    const { libro } = await descargar(e.brian, { alcance: 'toda' }, tarde);
    expect(filas(libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['00123-AB']);
  });

  it('"lo que veo" aplica los filtros de la lista; "toda" los ignora', async () => {
    const verdes = await descargar(e.admin, { alcance: 'filtrado', filtros: { estado: 'verdes' } });
    expect(filas(verdes.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['TEST-CLAS-1']);
    const amarillas = await descargar(e.admin, { alcance: 'filtrado', filtros: { estado: 'amarillas', tipo: 'INSUMO' } });
    expect(filas(amarillas.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['00123-AB']);
    const texto = await descargar(e.admin, { alcance: 'filtrado', filtros: { q: 'producto clasificado' } });
    expect(filas(texto.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['TEST-CLAS-1']);
    const toda = await descargar(e.admin, { alcance: 'toda', filtros: { estado: 'verdes' } });
    expect(toda.r.filas).toBe(3);

    const ley = verdes.libro.getWorksheet('Leyenda')!;
    const t: string[] = [];
    ley.eachRow((f) => t.push(f.getCell(2).text));
    expect(t.join('|')).toContain('Estado: Clasificadas');
  });

  it('el filtro de partida del listado tambien filtra el Excel (L3), con o sin puntos', async () => {
    const conPuntos = await descargar(e.admin, { alcance: 'filtrado', filtros: { partida: '8421.39' } });
    expect(filas(conPuntos.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['TEST-CLAS-1']);
    const sinPuntos = await descargar(e.admin, { alcance: 'filtrado', filtros: { partida: '8479' } });
    expect(filas(sinPuntos.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['00123-AB']);
    expect(await contarExportable(e.ctx(e.admin, AHORA), { partida: '8421' })).toEqual({ filtrado: 1, toda: 3 });
  });

  it('un comodin en la busqueda es texto, no "todo"', async () => {
    const { r } = await descargar(e.admin, { alcance: 'filtrado', filtros: { q: '%' } });
    expect(r.filas).toBe(0);
  });

  it('cuenta lo que saldria con y sin filtros', async () => {
    expect(await contarExportable(e.ctx(e.admin, AHORA), { estado: 'verdes' })).toEqual({ filtrado: 1, toda: 3 });
    expect(await contarExportable(e.ctx(e.brianB, AHORA), undefined)).toEqual({ filtrado: 1, toda: 1 });
  });

  it('pendientes de una persona y sin responsable', async () => {
    const deBrian = await descargar(e.brian, { alcance: 'filtrado', filtros: { mias: true } });
    expect(filas(deBrian.libro.getWorksheet('Base')!).map((f) => f.getCell(1).text)).toEqual(['00123-AB']);
    const sin = await descargar(e.admin, { alcance: 'filtrado', filtros: { sinResponsable: true } });
    expect(sin.r.filas).toBe(0);
  });
});

describe('auditoria, limite de uso y reautenticacion', () => {
  it('cada descarga deja una fila en la auditoria con el alcance y el numero de filas', async () => {
    const antes = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'exportar'), eq(auditoria.usuarioId, e.lector.usuarioId)));
    await descargar(e.lector, { alcance: 'toda' });
    const despues = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'exportar'), eq(auditoria.usuarioId, e.lector.usuarioId)));
    expect(despues.length).toBe(antes.length + 1);
    expect(despues.at(-1)).toMatchObject({ entidad: 'exportacion', detalle: expect.objectContaining({ alcance: 'toda', filas: 3 }) });
  });

  it('limite de 5 por hora por persona; despues pide esperar', async () => {
    for (let i = 0; i < 5; i++) await exportarBase(e.ctx(e.charles, AHORA), { alcance: 'toda' }).then((r) => r.flujo.cancel());
    const err = await fallo(exportarBase(e.ctx(e.charles, AHORA), { alcance: 'toda' }));
    expect(err.codigo).toBe('LIMITE_TASA');
    expect(err.message).toMatch(/Espera \d+ minutos?/);
  });

  it('toda la base desde una agencia con sesion de mas de 15 minutos pide volver a entrar', async () => {
    const vieja = { ...e.brianB, sesionCreadaEn: new Date(AHORA.getTime() - 20 * 60_000) };
    const err = await fallo(exportarBase(e.ctx(vieja, AHORA), { alcance: 'toda' }));
    expect(err.codigo).toBe('SIN_PERMISO');
    expect((err.detalle as { reautenticar: boolean }).reautenticar).toBe(true);
    // "Lo que veo" no lo pide; y con sesion reciente tampoco.
    const lo = await exportarBase(e.ctx(vieja, AHORA), { alcance: 'filtrado' });
    await lo.flujo.cancel();
    const fresca = { ...e.brianB, sesionCreadaEn: new Date(AHORA.getTime() - 60_000) };
    const ok = await exportarBase(e.ctx(fresca, AHORA), { alcance: 'toda' });
    await ok.flujo.cancel();
  });
});

describe('volumen', () => {
  it('2000 filas salen en streaming en menos de 10 s (SPEC 12.4)', async () => {
    const { referencia } = await import('@/db/esquema');
    const base = Array.from({ length: 2000 }, (_, i) => ({
      codigo: `VOL-${String(i).padStart(4, '0')}`,
      codigoNorm: `VOL${String(i).padStart(4, '0')}`,
      nombreProducto: `Producto de volumen ${i}`,
      tipoProducto: 'INSUMO',
      estado: i % 2 === 0 ? 'EN_GESTION' : 'CLASIFICADA',
      creadaPor: e.edward.usuarioId,
      datos: { uso: { v: `Uso ${i}\ncon salto`, n: 1, a: e.edward.usuarioId, o: e.orgInterna, t: '2026-10-20T10:00:00.000Z' } },
    }));
    for (let i = 0; i < base.length; i += 500) await e.db.insert(referencia).values(base.slice(i, i + 500));
    const t0 = Date.now();
    const { libro, r } = await descargar(e.admin, { alcance: 'toda' }, new Date(AHORA.getTime() + 7_200_000));
    const ms = Date.now() - t0;
    expect(r.filas).toBe(2003);
    expect(filas(libro.getWorksheet('Base')!)).toHaveLength(2003);
    expect(ms).toBeLessThan(10_000);
  });
});
