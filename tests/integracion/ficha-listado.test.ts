/**
 * Listado (SPEC 10.3, 13.2): visibilidad por actor, filtros, contadores amarillo/verde, orden, paginacion de 25 y
 * la seccion que falta calculada con el dominio (no recalculada en la interfaz).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, referencia } from '@/db/esquema';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { FILTROS_VACIOS, filtrosDesdeParametros, listarPagina, POR_PAGINA, type FiltrosListado } from '@/server/politicas/listado';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
const ids: Record<string, string> = {};
const filtros = (f: Partial<FiltrosListado> = {}): FiltrosListado => ({ ...FILTROS_VACIOS, ...f });
const codigos = (r: { filas: Array<{ codigo: string }> }) => r.filas.map((f) => f.codigo);

beforeAll(async () => {
  e = await nuevoEscenario();
  // 30 fichas LST-01..LST-30 (INSUMO), algunas repuestos, una clasificada, una archivada.
  for (let i = 1; i <= 30; i++) {
    const n = String(i).padStart(2, '0');
    ids[n] = await nuevaFicha(e, { codigo: `LST-${n}`, nombre: `Producto ${n} ${i % 2 === 0 ? 'azul' : 'rojo'}`, tipo: i % 5 === 0 ? 'REPUESTO' : 'INSUMO' });
  }
  await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: new Date(), clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, ids['01']!));
  await e.db.update(referencia).set({ archivadaEn: new Date(), archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, ids['02']!));
  await asignarAAduana(e, ids['03']!, e.brian);
  await asignarAAduana(e, ids['04']!, e.brianB);
  await e.db.update(referencia).set({ estado: 'EN_GESTION' }).where(eq(referencia.id, ids['06']!)); // en gestion sin responsable
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('listarPagina', () => {
  it('pagina de 25 en 25 y dice cuantas hay en total', async () => {
    const p1 = await listarPagina(e.db, e.edward, filtros(), new Date());
    expect(POR_PAGINA).toBe(25);
    expect(p1.filas).toHaveLength(25);
    expect(p1.total).toBe(29); // 30 menos la archivada
    expect(p1.paginas).toBe(2);
    expect([p1.desde, p1.hasta]).toEqual([1, 25]);
    const p2 = await listarPagina(e.db, e.edward, filtros({ pagina: 2 }), new Date());
    expect(p2.filas).toHaveLength(4);
    expect([p2.desde, p2.hasta]).toEqual([26, 29]);
    // Sin repetidos ni huecos entre paginas.
    expect(new Set([...codigos(p1), ...codigos(p2)]).size).toBe(29);
    // Una pagina fuera de rango se ajusta a la ultima.
    expect((await listarPagina(e.db, e.edward, filtros({ pagina: 99 }), new Date())).pagina).toBe(2);
  });

  it('los contadores amarillas/verdes no dependen del filtro de estado, pero si de los demas', async () => {
    const todo = await listarPagina(e.db, e.edward, filtros(), new Date());
    expect(todo.contadores).toEqual({ amarillas: 28, verdes: 1 });
    const soloVerdes = await listarPagina(e.db, e.edward, filtros({ estado: 'verdes' }), new Date());
    expect(codigos(soloVerdes)).toEqual(['LST-01']);
    expect(soloVerdes.contadores).toEqual({ amarillas: 28, verdes: 1 });
    expect(soloVerdes.filas[0]).toMatchObject({ color: 'verde', estado: 'CLASIFICADA', pendiente: null, responsables: [], sinResponsable: false });
    const repuestos = await listarPagina(e.db, e.edward, filtros({ tipo: 'REPUESTO' }), new Date());
    expect(repuestos.contadores).toEqual({ amarillas: 6, verdes: 0 });
    const amarillas = await listarPagina(e.db, e.edward, filtros({ estado: 'amarillas', pagina: 2 }), new Date());
    expect(amarillas.total).toBe(28);
  });

  it('archivadas solo con su filtro y nunca para la aduana', async () => {
    const arch = await listarPagina(e.db, e.admin, filtros({ estado: 'archivadas' }), new Date());
    expect(codigos(arch)).toEqual(['LST-02']);
    expect(arch.filas[0]?.archivada).toBe(true);
    const aduana = await listarPagina(e.db, e.brian, filtros({ estado: 'archivadas' }), new Date());
    expect(aduana.filas.every((f) => !f.archivada)).toBe(true);
  });

  it('texto: tokens AND, sin tildes, y los comodines de LIKE son texto', async () => {
    expect(codigos(await listarPagina(e.db, e.edward, filtros({ q: 'producto 07' }), new Date()))).toEqual(['LST-07']);
    expect((await listarPagina(e.db, e.edward, filtros({ q: 'azul' }), new Date())).total).toBe(14); // los pares, sin la archivada (02)
    expect((await listarPagina(e.db, e.edward, filtros({ q: 'azul 1' }), new Date())).total).toBeGreaterThan(0);
    expect((await listarPagina(e.db, e.edward, filtros({ q: '%' }), new Date())).total).toBe(0);
    expect((await listarPagina(e.db, e.edward, filtros({ q: '_' }), new Date())).total).toBe(0);
    expect((await listarPagina(e.db, e.edward, filtros({ q: 'lst-1 azul' }), new Date())).filas.every((f) => /azul/.test(f.nombreProducto))).toBe(true);
  });

  it('mis pendientes: lo que tengo asignado y abierto', async () => {
    const mias = await listarPagina(e.db, e.brian, filtros({ mias: true }), new Date());
    expect(codigos(mias)).toEqual(['LST-03']);
    expect((await listarPagina(e.db, e.edward, filtros({ mias: true }), new Date())).total).toBe(0);
    // Si la asignacion se cierra deja de ser pendiente.
    await e.db.update(asignacion).set({ estado: 'hecha', completadaEn: new Date() }).where(eq(asignacion.referenciaId, ids['03']!));
    expect((await listarPagina(e.db, e.admin, filtros({ mias: true }), new Date())).total).toBe(0);
    await e.db.update(asignacion).set({ estado: 'pendiente', completadaEn: null }).where(eq(asignacion.referenciaId, ids['03']!));
  });

  it('sin responsable: en gestion y sin asignacion abierta; y filtro por agencia (solo internos)', async () => {
    const sin = await listarPagina(e.db, e.lector, filtros({ sinResponsable: true }), new Date());
    expect(codigos(sin)).toEqual(['LST-06']);
    expect(sin.filas[0]?.sinResponsable).toBe(true);
    const deA = await listarPagina(e.db, e.lector, filtros({ agencia: e.orgA }), new Date());
    expect(codigos(deA)).toEqual(['LST-03']);
    expect(deA.agencias.map((a) => a.id).sort()).toEqual([e.orgA, e.orgB].sort());
    // La agencia no usa ni ve el filtro de agencias.
    const comoAduana = await listarPagina(e.db, e.brian, filtros({ agencia: e.orgB }), new Date());
    expect(codigos(comoAduana)).toEqual(['LST-03']);
    expect(comoAduana.agencias).toEqual([]);
  });

  it('aislamiento: la agencia ve y cuenta solo lo asignado a su organizacion (D-18)', async () => {
    const a = await listarPagina(e.db, e.brian, filtros(), new Date());
    expect(codigos(a)).toEqual(['LST-03']);
    expect(a.total).toBe(1);
    expect(a.contadores).toEqual({ amarillas: 1, verdes: 0 });
    const b = await listarPagina(e.db, e.brianB, filtros(), new Date());
    expect(codigos(b)).toEqual(['LST-04']);
    // Buscar por texto tampoco filtra lo ajeno.
    expect((await listarPagina(e.db, e.brian, filtros({ q: 'LST-04' }), new Date())).total).toBe(0);
    expect(a.filas[0]?.responsables).toEqual([e.brian.nombre]);
  });

  it('el responsable de otra agencia se enmascara (A5)', async () => {
    const f = ids['05']!;
    await asignarAAduana(e, f, e.brianB);
    // Un interno ve el nombre; la propia agencia tambien (es ella).
    expect((await listarPagina(e.db, e.admin, filtros({ q: 'LST-05' }), new Date())).filas[0]?.responsables).toEqual([e.brianB.nombre]);
  });

  it('orden: por codigo y por dias en gestion', async () => {
    const porCodigo = await listarPagina(e.db, e.edward, filtros({ orden: 'codigo' }), new Date());
    expect(codigos(porCodigo)).toEqual([...codigos(porCodigo)].sort());
    const viejo = await nuevaFicha(e, { codigo: 'ZZ-VIEJO' });
    await e.db.update(referencia).set({ fechaSolicitud: '2026-01-02' }).where(eq(referencia.id, viejo));
    const porDias = await listarPagina(e.db, e.edward, filtros({ orden: 'dias' }), new Date('2026-10-21T15:00:00Z'));
    expect(porDias.filas[0]).toMatchObject({ codigo: 'ZZ-VIEJO' });
    expect(porDias.filas[0]?.diasEnGestion).toBeGreaterThan(250);
  });

  it('la seccion que falta sale del dominio y avanza al llenar campos', async () => {
    const f = await nuevaFicha(e, { codigo: 'SEC-1', tipo: 'INSUMO' });
    const antes = (await listarPagina(e.db, e.edward, filtros({ q: 'SEC-1' }), new Date())).filas[0]!;
    expect(antes.pendiente).toMatchObject({ seccion: 'producto', etiqueta: 'Producto' });
    expect(antes.pendiente?.faltan).toBeGreaterThan(0);
    expect(antes.faltan).toBeGreaterThan(antes.pendiente!.faltan);

    const llenar = async (campo: string, valor: unknown) => {
      const [x] = await e.db.select({ d: referencia.datos }).from(referencia).where(eq(referencia.id, f));
      await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo, valor, versionEsperada: x?.d?.[campo]?.n ?? 0 });
    };
    await llenar('descripcion_factura', 'X');
    await llenar('uso', 'Y');
    await llenar('funciones', 'Z');
    await llenar('unidad_medida', 'Kilogramos');
    await llenar('area_responsable', 'Mantenimiento');
    await llenar('pais_origen', 'FR');
    await llenar('fabricante', 'Fabricante Demo SA');
    await llenar('proveedor', 'Proveedor Demo SA');
    await llenar('reembolsable', 'No');
    const despues = (await listarPagina(e.db, e.edward, filtros({ q: 'SEC-1' }), new Date())).filas[0]!;
    expect(despues.pendiente?.seccion).toBe('detalle');
  });

  it('L2: busca tambien por descripcion segun factura, proveedor y fabricante (y se reindexa al guardar)', async () => {
    const f = await nuevaFicha(e, { codigo: 'BUS-L2', nombre: 'Algo generico' });
    const llenar = async (campo: string, valor: unknown) => {
      const [x] = await e.db.select({ d: referencia.datos }).from(referencia).where(eq(referencia.id, f));
      await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo, valor, versionEsperada: x?.d?.[campo]?.n ?? 0 });
    };
    const q = async (texto: string) => codigos(await listarPagina(e.db, e.edward, filtros({ q: texto }), new Date()));
    await llenar('descripcion_factura', 'Valvula solenoide de bronce');
    await llenar('fabricante', 'Danfoss');
    await llenar('proveedor', 'Distribuidora Andina');
    expect(await q('solenoide bronce')).toEqual(['BUS-L2']);
    expect(await q('danfoss')).toEqual(['BUS-L2']);
    expect(await q('andina')).toEqual(['BUS-L2']);
    // Al cambiar el fabricante, el texto viejo deja de encontrarla.
    await llenar('fabricante', 'Parker');
    expect(await q('danfoss')).toEqual([]);
    expect(await q('parker')).toEqual(['BUS-L2']);
  });

  it('L1 y L3: la partida final solo se muestra clasificada; el filtro es por prefijo y no le importan los puntos', async () => {
    const cerrada = await nuevaFicha(e, { codigo: 'PAR-1' });
    const abierta = await nuevaFicha(e, { codigo: 'PAR-2' });
    const otra = await nuevaFicha(e, { codigo: 'PAR-3' });
    await e.db.update(referencia).set({ partida: '8421.39.90.00', estado: 'CLASIFICADA', clasificadaEn: new Date(), clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, cerrada));
    await e.db.update(referencia).set({ partida: '8421.21.00.00' }).where(eq(referencia.id, abierta));
    await e.db.update(referencia).set({ partida: '3824.99.99.00', estado: 'CLASIFICADA', clasificadaEn: new Date(), clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, otra));
    const por = async (partida: string) => (await listarPagina(e.db, e.edward, filtros({ partida, orden: 'codigo' }), new Date())).filas;
    const r = await por('8421');
    expect(r.map((x) => x.codigo)).toEqual(['PAR-1', 'PAR-2']);
    expect(r.find((x) => x.codigo === 'PAR-1')?.partida).toBe('8421.39.90.00');
    expect(r.find((x) => x.codigo === 'PAR-2')?.partida).toBeNull(); // pendiente: la partida aun no es final
    expect((await por('8421.39')).map((x) => x.codigo)).toEqual(['PAR-1']);
    expect((await por('842139')).map((x) => x.codigo)).toEqual(['PAR-1']);
    expect((await por('8421.39.90.00')).map((x) => x.codigo)).toEqual(['PAR-1']);
    expect((await por('39')).length).toBe(0); // prefijo, no contiene
    // Un valor que no es partida no filtra.
    expect(filtrosDesdeParametros({ partida: 'abc' }).partida).toBe('');
  });

  it('L4: los dias corren mientras esta pendiente y se congelan al clasificar', async () => {
    const f = await nuevaFicha(e, { codigo: 'DIA-1' });
    await e.db.update(referencia).set({ fechaSolicitud: '2026-10-01' }).where(eq(referencia.id, f));
    const dias = async (ahora: string) => (await listarPagina(e.db, e.edward, filtros({ q: 'DIA-1' }), new Date(ahora))).filas[0]?.diasEnGestion;
    expect(await dias('2026-10-11T15:00:00Z')).toBe(10);
    expect(await dias('2026-10-21T15:00:00Z')).toBe(20);
    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: new Date('2026-10-15T15:00:00Z'), clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, f));
    expect(await dias('2026-10-21T15:00:00Z')).toBe(14);
    expect(await dias('2026-12-31T15:00:00Z')).toBe(14);
  });

  it('no filtra por filtros que no entiende y devuelve filas con el contrato esperado', async () => {
    const r = await listarPagina(e.db, e.edward, filtros(), new Date());
    const fila = r.filas[0]!;
    expect(Object.keys(fila).sort()).toEqual(
      ['actualizadaEn', 'archivada', 'area', 'codigo', 'color', 'diasEnGestion', 'esperaRespuesta', 'estado', 'faltan', 'id', 'nombreProducto', 'partida', 'pendiente', 'responsables', 'sinResponsable', 'tipoProducto', 'total'].sort(),
    );
    expect(JSON.stringify(r)).not.toContain('"datos"'); // el listado nunca lleva `datos` al navegador
  });
});
