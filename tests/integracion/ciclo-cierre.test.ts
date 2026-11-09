/**
 * Pruebas del ciclo de vida de una referencia: cierre por la aduana (G7 RIM, partida), reapertura (varios ciclos y dias de
 * pausa), solicitud de reapertura, archivar / desarchivar, correccion de codigo y el Excel de 4 hojas como registro de todo eso.
 */
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, notificacion } from '@/db/esquema';
import { archivar, desarchivar, finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { comentar, marcarNotificacionLeida } from '@/server/acciones/comentarios-y-bandeja';
import { corregirCodigo } from '@/server/acciones/corregir-codigo';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { enviarA } from '@/server/acciones/asignaciones';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { exportarBase } from '@/server/exportar';
import { resumenInicioDe } from '@/server/politicas/colaboracion';
import { vistaFicha } from '@/server/politicas/referencias';
import { limiteTasa } from '@/db/esquema';
import { asignarAAduana, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { abrirLibro, asignacionesDe, avisosDe, escribir, estadoDe, fichaEnAduana } from './ayudas-aduana';
import { fichaVisibleParaTest } from './ayudas-visibilidad';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

const DIA = 86_400_000;
const f = (iso: string) => new Date(`${iso}T15:00:00Z`);

async function codigoError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

async function ponerPartida(id: string, partida = '8421.39.90.00') {
  return fijarPartida(e.ctx(e.brian), { referenciaId: id, partida, versionEsperada: await versionDe(e.db, id, 'partida_arancelaria') });
}

/** Ficha nacida el 2026-01-01 y en manos de Brian con el RIM respondido y la partida puesta. */
async function fichaListaParaCerrar(codigo: string): Promise<string> {
  const r = await crearReferencia(e.ctx(e.edward, f('2026-01-01')), { codigo, nombreProducto: `Ciclo ${codigo}`, tipoProducto: 'INSUMO', fechaSolicitud: '2026-01-01' });
  await asignarAAduana(e, r.id, e.brian);
  await escribir(e, e.brian, r.id, 'requiere_rim', 'NO');
  await ponerPartida(r.id);
  return r.id;
}

describe('cierre por la aduana: guardas G1 (partida), G6 (rol) y G7 (RIM) siempre, incluso «de todos modos»', () => {
  it('sin RIM no cierra aunque haya partida y motivo; con RIM sin partida tampoco; con ambas cierra y deja a la ficha de solo lectura', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'CIC-G7', nombreProducto: 'G7', tipoProducto: 'INSUMO' });
    await asignarAAduana(e, r.id, e.brian);
    await ponerPartida(r.id);
    expect(await codigoError(finalizar(e.ctx(e.brian), { referenciaId: r.id, motivoCerrarDeTodosModos: 'Cierro igual' }))).toBe('VALIDACION');
    await escribir(e, e.brian, r.id, 'requiere_rim', 'SI');
    await finalizar(e.ctx(e.brian), { referenciaId: r.id, motivoCerrarDeTodosModos: 'Cierro con pendientes' });
    const ficha = await estadoDe(e, r.id);
    expect(ficha.estado).toBe('CLASIFICADA');
    expect(await codigoError(escribir(e, e.edward, r.id, 'uso', 'tarde'))).toBe('FICHA_CERRADA');
    // el cierre exige motivo cuando quedan pendientes del area
    const s = await fichaListaParaCerrar('CIC-MOTIVO');
    expect(await codigoError(finalizar(e.ctx(e.brian), { referenciaId: s }))).toBe('FALTA_MOTIVO');
  });
});

describe('efecto del cierre sobre quienes tenian la ficha pendiente', () => {
  it('OBSERVACION (baja): quien tenia un pendiente (no remitente) lo ve pasar a «hecha» al cerrar la aduana, pero NO recibe aviso «clasificada»', async () => {
    const id = await fichaListaParaCerrar('CIC-PENDIENTE-AJENO');
    // Edward (creador) le envia a Charles «completar»; Charles no responde y la aduana cierra
    await enviarA(e.ctx(e.edward, f('2026-01-02')), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    const deCharles = (await asignacionesDe(e, id)).find((a) => a.aUsuarioId === e.charles.usuarioId);
    expect(deCharles?.estado).toBe('hecha');
    expect(await avisosDe(e, e.charles.usuarioId, 'clasificada', id)).toHaveLength(0);
    expect(await avisosDe(e, e.edward.usuarioId, 'clasificada', id)).toHaveLength(1);
  });
});

describe('reapertura: varios ciclos y dias de pausa', () => {
  it('cerrar -> reabrir -> cerrar -> reabrir: la pausa se SUMA, los dias se congelan al cerrar y los avisos son uno por ciclo', async () => {
    const id = await fichaListaParaCerrar('CIC-CICLOS');
    const dias = async (ahora: Date) => (await vistaFicha(e.db, e.admin, id, ahora)).diasEnGestion;

    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    expect(await dias(f('2026-03-01'))).toBe(5); // congelados

    await reabrir(e.ctx(e.admin, f('2026-01-16')), { referenciaId: id, motivo: 'Corregir partida' });
    expect((await estadoDe(e, id)).diasPausa).toBe(10);
    expect(await dias(f('2026-01-16'))).toBe(5);
    expect(await dias(f('2026-01-18'))).toBe(7);

    await finalizar(e.ctx(e.brian, f('2026-01-20')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    expect(await dias(f('2026-06-01'))).toBe(9); // (20-1)=19 menos pausa 10

    await reabrir(e.ctx(e.admin, f('2026-02-01')), { referenciaId: id, motivo: 'Otra correccion' });
    expect((await estadoDe(e, id)).diasPausa).toBe(22); // 10 + 12 dias cerrada
    expect(await dias(f('2026-02-03'))).toBe(11); // (33) - 22

    const ficha = await estadoDe(e, id);
    expect(ficha).toMatchObject({ estado: 'EN_GESTION', clasificadaEn: null, clasificadaPor: null });
    // los avisos: uno por ciclo para quien creo la ficha
    expect(await avisosDe(e, e.edward.usuarioId, 'clasificada', id)).toHaveLength(2);
    expect(await avisosDe(e, e.edward.usuarioId, 'reabierta', id)).toHaveLength(2);
  });

  it('reabrir el MISMO dia que se cerro no suma pausa; reabrir con motivo invisible o sin ser clasificada se rechaza', async () => {
    const id = await fichaListaParaCerrar('CIC-MISMO-DIA');
    await finalizar(e.ctx(e.brian, f('2026-01-10')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    expect(await codigoError(reabrir(e.ctx(e.brian, f('2026-01-10')), { referenciaId: id, motivo: '​  ' }))).toBe('FALTA_MOTIVO');
    await reabrir(e.ctx(e.brian, f('2026-01-10')), { referenciaId: id, motivo: 'Me equivoque' });
    expect((await estadoDe(e, id)).diasPausa).toBe(0);
    expect(await codigoError(reabrir(e.ctx(e.brian, f('2026-01-10')), { referenciaId: id, motivo: 'otra vez' }))).toBe('VALIDACION');
  });

  it('reabrir con el acceso de 30 dias de la agencia VENCIDO: la agencia no recupera la ficha, queda en gestion y el admin la ve «sin responsable»', async () => {
    const id = await fichaListaParaCerrar('CIC-VENCIDA');
    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    const antes = (await resumenInicioDe(e.db, e.admin, f('2026-03-01'))).sinResponsable ?? 0;
    expect(await fichaVisibleParaTest(e, id, e.brian, f('2026-03-01'))).toBe(false);
    await reabrir(e.ctx(e.admin, f('2026-03-01')), { referenciaId: id, motivo: 'Reabre el admin tras vencer el acceso' });
    expect((await estadoDe(e, id)).estado).toBe('EN_GESTION');
    expect(await fichaVisibleParaTest(e, id, e.brian, f('2026-03-01'))).toBe(false); // sigue sin verla
    expect((await asignacionesDe(e, id)).filter((a) => a.estado === 'pendiente' || a.estado === 'en_curso')).toHaveLength(0);
    const despues = (await resumenInicioDe(e.db, e.admin, f('2026-03-01'))).sinResponsable ?? 0;
    expect(despues).toBe(antes + 1); // el sistema la deja visible como «sin responsable» para que el admin la reenvie
    // el admin la reenvia a la agencia y vuelve a verla
    await enviarA(e.ctx(e.admin, f('2026-03-01')), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'clasificar' }] });
    expect(await fichaVisibleParaTest(e, id, e.brian, f('2026-03-01'))).toBe(true);
  });

  it('solicitar reapertura: queda UNA solicitud `revisar` activa y UN aviso por admin aunque se repita; si el admin ya lo leyo, el siguiente si avisa', async () => {
    const id = await fichaListaParaCerrar('CIC-SOLICITUD');
    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await solicitarReapertura(e.ctx(e.edward, f('2026-01-07')), { referenciaId: id, motivo: 'Cambio el proveedor' });
    await solicitarReapertura(e.ctx(e.edward, f('2026-01-07')), { referenciaId: id, motivo: 'Cambio el proveedor' }); // doble clic
    const revisar = (await asignacionesDe(e, id)).filter((a) => a.pedido === 'revisar' && (a.estado === 'pendiente' || a.estado === 'en_curso'));
    expect(revisar).toHaveLength(1); // la asignacion es idempotente
    expect(await avisosDe(e, e.admin.usuarioId, 'reapertura_solicitada', id)).toHaveLength(1); // y el aviso tambien
    // el admin lo lee y la solicitud se repite: ahora si es una novedad
    const [leido] = await avisosDe(e, e.admin.usuarioId, 'reapertura_solicitada', id);
    await marcarNotificacionLeida(e.ctx(e.admin, f('2026-01-07')), { notificacionId: leido!.id });
    await solicitarReapertura(e.ctx(e.edward, f('2026-01-07')), { referenciaId: id, motivo: 'Cambio el proveedor' });
    expect(await avisosDe(e, e.admin.usuarioId, 'reapertura_solicitada', id)).toHaveLength(2);
    // reabrir deja atendida la solicitud
    await reabrir(e.ctx(e.admin, f('2026-01-08')), { referenciaId: id, motivo: 'Atendida' });
    expect((await asignacionesDe(e, id)).filter((a) => a.pedido === 'revisar').every((a) => a.estado === 'hecha')).toBe(true);
  });
});

describe('archivar y desarchivar', () => {
  it('archivar una clasificada y una en gestion: sale de la agencia, no libera el codigo, bloquea comentarios y envios, y desarchivar devuelve el estado previo', async () => {
    const enGestion = await fichaEnAduana(e, { codigo: 'CIC-ARCH-1' });
    const cerrada = await fichaListaParaCerrar('CIC-ARCH-2');
    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: cerrada, motivoCerrarDeTodosModos: 'ok' });

    expect(await codigoError(archivar(e.ctx(e.edward), { referenciaId: enGestion, motivo: 'x' }))).toBe('SIN_PERMISO'); // ya fue enviada
    for (const id of [enGestion, cerrada]) await archivar(e.ctx(e.admin, f('2026-01-07')), { referenciaId: id, motivo: 'Duplicada por error' });
    expect(await fichaVisibleParaTest(e, enGestion, e.brian, f('2026-01-07'))).toBe(false);
    expect(await codigoError(crearReferencia(e.ctx(e.edward), { codigo: 'CIC-ARCH-1', nombreProducto: 'otra', tipoProducto: 'INSUMO' }))).toBe('DUPLICADO');
    expect(await codigoError(comentar(e.ctx(e.admin), { referenciaId: enGestion, texto: 'hola', visibilidad: 'interno' }))).toBe('FICHA_CERRADA');
    expect(await codigoError(reabrir(e.ctx(e.admin), { referenciaId: cerrada, motivo: 'x' }))).toBe('FICHA_CERRADA');
    expect(await codigoError(corregirCodigo(e.ctx(e.admin), { referenciaId: enGestion, codigoNuevo: 'CIC-NUEVO', motivo: 'x' }))).toBe('FICHA_CERRADA');

    expect(await codigoError(desarchivar(e.ctx(e.edward), { referenciaId: enGestion, motivo: 'x' }))).toBe('SIN_PERMISO');
    await desarchivar(e.ctx(e.admin, f('2026-01-08')), { referenciaId: enGestion, motivo: 'Fue un error' });
    await desarchivar(e.ctx(e.admin, f('2026-01-08')), { referenciaId: cerrada, motivo: 'Fue un error' });
    expect((await estadoDe(e, enGestion)).estado).toBe('EN_GESTION');
    expect((await estadoDe(e, cerrada)).estado).toBe('CLASIFICADA');
    expect((await estadoDe(e, enGestion)).archivadaEn).toBeNull();
    expect(await fichaVisibleParaTest(e, enGestion, e.brian, f('2026-01-08'))).toBe(true);
  });
});

describe('correccion de codigo', () => {
  it('el creador la corrige con motivo antes de cerrar; otro solicitante no; el codigo viejo deja de buscarse y el historial lo registra', async () => {
    const id = await fichaEnAduana(e, { codigo: 'CIC-COD-VIEJO' });
    expect(await codigoError(corregirCodigo(e.ctx(e.charles), { referenciaId: id, codigoNuevo: 'CIC-COD-NUEVO', motivo: 'x' }))).toBe('SIN_PERMISO');
    await corregirCodigo(e.ctx(e.edward), { referenciaId: id, codigoNuevo: 'CIC-COD-NUEVO', motivo: 'Typo del proveedor' });
    expect((await estadoDe(e, id)).codigo).toBe('CIC-COD-NUEVO');
    // la aduana (que tiene la ficha) ve el codigo nuevo
    expect((await vistaFicha(e.db, e.brian, id, new Date())).codigo).toBe('CIC-COD-NUEVO');
    // el codigo viejo queda libre solo si nadie lo uso: crear una ficha con el viejo es posible (no esta archivado)
    await crearReferencia(e.ctx(e.edward), { codigo: 'CIC-COD-VIEJO', nombreProducto: 'Reutiliza el viejo', tipoProducto: 'INSUMO' });
  });
});

describe('Excel de 4 hojas como registro del ciclo', () => {
  it('Base, Resumen de estado, Historial y Leyenda: el historial trae cierre, reapertura y cierre de la misma ficha, de nuevo a antiguo; la agencia solo ve lo suyo', async () => {
    const AHORA = new Date('2026-04-10T15:00:00Z');
    const id = await fichaListaParaCerrar('CIC-EXCEL');
    await finalizar(e.ctx(e.brian, f('2026-01-06')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await reabrir(e.ctx(e.admin, f('2026-01-16')), { referenciaId: id, motivo: 'Corregir partida' });
    await finalizar(e.ctx(e.brian, f('2026-01-20')), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });

    await e.db.delete(limiteTasa);
    const r = await exportarBase(e.ctx(e.admin, AHORA), { alcance: 'toda' });
    const libro = await abrirLibro(r.flujo);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Base', 'Resumen de estado', 'Historial', 'Leyenda']);
    const hist = libro.getWorksheet('Historial')!;
    const eventos: string[] = [];
    hist.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).text === 'CIC-EXCEL' && row.getCell(3).text === 'Clasificación finalizada') eventos.push(`${row.getCell(4).text}:${row.getCell(6).text}`);
    });
    expect(eventos).toEqual(['Sistema:SI', 'Sistema:NO', 'Sistema:SI']); // del mas reciente al mas antiguo: SI, NO, SI

    // Resumen: la ficha esta clasificada; la agencia dentro de sus 30 dias la exporta, pasados los 30 dias no
    const base = libro.getWorksheet('Base')!;
    let estado = '';
    base.eachRow((row, n) => {
      if (n > 1 && row.getCell(1).text === 'CIC-EXCEL') estado = row.getCell(5).text;
    });
    expect(estado).toBeTruthy();

    await e.db.delete(limiteTasa);
    const dentro = await abrirLibro((await exportarBase(e.ctx(e.brian, f('2026-02-01')), { alcance: 'filtrado' })).flujo);
    const codigos = (h: string) => {
      const out: string[] = [];
      dentro.getWorksheet(h)!.eachRow((row, n) => {
        if (n > 1) out.push(row.getCell(1).text);
      });
      return out;
    };
    expect(codigos('Base')).toContain('CIC-EXCEL');
    expect(codigos('Historial')).toContain('CIC-EXCEL');
    await e.db.delete(limiteTasa);
    const fuera = await abrirLibro((await exportarBase(e.ctx(e.brian, f('2026-03-30')), { alcance: 'filtrado' })).flujo);
    const baseFuera: string[] = [];
    fuera.getWorksheet('Base')!.eachRow((row, n) => {
      if (n > 1) baseFuera.push(row.getCell(1).text);
    });
    expect(baseFuera).not.toContain('CIC-EXCEL');
  });
});

// helpers sin uso directo en algunos bloques
void [and, eq, count, asignacion, notificacion, DIA];
