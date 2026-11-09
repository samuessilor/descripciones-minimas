/**
 * Cierre de la clasificacion y ciclo de vida (H4): P-05 (G1/G6, A1-A3, "cerrar de todos modos", CIERRE_MODO),
 * P-13 / CA-33 (dias en gestion congelan y reanudan), CA-10 (reabrir), solicitar reapertura, archivar y aislamiento.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, partidaArancelaria } from '@/db/esquema';
import { archivar, desarchivar, finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { reiniciarConfig } from '@/server/config';
import { historialDeFichaDe } from '@/server/politicas/colaboracion';
import { vistaAduana } from '@/server/politicas/aduana';
import { vistaFicha } from '@/server/politicas/referencias';
import { asignarAAduana, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { asignacionesDe, avisosDe, escribir, estadoDe, fichaEnAduana, historialDe } from './ayudas-aduana';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});
afterEach(() => {
  delete process.env.CIERRE_MODO;
  reiniciarConfig();
});

async function fallo(p: Promise<unknown>): Promise<ErrorAccion> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err;
    throw err;
  }
  throw new Error('se esperaba un ErrorAccion y no fallo');
}

async function ponerPartida(id: string, partida = '8421.39.90.00', actor = e.brian) {
  return fijarPartida(e.ctx(actor), { referenciaId: id, partida, versionEsperada: await versionDe(e.db, id, 'partida_arancelaria') });
}

/** La aduana no necesita informacion adicional ni tiene observaciones («No aplica»): sin advertencias A2/A3 por eso. */
async function describir(id: string) {
  await escribir(e, e.brian, id, 'descripciones_minimas', { no_aplica: true });
  await escribir(e, e.brian, id, 'observaciones_aduana', { no_aplica: true });
}

describe('finalizar: guardas duras (G1, G6)', () => {
  it('G1: sin partida no cierra, dice que falta y no cambia nada', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    const antes = await estadoDe(e, id);
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id }));
    expect(err.codigo).toBe('VALIDACION');
    expect(err.message).toMatch(/partida/i);
    expect((err.detalle as { bloqueos: Array<{ regla: string }> }).bloqueos.map((b) => b.regla)).toContain('G1');
    const despues = await estadoDe(e, id);
    expect(despues.estado).toBe('EN_GESTION');
    expect(despues.version).toBe(antes.version);
  });

  it('G6: el solicitante no puede cerrar (ni siquiera con partida)', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    const err = await fallo(finalizar(e.ctx(e.edward), { referenciaId: id }));
    expect(err.codigo).toBe('SIN_PERMISO');
    expect((await estadoDe(e, id)).estado).toBe('EN_GESTION');
  });

  it('G6: una ficha de otra agencia no existe para la aduana B (404)', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    const err = await fallo(finalizar(e.ctx(e.brianB), { referenciaId: id }));
    expect(err.codigo).toBe('NO_ENCONTRADO');
  });

  it('un borrador sin enviar no se cierra', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'TEST-BORR-1', nombreProducto: 'Borrador', tipoProducto: 'INSUMO' });
    const err = await fallo(finalizar(e.ctx(e.admin), { referenciaId: r.id }));
    expect(err.codigo).toBe('VALIDACION');
    expect(err.message).toMatch(/borrador/i);
  });
});

describe('finalizar: advertencias A1-A3 y "cerrar de todos modos"', () => {
  it('lista exactamente lo que falta y exige motivo; con motivo cierra y lo deja en el historial', async () => {
    const id = await fichaEnAduana(e, { rim: 'NO' }); // sin llenar: faltan campos del area; sin restricciones
    await ponerPartida(id, '8479.90.00.00'); // restricciones se prellena desde el catalogo; descripciones minimas vacias
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id }));
    expect(err.codigo).toBe('FALTA_MOTIVO');
    const adv = (err.detalle as { advertencias: Array<{ regla: string; detalle: string[] }> }).advertencias;
    const a1 = adv.find((a) => a.regla === 'A1');
    expect(a1?.detalle).toContain('Nombre comercial');
    // El RIM ya no es del area: lo responde la aduana y su falta es una guarda dura (G7), no un campo del area.
    expect(a1?.detalle).not.toContain('¿Requiere registro de importación (RIM)?');
    expect(adv.find((a) => a.regla === 'A2')).toMatchObject({ mensaje: 'Las descripciones mínimas adicionales están vacías' });
    // La restriccion se prellenó; las observaciones siguen vacias.
    expect(adv.filter((a) => a.regla === 'A3').map((a) => (a as { mensaje?: string }).mensaje)).toEqual(['Las observaciones de la aduana están vacías']);
    expect((await estadoDe(e, id)).estado).toBe('EN_GESTION');

    const r = await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'La agencia ya lo despachó, el área completa después.' });
    expect(r.estado).toBe('CLASIFICADA');
    expect(r.advertencias.length).toBeGreaterThanOrEqual(2);

    const fin = await historialDe(e, id, 'clasificacion_finalizada');
    expect(fin[0]).toMatchObject({ valor: 'SI', tipoEvento: 'sistema', autorId: e.brian.usuarioId });
    expect(fin[0]?.motivo).toContain('Cerrada de todos modos');
    expect(fin[0]?.motivo).toContain('Nombre comercial');
    expect(fin[0]?.motivo).toContain('Las descripciones mínimas adicionales están vacías');
    expect(fin[0]?.motivo).toContain('La agencia ya lo despachó');
  });

  it('A3: corregir a una partida sin restriccion vacia la copia sin tocar de la anterior (lo editado se conserva)', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    expect((await ponerPartida(id, '8501.31.20.00')).restriccionPrellenada).toBe(true);
    await ponerPartida(id, '8501.40.10.00'); // partida libre: sin restriccion en el catalogo
    expect((await estadoDe(e, id)).datos.restricciones?.v ?? null).toBeNull();
    await describir(id);
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id }));
    expect(err.codigo).toBe('FALTA_MOTIVO');
    const adv = (err.detalle as { advertencias: Array<{ regla: string }> }).advertencias;
    expect(adv.map((a) => a.regla)).toEqual(['A3']);

    // Si la aduana ya edito la restriccion, cambiar de partida no la toca.
    const id2 = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id2, '8501.31.20.00');
    await escribir(e, e.brian, id2, 'restricciones', 'Texto propio de la aduana');
    await ponerPartida(id2, '8501.40.10.00');
    expect((await estadoDe(e, id2)).datos.restricciones?.v).toBe('Texto propio de la aduana');
  });

  it('un motivo hecho solo de caracteres invisibles no cuenta', async () => {
    const id = await fichaEnAduana(e, { rim: 'NO' });
    await ponerPartida(id);
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: '​  ​' }));
    expect(err.codigo).toBe('FALTA_MOTIVO');
  });

  it('sin advertencias cierra con la confirmacion normal, sin motivo', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await describir(id);
    const r = await finalizar(e.ctx(e.brian), { referenciaId: id });
    expect(r.advertencias).toEqual([]);
    const fin = await historialDe(e, id, 'clasificacion_finalizada');
    expect(fin[0]?.motivo).toBeNull();
  });

  it('CIERRE_MODO=bloquear: las advertencias vuelven a ser guardas duras (aun con motivo)', async () => {
    process.env.CIERRE_MODO = 'bloquear';
    reiniciarConfig();
    const id = await fichaEnAduana(e, { rim: 'NO' });
    await ponerPartida(id);
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'insisto' }));
    expect(err.codigo).toBe('VALIDACION');
    const bloqueos = (err.detalle as { bloqueos: Array<{ regla: string }> }).bloqueos.map((b) => b.regla);
    expect(bloqueos).toEqual(expect.arrayContaining(['A1']));
    expect((await estadoDe(e, id)).estado).toBe('EN_GESTION');
  });
});

describe('RIM: lo responde la aduana y es obligatorio para cerrar (reunion 2026-11)', () => {
  it('la aduana y el admin pueden escribir el RIM; el solicitante no', async () => {
    const id = await fichaEnAduana(e, { llena: true, rim: false });
    const v = await vistaAduana(e.db, e.brian, id, new Date());
    expect(v.requiereRim).toBeNull();
    expect(v.permisos.editar).toBe(true);
    expect((await vistaAduana(e.db, e.edward, id, new Date())).permisos.editar).toBe(false);

    expect((await fallo(escribir(e, e.edward, id, 'requiere_rim', 'SI'))).codigo).toBe('SIN_PERMISO');
    expect((await estadoDe(e, id)).datos.requiere_rim).toBeUndefined();

    await escribir(e, e.brian, id, 'requiere_rim', 'Sí'); // se normaliza a SI
    const despues = await vistaAduana(e.db, e.brian, id, new Date());
    expect(despues.requiereRim).toMatchObject({ valor: 'SI', propio: true, version: 1 });

    // El admin corrige lo de la aduana: valor ajeno, exige motivo.
    expect((await fallo(escribir(e, e.admin, id, 'requiere_rim', 'NO'))).codigo).toBe('FALTA_MOTIVO');
    await escribir(e, e.admin, id, 'requiere_rim', 'NO', 'Comercio Exterior confirmó que no lo requiere.');
    expect((await vistaAduana(e.db, e.brian, id, new Date())).requiereRim?.valor).toBe('NO');
    expect((await historialDe(e, id, 'requiere_rim')).map((h) => h.valor)).toEqual(['NO', 'SI']);
  });

  it('cerrar sin responder el RIM falla con un mensaje claro, aunque haya motivo, y la ficha no cambia', async () => {
    const id = await fichaEnAduana(e, { llena: true, rim: false });
    await ponerPartida(id);
    await describir(id);
    const antes = await estadoDe(e, id);

    // La vista previa ya lo dice y lo manda a completar.
    const previa = await vistaAduana(e.db, e.brian, id, new Date());
    expect(previa.cierre.ok).toBe(false);
    expect(previa.cierre.bloqueos.map((b) => b.regla)).toEqual(['G7']);

    for (const motivo of [undefined, 'La agencia ya despachó.']) {
      const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id, ...(motivo ? { motivoCerrarDeTodosModos: motivo } : {}) }));
      expect(err.codigo).toBe('VALIDACION');
      expect(err.message).toMatch(/RIM/);
      expect(err.message).toMatch(/Requiere registro de importación/);
      expect((err.detalle as { bloqueos: Array<{ regla: string }> }).bloqueos.map((b) => b.regla)).toEqual(['G7']);
    }
    const despues = await estadoDe(e, id);
    expect(despues.estado).toBe('EN_GESTION');
    expect(despues.version).toBe(antes.version);

    // Tambien el admin: no es un permiso, es un dato que falta.
    expect((await fallo(finalizar(e.ctx(e.admin), { referenciaId: id }))).codigo).toBe('VALIDACION');

    // Con el RIM respondido cierra limpia.
    await escribir(e, e.brian, id, 'requiere_rim', 'SI');
    expect((await vistaAduana(e.db, e.brian, id, new Date())).cierre.ok).toBe(true);
    const r = await finalizar(e.ctx(e.brian), { referenciaId: id });
    expect(r.estado).toBe('CLASIFICADA');
    expect(r.advertencias).toEqual([]);
  });

  it('sin RIM y sin partida, el mensaje nombra las dos faltas', async () => {
    const id = await fichaEnAduana(e, { llena: true, rim: false });
    const err = await fallo(finalizar(e.ctx(e.brian), { referenciaId: id }));
    expect(err.message).toMatch(/partida/i);
    expect(err.message).toMatch(/RIM/);
    expect((err.detalle as { bloqueos: Array<{ regla: string }> }).bloqueos.map((b) => b.regla)).toEqual(['G1', 'G7']);
  });

  it('el RIM sin responder cuenta como pendiente de la aduana en la ficha, no del area', async () => {
    const id = await fichaEnAduana(e, { llena: true, rim: false });
    const c = (await vistaFicha(e.db, e.edward, id, new Date())).completitud;
    expect(c.aduana.faltantes).toContain('requiere_rim');
    expect(c.area.completo).toBe(true);
    await escribir(e, e.brian, id, 'requiere_rim', 'NO');
    expect((await vistaFicha(e.db, e.edward, id, new Date())).completitud.aduana.faltantes).not.toContain('requiere_rim');
  });
});

describe('finalizar: efectos', () => {
  it('estado verde, quien y cuando, partida nueva dada de alta, asignaciones y avisos (sin clasificadores)', async () => {
    const ahora = new Date('2026-10-21T15:00:00Z');
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id, '9999.99.99.99'); // partida libre: no esta en el catalogo
    const r = await finalizar(e.ctx(e.brian, ahora), { referenciaId: id, motivoCerrarDeTodosModos: 'Partida nueva.' });
    expect(r.estado).toBe('CLASIFICADA');

    const f = await estadoDe(e, id);
    expect(f.estado).toBe('CLASIFICADA');
    expect(f.clasificadaPor).toBe(e.brian.usuarioId);
    expect(f.clasificadaEn?.toISOString()).toBe(ahora.toISOString());

    // G1: la partida libre queda en el catalogo con origen `aduana` y su autor.
    const [p] = await e.db.select().from(partidaArancelaria).where(eq(partidaArancelaria.codigo, '9999.99.99.99'));
    expect(p).toMatchObject({ origen: 'aduana', creadaPor: e.brian.usuarioId });

    // Los clasificadores se retiraron: quien cierra queda en `clasificada_por` y no se escribe ningun clasificador.
    expect(f.datos.primer_clasificador).toBeUndefined();

    // Asignaciones: hecha; la de la agencia con acceso por 30 dias.
    const asigs = await asignacionesDe(e, id);
    expect(asigs.every((a) => a.estado === 'hecha')).toBe(true);
    const hasta = asigs.find((a) => a.aUsuarioId === e.brian.usuarioId)?.accesoHasta;
    expect(hasta?.getTime()).toBe(ahora.getTime() + 30 * 86_400_000);

    // Aviso `clasificada` a quien creo la ficha, no a quien cierra.
    expect(await avisosDe(e, e.edward.usuarioId, 'clasificada', id)).toHaveLength(1);
    expect(await avisosDe(e, e.brian.usuarioId, 'clasificada', id)).toHaveLength(0);

    // Auditoria.
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'finalizar'), eq(auditoria.entidadId, id)));
    expect(aud?.usuarioId).toBe(e.brian.usuarioId);
  });

  it('la ficha cerrada es de solo lectura, pero la agencia la sigue viendo 30 dias y despues no', async () => {
    const ahora = new Date('2026-10-21T15:00:00Z');
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian, ahora), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });

    const err = await fallo(escribir(e, e.brian, id, 'observaciones_aduana', 'tarde'));
    expect(err.codigo).toBe('FICHA_CERRADA');
    expect((await fallo(finalizar(e.ctx(e.brian), { referenciaId: id }))).codigo).toBe('FICHA_CERRADA');

    const dentro = new Date(ahora.getTime() + 29 * 86_400_000);
    const v = await vistaFicha(e.db, e.brian, id, dentro);
    expect(v.color).toBe('verde');
    expect(v.etiqueta).toBe('Clasificada');
    const fuera = new Date(ahora.getTime() + 31 * 86_400_000);
    expect((await fallo(vistaFicha(e.db, e.brian, id, fuera))).codigo).toBe('NO_ENCONTRADO');
  });

  it('el historial queda intacto: cada valor anterior sigue ahi', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id, '8479.90.00.00');
    await escribir(e, e.brian, id, 'restricciones', 'Texto A de la aduana');
    await escribir(e, e.brian, id, 'restricciones', 'Texto B de la aduana');
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    const h = await historialDe(e, id, 'restricciones');
    expect(h.map((x) => x.versionCampo)).toEqual([3, 2, 1]);
    expect(h.map((x) => (typeof x.valor === 'string' ? x.valor.slice(0, 7) : x.valor))).toEqual(['Texto B', 'Texto A', 'Sin Res']);
  });
});

describe('dias en gestion (P-13 / CA-33)', () => {
  it('se congelan al cerrar y, al reabrir, los dias cerrada no cuentan', async () => {
    const t0 = new Date('2026-01-01T15:00:00Z');
    const r = await crearReferencia(e.ctx(e.edward, t0), { codigo: 'TEST-DIAS-1', nombreProducto: 'Dias', tipoProducto: 'INSUMO', fechaSolicitud: '2026-01-01' });
    await asignarAAduana(e, r.id, e.brian);
    await ponerPartida(r.id);
    await escribir(e, e.brian, r.id, 'requiere_rim', 'NO');

    await finalizar(e.ctx(e.brian, new Date('2026-01-06T15:00:00Z')), { referenciaId: r.id, motivoCerrarDeTodosModos: 'ok' });
    const cerrada = await vistaFicha(e.db, e.admin, r.id, new Date('2026-07-05T15:00:00Z'));
    expect(cerrada.diasEnGestion).toBe(5); // congelados: no 185

    const abierta = new Date('2026-07-05T15:00:00Z');
    // Pasaron 180 dias: el acceso de 30 dias de la agencia ya vencio, asi que reabre un administrador.
    await reabrir(e.ctx(e.admin, abierta), { referenciaId: r.id, motivo: 'La agencia pidió corregir la partida.' });
    const f = await estadoDe(e, r.id);
    expect(f.diasPausa).toBe(180);
    expect(f.clasificadaEn).toBeNull();
    const despues = await vistaFicha(e.db, e.admin, r.id, new Date('2026-07-10T15:00:00Z'));
    expect(despues.diasEnGestion).toBe(10); // 5 de antes + 5 nuevos, no 190
  });
});

describe('reabrir', () => {
  it('exige motivo, la reabre la aduana o el admin, nunca el solicitante, y vuelve a amarillo', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });

    expect((await fallo(reabrir(e.ctx(e.brian), { referenciaId: id, motivo: '  ' }))).codigo).toBe('FALTA_MOTIVO');
    expect((await fallo(reabrir(e.ctx(e.edward), { referenciaId: id, motivo: 'quiero' }))).codigo).toBe('SIN_PERMISO');

    await reabrir(e.ctx(e.brian), { referenciaId: id, motivo: 'Cambió el proveedor.' });
    const f = await estadoDe(e, id);
    expect(f.estado).toBe('EN_GESTION');
    expect(f.clasificadaPor).toBeNull();
    expect(f.datos.partida_arancelaria?.v).toBe('8421.39.90.00'); // la partida anterior sigue

    const fin = await historialDe(e, id, 'clasificacion_finalizada');
    expect(fin[0]).toMatchObject({ valor: 'NO', tipoEvento: 'sistema' });
    expect(fin[0]?.motivo).toContain('Cambió el proveedor.');
    expect(fin[1]).toMatchObject({ valor: 'SI' }); // el cierre anterior sigue en el historial

    const v = await vistaFicha(e.db, e.brian, id, new Date());
    expect(v.color).toBe('amarillo');
    expect(v.etiqueta).toBe('Reabierta');

    // Aviso `reabierta` al creador; y Brian vuelve a tener la ficha como pendiente `clasificar`.
    expect(await avisosDe(e, e.edward.usuarioId, 'reabierta', id)).toHaveLength(1);
    const activa = (await asignacionesDe(e, id)).filter((a) => a.estado === 'en_curso' || a.estado === 'pendiente');
    expect(activa.map((a) => a.aUsuarioId)).toContain(e.brian.usuarioId);

    // Se puede volver a editar y a cerrar: una segunda clasificacion de la misma referencia.
    await escribir(e, e.brian, id, 'observaciones_aduana', 'Ajustada.');
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok de nuevo' });
    expect((await estadoDe(e, id)).estado).toBe('CLASIFICADA');
  });

  it('el cierre anterior no se «restaura» desde el historial: solo se cierra con finalizar', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await reabrir(e.ctx(e.brian), { referenciaId: id, motivo: 'Cambió el proveedor.' });

    const h = await historialDeFichaDe(e.db, e.brian, id, new Date(), { campo: 'clasificacion_finalizada' });
    expect(h.items.some((i) => i.restaurable)).toBe(false); // la interfaz no ofrece «Restaurar»
    const si = (await historialDe(e, id, 'clasificacion_finalizada')).find((f) => f.valor === 'SI')!;
    for (const actor of [e.brian, e.admin]) {
      const err = await fallo(restaurarCampo(e.ctx(actor), { referenciaId: id, campo: 'clasificacion_finalizada', historialId: si.id, motivo: 'vuelvo' }));
      expect(err.codigo).toBe('VALIDACION');
    }
    const f = await estadoDe(e, id);
    expect(f.estado).toBe('EN_GESTION');
    expect(f.datos.clasificacion_finalizada?.v).toBe('NO');
  });

  it('no se reabre lo que no esta clasificado', async () => {
    const id = await fichaEnAduana(e);
    expect((await fallo(reabrir(e.ctx(e.admin), { referenciaId: id, motivo: 'x' }))).codigo).toBe('VALIDACION');
  });

  it('el admin puede reabrir y la agencia que la tenia recibe de nuevo el pendiente', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await reabrir(e.ctx(e.admin), { referenciaId: id, motivo: 'Revisión del administrador.' });
    const activa = (await asignacionesDe(e, id)).find((a) => a.estado === 'pendiente' && a.aUsuarioId === e.brian.usuarioId);
    expect(activa?.pedido).toBe('clasificar');
    expect(await avisosDe(e, e.brian.usuarioId, 'reabierta', id)).toHaveLength(1);
  });
});

describe('solicitar reapertura', () => {
  it('la pide el solicitante: crea `revisar` para quien clasifico y avisa; no reabre sola', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });

    expect((await fallo(solicitarReapertura(e.ctx(e.brian), { referenciaId: id, motivo: 'x' }))).codigo).toBe('SIN_PERMISO');
    expect((await fallo(solicitarReapertura(e.ctx(e.edward), { referenciaId: id, motivo: ' ' }))).codigo).toBe('FALTA_MOTIVO');

    const r = await solicitarReapertura(e.ctx(e.edward), { referenciaId: id, motivo: 'El proveedor es otro.' });
    expect(r.asignadoA).toBe(e.brian.usuarioId);
    expect((await estadoDe(e, id)).estado).toBe('CLASIFICADA');

    const revisar = (await asignacionesDe(e, id)).find((a) => a.pedido === 'revisar');
    expect(revisar).toMatchObject({ aUsuarioId: e.brian.usuarioId, estado: 'pendiente', mensaje: 'El proveedor es otro.' });
    expect(await avisosDe(e, e.admin.usuarioId, 'reapertura_solicitada', id)).toHaveLength(1);
    expect(await avisosDe(e, e.brian.usuarioId, 'reapertura_solicitada', id)).toHaveLength(1);

    // La agencia vuelve a ver la ficha por la asignacion activa y la reabre: la solicitud queda atendida.
    await reabrir(e.ctx(e.brian), { referenciaId: id, motivo: 'Atendiendo la solicitud.' });
    const despues = (await asignacionesDe(e, id)).find((a) => a.pedido === 'revisar');
    expect(despues?.estado).toBe('hecha');
  });

  it('una ficha que no esta clasificada no necesita solicitud', async () => {
    const id = await fichaEnAduana(e);
    expect((await fallo(solicitarReapertura(e.ctx(e.edward), { referenciaId: id, motivo: 'x' }))).codigo).toBe('VALIDACION');
  });
});

describe('archivar y desarchivar', () => {
  it('archiva el admin con motivo, la agencia deja de verla y el codigo no se libera; desarchivar la restaura', async () => {
    const id = await fichaEnAduana(e, { llena: true, codigo: 'TEST-ARCH-1' });
    expect((await fallo(archivar(e.ctx(e.brian), { referenciaId: id, motivo: 'x' }))).codigo).toBe('SIN_PERMISO');
    expect((await fallo(archivar(e.ctx(e.admin), { referenciaId: id, motivo: '' }))).codigo).toBe('FALTA_MOTIVO');
    await archivar(e.ctx(e.admin), { referenciaId: id, motivo: 'Duplicada por error.' });

    const f = await estadoDe(e, id);
    expect(f.archivadaEn).not.toBeNull();
    expect(f.estadoPrevioArchivo).toBe('EN_GESTION');
    expect((await fallo(vistaFicha(e.db, e.brian, id, new Date()))).codigo).toBe('NO_ENCONTRADO');
    expect((await fallo(crearReferencia(e.ctx(e.edward), { codigo: 'test arch-1', nombreProducto: 'x', tipoProducto: 'INSUMO' }))).codigo).toBe('DUPLICADO');

    expect((await fallo(desarchivar(e.ctx(e.edward), { referenciaId: id, motivo: 'x' }))).codigo).toBe('SIN_PERMISO');
    await desarchivar(e.ctx(e.admin), { referenciaId: id, motivo: 'Fue un error.' });
    const g = await estadoDe(e, id);
    expect(g.archivadaEn).toBeNull();
    expect(g.estado).toBe('EN_GESTION');
    expect((await vistaFicha(e.db, e.brian, id, new Date())).id).toBe(id);
  });

  it('el solicitante archiva solo su borrador sin enviar', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'TEST-ARCH-2', nombreProducto: 'Borrador', tipoProducto: 'INSUMO' });
    await archivar(e.ctx(e.edward), { referenciaId: r.id, motivo: 'Me equivoqué.' });
    expect((await estadoDe(e, r.id)).archivadaEn).not.toBeNull();

    const enviada = await fichaEnAduana(e);
    expect((await fallo(archivar(e.ctx(e.edward), { referenciaId: enviada, motivo: 'x' }))).codigo).toBe('SIN_PERMISO');
  });
});

describe('concurrencia logica: dos cierres', () => {
  it('el segundo cierre ve la ficha ya clasificada', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await ponerPartida(id);
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    expect((await fallo(finalizar(e.ctx(e.admin), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' }))).codigo).toBe('FICHA_CERRADA');
  });
});
