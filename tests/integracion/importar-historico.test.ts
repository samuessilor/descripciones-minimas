/**
 * Carga del historico (Excel -> referencias Clasificadas), con PGlite:
 *  - la plantilla se genera, se lee de vuelta y trae listas desplegables;
 *  - prueba en seco: separa validas, con errores, repetidas y ya existentes, sin escribir nada;
 *  - la carga deja exactamente lo que dejaria crear y cerrar la ficha (datos, historial v1, busqueda, cierre) a nombre de una
 *    cuenta inactiva; es idempotente; no crea avisos ni asignaciones;
 *  - las fichas importadas se ven y se buscan por el equipo interno, no por una agencia, y NO llenan la hoja Historial del Excel;
 *  - una importada se reabre y se corrige como cualquier otra, y el cambio SI aparece en el historial exportado.
 */
import ExcelJS from 'exceljs';
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, asignacion, auditoria, campoHistorial, notificacion, organizacion, partidaArancelaria, referencia, usuario } from '@/db/esquema';
import { COLUMNAS_HISTORICO, type Celda } from '@/dominio/plantilla-historico';
import { NOMBRE_HISTORICO } from '@/dominio/historico-importado';
import { buscar } from '@/server/acciones/buscar';
import { reabrir } from '@/server/acciones/cierre';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { NombresUsuarios } from '@/server/exportar/filas';
import { cargarHistorial } from '@/server/exportar/historial';
import { asegurarCuentaHistorico, aplicarImportacion, construirFicha, planificarImportacion } from '@/server/importar/historico';
import { leerLibro } from '@/server/importar/leer-libro';
import { crearPlantilla } from '@/server/importar/plantilla';
import { cargarReferenciaVisible, listarReferencias } from '@/server/politicas/referencias';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { nuevoEscenario, rechazaCon, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

/** Un libro con la hoja `Referencias` y los encabezados de la plantilla, como lo dejaria quien lo llena. */
async function libroCon(filas: Array<Record<string, Celda>>): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Referencias');
  hoja.addRow(COLUMNAS_HISTORICO.map((c) => c.encabezado));
  for (const f of filas) hoja.addRow(COLUMNAS_HISTORICO.map((c) => f[c.clave] ?? null));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

const completa: Record<string, Celda> = {
  codigo: 'IMP-001',
  nombre_producto: 'RESINA EPOXICA DE DOS COMPONENTES',
  tipo_producto: 'Insumo',
  area_responsable: 'Consumibles',
  fecha_solicitud: new Date(Date.UTC(2025, 2, 15)),
  fecha_clasificacion: '02/04/2025',
  descripcion_factura: 'RESINA E1',
  uso: 'Recubrir la cara externa de lentes',
  funciones: 'Forma una capa resistente',
  unidad_medida: 'kilogramos',
  pais_origen: 'Francia',
  fabricante: 'Quimica Ejemplo SA',
  proveedor: 'el mismo fabricante',
  reembolsable: 'si',
  materia_constitutiva: 'Resina epoxica 80 %',
  aspecto_fisico: 'líquido',
  marca: 'Sin marca',
  tipo_empaque: 'bidon',
  cantidad_empaque: '20 litros',
  requiere_rim: 'No',
  partida_arancelaria: '8421390000',
  descripciones_minimas: 'No aplica',
  restricciones: 'No aplica',
  observaciones_aduana: 'No aplica',
};
const escasa: Record<string, Celda> = {
  codigo: 'imp 002',
  nombre_producto: 'Motor serie E 400 W',
  tipo_producto: 'Repuesto',
  fecha_solicitud: '2025-01-10',
  maquina_destino: 'Aspiradora MEI',
};
const equipo: Record<string, Celda> = {
  codigo: 'IMP-006',
  nombre_producto: 'Aspiradora industrial',
  tipo_producto: 'Equipo/Máquina',
  area_responsable: 'Mantenimiento',
  fecha_solicitud: '20/06/2024',
  fecha_fabricacion: 'Por confirmar',
  maquina_destino: 'no aplica a un equipo',
  tipo_empaque: 'Unidad',
  cantidad_empaque: '5',
  partida_arancelaria: '8509.80.00.00',
};

describe('plantilla', () => {
  it('se genera, se lee de vuelta y trae instrucciones, listas desplegables y los catalogos vivos', async () => {
    const buf = await crearPlantilla({ unidades: ['Litros', 'Metros'], aspectos: ['Sólido'] });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Instrucciones', 'Referencias', 'Listas']);
    const refs = libro.getWorksheet('Referencias')!;
    expect(refs.getRow(1).values).toEqual([undefined, ...COLUMNAS_HISTORICO.map((c) => c.encabezado)]);

    // Ocho listas desplegables (tipo, area, reembolsable, empaque, RIM, unidad, aspecto, pais) sobre las filas 2 a 3000 (el archivo las
    // guarda como 8 rangos; al leerlo ExcelJS las reparte celda por celda).
    const tipo = refs.getCell('C2').dataValidation;
    expect(tipo).toMatchObject({ type: 'list', errorStyle: 'stop' });
    expect(tipo.formulae?.[0]).toMatch(/^Listas!\$A\$2:\$A\$6$/);
    expect(refs.getCell('C3000').dataValidation?.type).toBe('list');
    expect(refs.getCell('C3001').dataValidation).toBeUndefined();
    expect(refs.getCell('J2').dataValidation).toMatchObject({ type: 'list', errorStyle: 'warning' }); // unidad: deja escribir otro y lo avisa
    expect(refs.getCell('G2').dataValidation).toBeUndefined(); // texto libre

    const listas = libro.getWorksheet('Listas')!;
    const col = (n: number) => listas.getColumn(n).values.slice(2).filter(Boolean);
    expect(col(6)).toEqual(['Litros', 'Metros']);
    expect(col(7)).toEqual(['Sólido', 'No aplica']);
    expect(col(8)).toContain('Francia');

    const leido = await leerLibro(buf);
    expect(leido.filas).toHaveLength(0);
    expect(leido.columnasFaltantes).toEqual([]);
  });
});

describe('prueba en seco', () => {
  it('separa validas, con errores, repetidas y ya existentes, y no escribe nada', async () => {
    const buf = await libroCon([
      completa,
      escasa,
      { ...completa, codigo: 'imp-001' }, // el mismo codigo normalizado: repetida
      { codigo: 'IMP-003', nombre_producto: 'Mala', tipo_producto: 'Cosa', fecha_solicitud: '2999-01-01' },
      { ...completa, codigo: 'IMP-004', unidad_medida: 'Cajas' },
      equipo,
    ]);
    const lectura = await leerLibro(buf);
    expect(lectura.hoja).toBe('Referencias');
    expect(lectura.filas).toHaveLength(6);

    const plan = await planificarImportacion(e.db, lectura.filas, new Date('2026-11-10T15:00:00Z'));
    expect(plan.validas.map((f) => f.codigo)).toEqual(['IMP-001', 'imp 002', 'IMP-006']);
    expect(plan.repetidas).toEqual([{ fila: 4, codigo: 'imp-001', primeraEn: 2 }]);
    expect(plan.rechazadas.map((r) => r.fila)).toEqual([5, 6]);
    expect(plan.rechazadas[0]!.errores.join(' ')).toContain('Tipo de producto «Cosa»');
    expect(plan.valoresDesconocidos).toEqual([{ catalogo: 'unidad_medida', valor: 'Cajas', filas: 1 }]);
    expect(plan.partidasNuevas).toEqual(['8421.39.00.00', '8509.80.00.00']);
    // La de pocos datos sale con aviso de lo que falta; la de equipo, con lo que se ignoro.
    expect(plan.avisos.find((a) => a.codigo === 'imp 002')!.avisos.join(' ')).toContain('Le faltan');
    expect(plan.avisos.find((a) => a.codigo === 'IMP-006')!.avisos.join(' ')).toContain('se ignoró');

    expect((await e.db.select({ n: count() }).from(referencia))[0]!.n).toBe(0);
    expect(await e.db.select().from(organizacion).where(eq(organizacion.nombre, NOMBRE_HISTORICO))).toHaveLength(0);
  });
});

describe('carga', () => {
  let ids: Record<string, string>;
  let nCampos: number;

  it('deja las referencias cerradas, con el historial de cada campo y a nombre de la cuenta del historico', async () => {
    const lectura = await leerLibro(await libroCon([completa, escasa, equipo]));
    const plan = await planificarImportacion(e.db, lectura.filas, new Date('2026-11-10T15:00:00Z'));
    const r = await aplicarImportacion(e.db, plan, { archivo: 'historico.xlsx', tamanoLote: 2 });
    expect(r).toEqual({ creadas: 3, partidasCreadas: 2, omitidas: 0, saltadasPorConflicto: 0 });

    const filas = await e.db.select().from(referencia);
    expect(filas).toHaveLength(3);
    ids = Object.fromEntries(filas.map((f) => [f.codigoNorm, f.id]));

    const f = filas.find((x) => x.codigoNorm === 'IMP001')!;
    expect(f.estado).toBe('CLASIFICADA');
    expect(f.tipoProducto).toBe('INSUMO');
    expect(f.fechaSolicitud).toBe('2025-03-15');
    expect(f.clasificadaEn?.toISOString()).toBe('2025-04-02T17:00:00.000Z');
    expect(f.partida).toBe('8421.39.00.00');
    expect(f.diasPausa).toBe(0);
    expect(f.textoBusqueda).toContain('imp001');
    expect(f.textoBusqueda).toContain('resina e1');
    const v = (campo: string) => f.datos[campo]?.v;
    expect(v('unidad_medida')).toBe('Kilogramos');
    expect(v('pais_origen')).toBe('FR');
    expect(v('proveedor')).toEqual({ mismo_fabricante: true });
    expect(v('marca')).toEqual({ sin_marca: true });
    expect(v('reembolsable')).toBe('Sí');
    expect(v('tipo_empaque')).toBe('Bidón');
    expect(v('clasificacion_finalizada')).toBe('SI');
    expect(v('area_responsable')).toBe('Consumibles');

    // Un hecho version 1 por campo de la proyeccion, ninguno de mas ni de menos.
    const hist = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, f.id));
    nCampos = Object.keys(f.datos).length;
    expect(hist).toHaveLength(nCampos);
    expect(new Set(hist.map((h) => h.campo))).toEqual(new Set(Object.keys(f.datos)));
    // Todo lo importado se reconoce por lo mismo: `fijar` + origen `sistema` (incluido el cierre).
    expect(hist.every((h) => h.versionCampo === 1 && h.origen === 'sistema' && h.tipoEvento === 'fijar')).toBe(true);
    expect(f.version).toBe(nCampos + 1);

    const [h] = await e.db.select().from(usuario).where(eq(usuario.id, f.creadaPor));
    expect(h).toMatchObject({ nombre: NOMBRE_HISTORICO, activo: false, rol: 'lector' });
    expect(f.clasificadaPor).toBe(h!.id);
    expect(await e.db.select().from(account).where(eq(account.userId, h!.id))).toHaveLength(0); // nunca tuvo contrasena
    const [org] = await e.db.select().from(organizacion).where(eq(organizacion.id, h!.organizacionId));
    expect(org).toMatchObject({ activa: false, tipo: 'interna' });

    // La ficha escasa conserva solo lo que traia, mas la nota de procedencia; el equipo ignora lo que no le corresponde.
    const escasaFila = filas.find((x) => x.codigoNorm === 'IMP002')!;
    expect(escasaFila.fechaSolicitud).toBe('2025-01-10');
    expect(escasaFila.clasificadaEn?.toISOString()).toBe('2025-01-10T17:00:00.000Z'); // sin fecha de clasificacion: la de solicitud
    expect(escasaFila.datos.maquina_destino?.v).toBe('Aspiradora MEI');
    expect(escasaFila.datos.informacion_adicional?.v).toContain('histórico');
    const equipoFila = filas.find((x) => x.codigoNorm === 'IMP006')!;
    expect(Object.keys(equipoFila.datos)).not.toContain('maquina_destino');
    expect(equipoFila.datos.fecha_fabricacion?.v).toEqual({ por_confirmar: true, nota: '' });

    // Las partidas nuevas quedan en el catalogo con origen aduana y la cuenta del historico como autora.
    const partidas = await e.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '8421.39.00.00'));
    expect(partidas[0]).toMatchObject({ origen: 'aduana', creadaPor: h!.id, activa: true });

    // Sin avisos ni pendientes: son procesos que ya terminaron. Una sola auditoria de la carga.
    expect((await e.db.select({ n: count() }).from(notificacion))[0]!.n).toBe(0);
    expect((await e.db.select({ n: count() }).from(asignacion))[0]!.n).toBe(0);
    // Una fila de auditoria por lote (aqui lotes de 2 + 1), en la misma transaccion que el lote.
    const aud = await e.db.select().from(auditoria).where(eq(auditoria.accion, 'importar_historico'));
    expect(aud).toHaveLength(2);
    expect(aud.map((a) => (a.detalle as { creadas: number }).creadas).sort()).toEqual([1, 2]);
    expect(aud[0]!.detalle).toMatchObject({ archivo: 'historico.xlsx', saltadasPorConflicto: 0 });
  });

  it('es idempotente: volver a correr el mismo archivo no cambia nada y lo informa', async () => {
    const lectura = await leerLibro(await libroCon([completa, escasa, equipo, { ...completa, codigo: 'IMP-007', partida_arancelaria: '8421.39.00.00' }]));
    const plan = await planificarImportacion(e.db, lectura.filas, new Date('2026-11-10T15:00:00Z'));
    expect(plan.yaExisten.map((x) => x.codigo)).toEqual(['IMP-001', 'imp 002', 'IMP-006']);
    expect(plan.validas.map((x) => x.codigo)).toEqual(['IMP-007']);
    expect(plan.partidasNuevas).toEqual([]); // la partida ya estaba
    const r = await aplicarImportacion(e.db, plan, { archivo: 'historico-2.xlsx' });
    expect(r).toMatchObject({ creadas: 1, partidasCreadas: 0, omitidas: 3 });
    expect((await e.db.select({ n: count() }).from(referencia))[0]!.n).toBe(4);
    // La cuenta del historico se reutiliza.
    expect(await e.db.select().from(organizacion).where(eq(organizacion.nombre, NOMBRE_HISTORICO))).toHaveLength(1);
    expect(await e.db.select().from(usuario).where(eq(usuario.nombre, NOMBRE_HISTORICO))).toHaveLength(1);
  });

  it('el equipo interno las ve, las busca y las lista; una agencia no', async () => {
    const ahora = new Date('2026-11-10T15:00:00Z');
    for (const actor of [e.admin, e.edward, e.lector]) {
      expect((await cargarReferenciaVisible(e.db, actor, ids.IMP001!, ahora)).codigo).toBe('IMP-001');
    }
    await rechazaCon(cargarReferenciaVisible(e.db, e.brian, ids.IMP001!, ahora), /./);

    const r = await buscar(e.ctx(e.edward, ahora), { q: 'imp001' });
    expect(r.resultados.map((x) => x.codigo)).toContain('IMP-001');
    const porNombre = await buscar(e.ctx(e.edward, ahora), { q: 'aspiradora' });
    expect(porNombre.resultados.map((x) => x.codigo)).toEqual(expect.arrayContaining(['IMP-006', 'imp 002']));

    const lista = await listarReferencias(e.db, e.admin, { ahora, limite: 100 });
    expect(lista.filter((x) => x.estado === 'CLASIFICADA')).toHaveLength(4);
    // Lo importado no se cuela como «pendiente de nadie».
    const vacia = await listarReferencias(e.db, e.brian, { ahora, limite: 100 });
    expect(vacia).toHaveLength(0);
  });

  it('un codigo importado ya no se puede crear de nuevo (la misma regla de duplicados)', async () => {
    const { crearReferencia } = await import('@/server/acciones/crear-referencia');
    await rechazaCon(crearReferencia(e.ctx(e.edward), { codigo: 'imp-001', nombreProducto: 'otra', tipoProducto: 'INSUMO' }), /Ya existe la referencia IMP-001/);
  });

  it('no llena la hoja Historial del Excel; si se reabre y se corrige, el cambio SI aparece con su valor anterior', async () => {
    const nombres = new NombresUsuarios(e.admin);
    const antes = await cargarHistorial({ ej: e.db, actor: e.admin, nombres }, undefined);
    expect(antes.filas).toHaveLength(0);

    await reabrir(e.ctx(e.admin), { referenciaId: ids.IMP001!, motivo: 'El proveedor corrigio el uso' });
    const [abierta] = await e.db.select().from(referencia).where(eq(referencia.id, ids.IMP001!));
    expect(abierta).toMatchObject({ estado: 'EN_GESTION', clasificadaEn: null, clasificadaPor: null });
    expect(abierta!.diasPausa).toBeGreaterThan(300); // los dias que estuvo cerrada no cuentan como gestion

    const g = await guardarCampo(e.ctx(e.admin), {
      referenciaId: ids.IMP001!,
      campo: 'uso',
      valor: 'Recubrir la cara interna',
      versionEsperada: 1,
      motivo: 'Dato corregido por el proveedor',
    });
    expect(g).toMatchObject({ escrito: true, version: 2 });

    const despues = await cargarHistorial({ ej: e.db, actor: e.admin, nombres }, undefined);
    const cambios = despues.filas.map((f) => f.valores);
    expect(cambios.find((c) => c.campo === 'Uso/Función específica del producto')).toMatchObject({
      codigo: 'IMP-001',
      evento: 'Cambio',
      anterior: 'Recubrir la cara externa de lentes',
      nuevo: 'Recubrir la cara interna',
    });
    // Lo importado sigue sin salir: solo estan la reapertura (hecho del sistema, version 2) y el cambio.
    expect(cambios.every((c) => c.evento !== 'Primer valor')).toBe(true);
    const todos = await e.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, ids.IMP001!), eq(campoHistorial.campo, 'uso')));
    expect(todos.map((h) => h.versionCampo).sort()).toEqual([1, 2]);
  });
});

describe('defectos que encontro la revision', () => {
  it('si alguien crea a mano un codigo entre la prueba y la carga, solo esa fila se salta: el lote sigue y queda constancia', async () => {
    const lectura = await leerLibro(await libroCon([{ ...equipo, codigo: 'CF-001' }, { ...equipo, codigo: 'CF-002' }, { ...equipo, codigo: 'CF-003' }]));
    const plan = await planificarImportacion(e.db, lectura.filas, new Date('2026-11-10T15:00:00Z'));
    expect(plan.validas).toHaveLength(3);
    // Entre la prueba en seco y la carga, alguien crea CF-002.
    await crearReferencia(e.ctx(e.edward), { codigo: 'cf 002', nombreProducto: 'Creada a mano', tipoProducto: 'INSUMO' });
    const r = await aplicarImportacion(e.db, plan, { archivo: 'conflicto.xlsx' }); // un solo lote de 40
    expect(r).toMatchObject({ creadas: 2, saltadasPorConflicto: 1 });
    const filas = await e.db.select().from(referencia);
    const cf2 = filas.find((f) => f.codigoNorm === 'CF002')!;
    expect(cf2.nombreProducto).toBe('Creada a mano'); // no se sobrescribio
    const hechos = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, cf2.id));
    expect(hechos.every((h) => h.origen === 'web')).toBe(true); // ni un hecho importado colgado de la ficha ajena
    const aud = await e.db.select().from(auditoria).where(eq(auditoria.entidadId, 'conflicto.xlsx'));
    expect(aud).toHaveLength(1);
    expect(aud[0]!.detalle).toMatchObject({ creadas: 2, saltadasPorConflicto: 1, desdeFila: 2, hastaFila: 4 });
  });

  it('la cuenta del historico se encuentra por su correo aunque renombren su organizacion: no se crea otra', async () => {
    const antes = await asegurarCuentaHistorico(e.db);
    await e.db.update(organizacion).set({ nombre: 'Renombrada por alguien' }).where(eq(organizacion.id, antes.organizacionId));
    const despues = await asegurarCuentaHistorico(e.db);
    expect(despues).toEqual(antes);
    expect(await e.db.select().from(organizacion).where(eq(organizacion.nombre, NOMBRE_HISTORICO))).toHaveLength(0);
  });

  it('una referencia cerrada «hoy» no queda con fecha del futuro aunque se cargue antes del mediodia', async () => {
    const lectura = await leerLibro(await libroCon([{ ...equipo, codigo: 'HOY-1', fecha_solicitud: '10/11/2026', fecha_clasificacion: '10/11/2026' }]));
    const ahora = new Date('2026-11-10T13:00:00Z'); // 08:00 en Bogota
    const plan = await planificarImportacion(e.db, lectura.filas, ahora);
    const h = await asegurarCuentaHistorico(e.db);
    const { fila, hechos } = construirFicha(plan.validas[0]!, h, ahora);
    expect(fila.clasificadaEn!.getTime()).toBe(ahora.getTime());
    expect(fila.creadaEn!.getTime()).toBeLessThanOrEqual(ahora.getTime());
    expect(hechos.every((x) => x.creadoEn!.getTime() <= ahora.getTime())).toBe(true);
  });

  it('el lector no confunde una formula sin valor con una celda vacia y conserva el texto de un porcentaje', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('Referencias');
    hoja.addRow(COLUMNAS_HISTORICO.map((c) => c.encabezado));
    const fila = hoja.addRow(COLUMNAS_HISTORICO.map(() => null));
    const col = (clave: string) => COLUMNAS_HISTORICO.findIndex((c) => c.clave === clave) + 1;
    fila.getCell(col('codigo')).value = 'FX-1';
    fila.getCell(col('nombre_producto')).value = 'Con formula';
    fila.getCell(col('tipo_producto')).value = 'Insumo';
    fila.getCell(col('fecha_solicitud')).value = '2025-01-10';
    fila.getCell(col('uso')).value = { formula: '1+1' } as ExcelJS.CellFormulaValue; // sin resultado guardado
    fila.getCell(col('fabricante')).value = { error: '#N/A' } as ExcelJS.CellErrorValue;
    const pct = fila.getCell(col('materia_constitutiva'));
    pct.value = 0.85;
    pct.numFmt = '0%';
    const lectura = await leerLibro(Buffer.from(await libro.xlsx.writeBuffer()));
    const plan = await planificarImportacion(e.db, lectura.filas, new Date('2026-11-10T15:00:00Z'));
    expect(plan.validas).toHaveLength(0);
    const errores = plan.rechazadas[0]!.errores.join(' | ');
    expect(errores).toContain('Uso/Función específica del producto: la celda tiene una fórmula sin valor calculado');
    expect(errores).toContain('Fabricante: la celda tiene una fórmula sin valor calculado');
    expect(lectura.filas[0]!.celdas.materia_constitutiva).toBe('85%');
  });
});
