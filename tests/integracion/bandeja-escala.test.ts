/**
 * Escala de la bandeja de Inicio («Para mi», «Esperando a otros», resumen) con volumen de un mes alto: una cuenta de
 * area con ~300 referencias abiertas y ~105 envios activos. Mide tiempo, filas y tamano de lo que se lee en CADA carga
 * de Inicio y comprueba que las dos listas se recortan con el mismo orden con que se muestran (mas dias en gestion
 * primero, S-09) y que los totales siguen coincidiendo con los contadores del resumen.
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { referencia } from '@/db/esquema';
import { enviarALote } from '@/server/acciones/asignaciones';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { crearCuenta } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { TOPE_ESPERANDO, TOPE_PARA_MI, bandejaParaMiDe, esperandoDe, pendientesDe, recientesDe, resumenInicioDe } from '@/server/politicas/colaboracion';
import { nuevoEscenario, type Escenario } from './ayudas';
import { DATOS_INSUMO, escribir } from './ayudas-aduana';

let e: Escenario;
let instr: Actor;
let mkt: Actor;
const T0 = new Date('2026-11-09T15:00:00.000Z');
const N_AREA = 300;
const N_ENVIOS = 105;

beforeAll(async () => {
  e = await nuevoEscenario();
  const cuenta = async (nombre: string, u: string, area: string) =>
    (await cargarActorPorId(
      e.db,
      (await crearCuenta(e.ctx(e.admin), { nombre, usuario: u, email: `${u}@prueba.invalid`, organizacionId: e.orgInterna, rol: 'solicitante', area })).id,
    ))!;
  instr = await cuenta('Instrumentos', 'instrumentos', 'Instrumentos');
  mkt = await cuenta('Marketing', 'marketing', 'Marketing');
}, 120_000);
afterAll(async () => {
  await e.c.cerrar();
});

async function mediana(fn: () => Promise<unknown>, veces = 5): Promise<number> {
  const t: number[] = [];
  for (let i = 0; i < veces; i++) {
    const a = performance.now();
    await fn();
    t.push(performance.now() - a);
  }
  return Math.round(t.sort((x, y) => x - y)[Math.floor(veces / 2)]!);
}

describe('escala de Inicio con un mes de uso alto', () => {
  it(`${N_AREA} referencias abiertas del area + ${N_ENVIOS} envios activos: Inicio acota las dos listas, con el recorte en el orden mostrado y el total a la vista`, async () => {
    // 1) molde: una ficha con 7 campos llenos (area Instrumentos, secciones aun pendientes)
    const molde = await crearReferencia(e.ctx(instr, T0), { codigo: 'ESC-MOLDE', nombreProducto: 'Molde', tipoProducto: 'INSUMO', areaResponsable: 'Instrumentos' });
    for (const [campo, valor] of DATOS_INSUMO.slice(0, 7)) await escribir(e, instr, molde.id, campo, valor);
    const [m] = await e.db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, molde.id));

    // 2) N_AREA fichas abiertas del area, con ese mismo contenido
    const delArea: string[] = [];
    for (let i = 0; i < N_AREA; i++) {
      const r = await crearReferencia(e.ctx(instr, T0), { codigo: `ESC-A-${i}`, nombreProducto: `Producto del area ${i}`, tipoProducto: 'INSUMO', areaResponsable: 'Instrumentos' });
      await e.db.update(referencia).set({ datos: m!.datos }).where(eq(referencia.id, r.id));
      delArea.push(r.id);
    }

    // 3) N_ENVIOS referencias de Marketing enviadas a Instrumentos (en lotes de 25 = 5 operaciones)
    const ids: string[] = [];
    for (let i = 0; i < N_ENVIOS; i++) {
      const r = await crearReferencia(e.ctx(mkt, T0), { codigo: `ESC-E-${i}`, nombreProducto: `Envio ${i}`, tipoProducto: 'INSUMO', areaResponsable: 'Marketing' });
      await e.db.update(referencia).set({ datos: m!.datos }).where(eq(referencia.id, r.id));
      ids.push(r.id);
    }
    for (let i = 0; i < ids.length; i += 25) {
      await enviarALote(e.ctx(mkt, new Date(T0.getTime() + i)), { referenciaIds: ids.slice(i, i + 25), destinatarios: [{ usuarioId: instr.usuarioId, pedido: 'completar' }] });
    }
    // Las 5 ultimas de cada grupo (las mas NUEVAS) llevan mas dias en gestion: el recorte no puede dejarlas fuera por ser nuevas.
    await e.db.update(referencia).set({ fechaSolicitud: '2026-10-01' }).where(inArray(referencia.id, [...ids.slice(-5), ...delArea.slice(-5)]));

    // 4) lo que lee Inicio en cada carga
    const bandeja = await bandejaParaMiDe(e.db, instr, T0);
    const completa = await pendientesDe(e.db, instr, T0);
    const esperando = await esperandoDe(e.db, e.admin, T0);
    const esperandoTodas = await esperandoDe(e.db, e.admin, T0, 1000);
    const resumenAdmin = await resumenInicioDe(e.db, e.admin, T0);
    const resumenInstr = await resumenInicioDe(e.db, instr, T0);
    const resumenReutilizado = await resumenInicioDe(e.db, instr, T0, bandeja.total);
    const tBandeja = await mediana(() => bandejaParaMiDe(e.db, instr, T0));
    const tCompleta = await mediana(() => pendientesDe(e.db, instr, T0));
    const tEsp = await mediana(() => esperandoDe(e.db, e.admin, T0));
    // Lo que hace Inicio ahora: la bandeja y el resumen reutilizando su total (antes: pendientesDe sin tope + un resumen que la repetia).
    const tInicio = await mediana(async () => resumenInicioDe(e.db, instr, T0, (await bandejaParaMiDe(e.db, instr, T0)).total));
    const tRes = await mediana(() => resumenInicioDe(e.db, instr, T0));
    const tRec = await mediana(() => recientesDe(e.db, instr, T0, 8));
    if (process.env.VITEST_MEDIDAS === '1') console.info(
      `[medida] Inicio con ${N_AREA} abiertas del area + ${N_ENVIOS} envios (PGlite en memoria): ` +
        `bandejaParaMiDe(${TOPE_PARA_MI})=${bandeja.filas.length} de ${bandeja.total} filas ${tBandeja} ms ${Math.round(JSON.stringify(bandeja.filas).length / 1024)} KB | ` +
        `pendientesDe sin tope=${completa.length} filas ${tCompleta} ms ${Math.round(JSON.stringify(completa).length / 1024)} KB | ` +
        `esperandoDe(admin)=${esperando.length} de ${resumenAdmin.esperandoAOtros} filas ${tEsp} ms | ` +
        `Inicio (bandeja + resumen con su total) ${tInicio} ms | resumenInicioDe solo ${tRes} ms | recientes ${tRec} ms`,
    );

    // Para mi: tope de 50 con el total real a la vista; el total coincide con la lista sin tope y con el contador del resumen
    expect(bandeja.filas).toHaveLength(TOPE_PARA_MI);
    expect(bandeja.total).toBe(completa.length);
    expect(bandeja.total).toBeGreaterThanOrEqual(N_AREA + N_ENVIOS);
    expect(resumenInstr.pendientesParaMi).toBe(bandeja.total);
    expect(resumenReutilizado.pendientesParaMi).toBe(bandeja.total);
    // y recortar no cambia el orden: son exactamente las primeras de la lista completa (las de mas dias en gestion)
    expect(bandeja.filas.map((f) => f.referenciaId)).toEqual(completa.slice(0, TOPE_PARA_MI).map((f) => f.referenciaId));
    const dias = bandeja.filas.map((f) => f.diasEnGestion);
    expect(dias).toEqual([...dias].sort((a, b) => b - a));
    const codigosPara = new Set(bandeja.filas.map((f) => f.codigo));
    for (const c of ['ESC-E-104', 'ESC-A-299']) expect(codigosPara.has(c), `${c} (mas dias en gestion) debe estar entre las primeras`).toBe(true);

    // Esperando a otros: el tope de 100 ya no deja fuera en silencio a las mas urgentes; el recorte sigue el orden mostrado y el total lo dice
    expect(resumenAdmin.esperandoAOtros).toBeGreaterThanOrEqual(N_ENVIOS);
    expect(esperandoTodas).toHaveLength(resumenAdmin.esperandoAOtros);
    expect(esperando).toHaveLength(TOPE_ESPERANDO);
    expect(esperando.length).toBeLessThan(resumenAdmin.esperandoAOtros);
    expect(esperando.map((f) => f.asignacionId)).toEqual(esperandoTodas.slice(0, TOPE_ESPERANDO).map((f) => f.asignacionId));
    const diasEsp = esperando.map((f) => f.diasEnGestion);
    expect(diasEsp).toEqual([...diasEsp].sort((a, b) => b - a));
    const codigosEsp = new Set(esperando.map((f) => f.codigo));
    expect(codigosEsp.has('ESC-E-104'), 'la mas nueva pero con mas dias en gestion sale en el recorte').toBe(true);
    // lo que queda fuera son las de menos dias en gestion: ninguna supera a la ultima que se muestra
    const fuera = esperandoTodas.slice(TOPE_ESPERANDO);
    expect(fuera).toHaveLength(resumenAdmin.esperandoAOtros - TOPE_ESPERANDO);
    for (const f of fuera) expect(f.diasEnGestion).toBeLessThanOrEqual(diasEsp.at(-1)!);
  }, 280_000);
});
