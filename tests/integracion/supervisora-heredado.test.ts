/**
 * Lo operativo que la supervisora general hereda del administrador (`esGestor`), con prueba positiva suya y la
 * negativa de un rol sin ese permiso, para que un cambio de `esGestor` por `rol === 'admin'` (o al reves) falle.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { cancelarAsignacion, enviarA, reasignar, recordar } from '@/server/acciones/asignaciones';
import { leerAdjunto, retirarAdjunto, subirAdjunto } from '@/server/acciones/adjuntos';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { contarExportable } from '@/server/exportar';
import { esperandoDe, resumenInicioDe } from '@/server/politicas/colaboracion';
import type { Almacen } from '@/server/almacen/tipos';
import type { Actor } from '@/server/politicas/actor';
import { asignarAAduana, crearSupervisora, nuevaFicha, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { asignacionesDe, d } from './ayudas-colab';

let e: Escenario;
let angie: Actor;
const T0 = new Date('2026-10-21T15:00:00.000Z');

beforeAll(async () => {
  e = await nuevoEscenario();
  angie = await crearSupervisora(e);
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoDe(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'OK';
}

function almacenFalso(): Almacen {
  const mapa = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    nombre: 'local',
    async guardar(clave, bytes, mime) {
      mapa.set(clave, { bytes, mime });
    },
    async leer(clave) {
      return mapa.get(clave) ?? null;
    },
  };
}

const jpeg = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 90, b: 170 } } }).jpeg().toBuffer();

const escribir = async (ficha: string, campo: string, valor: unknown, quien: Actor, motivo?: string) =>
  guardarCampo(e.ctx(quien), { referenciaId: ficha, campo, valor, versionEsperada: await versionDe(e.db, ficha, campo), ...(motivo ? { motivo } : {}) });

describe('fotos', () => {
  it('retira la foto de otra persona (con motivo) y lee las retiradas; el solicitante ajeno ni una ni otra', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'p.jpg', almacen });
    expect(await codigoDe(retirarAdjunto(e.ctx(e.charles), { adjuntoId: a.id, motivo: 'No me gusta' }))).toBe('SIN_PERMISO');
    expect(await codigoDe(retirarAdjunto(e.ctx(angie), { adjuntoId: a.id, motivo: 'Se ve borrosa' }))).toBe('OK');
    expect(await codigoDe(leerAdjunto(e.ctx(angie), a.id, { miniatura: false, almacen }))).toBe('OK');
    expect(await codigoDe(leerAdjunto(e.ctx(e.charles), a.id, { miniatura: false, almacen }))).toBe('NO_ENCONTRADO');
  });
});

describe('escritura de campos', () => {
  it('vacia un valor ajeno solo con motivo; el solicitante ajeno no puede', async () => {
    const f = await nuevaFicha(e);
    await escribir(f, 'uso', 'De Edward', e.edward);
    expect(await codigoDe(escribir(f, 'uso', '', e.charles, 'quiero borrarlo'))).toBe('SIN_PERMISO');
    expect(await codigoDe(escribir(f, 'uso', '', angie))).toBe('FALTA_MOTIVO');
    expect(await codigoDe(escribir(f, 'uso', '', angie, 'Duplicado en otro campo'))).toBe('OK');
  });

  it('cambia la fecha de solicitud de una ficha ajena; el solicitante que no la creo no puede', async () => {
    const f = await nuevaFicha(e);
    expect(await codigoDe(escribir(f, 'fecha_solicitud', '2026-10-01', e.charles, 'Corrijo la fecha'))).toBe('SIN_PERMISO');
    expect(await codigoDe(escribir(f, 'fecha_solicitud', '2026-10-01', angie, 'Corrijo la fecha'))).toBe('OK');
  });
});

describe('envios: segunda agencia, cancelar, reasignar y recordar', () => {
  it('agrega una segunda agencia a una ficha que ya tiene una; el solicitante no', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    expect(await codigoDe(enviarA(e.ctx(e.edward, T0), { referenciaId: f, destinatarios: [{ usuarioId: e.brianB.usuarioId }] }))).toBe('SIN_PERMISO');
    const r = await enviarA(e.ctx(angie, T0), { referenciaId: f, destinatarios: [{ usuarioId: e.brianB.usuarioId }] });
    expect(r.creadas).toBe(1);
  });

  it('recuerda, reasigna y cancela un envio ajeno; el solicitante que no lo envio no', async () => {
    const f = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: f, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    const [a] = await asignacionesDe(e.db, f);
    const id = a!.id;
    expect(await codigoDe(recordar(e.ctx(e.charles, T0), { asignacionId: id }))).toBe('SIN_PERMISO');
    expect(await codigoDe(reasignar(e.ctx(e.charles, T0), { asignacionId: id, aUsuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    expect(await codigoDe(cancelarAsignacion(e.ctx(e.charles, T0), { asignacionId: id }))).toBe('SIN_PERMISO');

    expect(await codigoDe(recordar(e.ctx(angie, d(T0, 1)), { asignacionId: id }))).toBe('OK');
    expect(await codigoDe(reasignar(e.ctx(angie, d(T0, 2)), { asignacionId: id, aUsuarioId: e.admin.usuarioId }))).toBe('OK');
    const nueva = (await asignacionesDe(e.db, f)).find((x) => x.estado === 'pendiente')!;
    expect(await codigoDe(cancelarAsignacion(e.ctx(angie, d(T0, 3)), { asignacionId: nueva.id }))).toBe('OK');
  });
});

describe('bandeja y Excel con vista total', () => {
  it('«Esperando a otros» y el resumen del inicio incluyen lo de todos; el solicitante ajeno solo lo suyo', async () => {
    const f = await nuevaFicha(e, { codigo: 'SUP-ESP-1' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: f, destinatarios: [{ usuarioId: e.brian.usuarioId }] });

    const deAngie = (await esperandoDe(e.db, angie, T0)).find((x) => x.codigo === 'SUP-ESP-1');
    expect(deAngie).toMatchObject({ esMia: false, puedeRecordar: true, puedeGestionar: true });
    expect((await esperandoDe(e.db, e.charles, T0)).some((x) => x.codigo === 'SUP-ESP-1')).toBe(false);

    expect((await resumenInicioDe(e.db, angie, T0)).sinResponsable).not.toBeNull();
    expect((await resumenInicioDe(e.db, e.edward, T0)).sinResponsable).toBeNull();
  });

  it('el Excel de la supervisora trae toda la base (como el administrador); el de la aduana solo lo suyo', async () => {
    const f = await nuevaFicha(e, { codigo: 'SUP-XLS-1' });
    await asignarAAduana(e, f, e.brian);
    await nuevaFicha(e, { codigo: 'SUP-XLS-2' });
    const deAngie = await contarExportable(e.ctx(angie, T0), undefined);
    const deAdmin = await contarExportable(e.ctx(e.admin, T0), undefined);
    const deBrianB = await contarExportable(e.ctx(e.brianB, T0), undefined);
    expect(deAngie.toda).toBe(deAdmin.toda);
    expect(deAngie.toda).toBeGreaterThan(deBrianB.toda);
  });
});
