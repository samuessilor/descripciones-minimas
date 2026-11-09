/**
 * Los avisos del lado aduana (clasificada, reabierta, reapertura solicitada) y el pedido de informacion de la aduana
 * al area («Enviar a…» con el pedido «Responder») usan el MISMO mecanismo que cualquier envio: aviso en la bandeja +
 * fila en el outbox de correo, en la misma transaccion, con enlace directo a la ficha y respetando la preferencia
 * «solo en la plataforma».
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, entregaCorreo, notificacion, usuario } from '@/db/esquema';
import { avisarAduana } from '@/server/acciones/aduana-comun';
import { agenciasConAcceso, enviarA, marcarListo } from '@/server/acciones/asignaciones';
import { finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { comentar } from '@/server/acciones/comentarios-y-bandeja';
import { retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { fijarPartida } from '@/server/acciones/partida';
import { nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { avisosDe, fichaEnAduana } from './ayudas-aduana';
import { fichaVisibleParaTest } from './ayudas-visibilidad';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function correoDe(aviso: { id: string }) {
  const filas = await e.db.select().from(entregaCorreo).where(eq(entregaCorreo.notificacionId, aviso.id));
  return filas;
}

async function unAviso(usuarioId: string, tipo: string, ficha: string) {
  const avisos = await avisosDe(e, usuarioId, tipo, ficha);
  expect(avisos, `aviso ${tipo}`).toHaveLength(1);
  return avisos[0]!;
}

async function pedirInformacion(id: string, mensaje = 'Necesito el caudal nominal en m3/h.') {
  await enviarA(e.ctx(e.brian), { referenciaId: id, destinatarios: [{ usuarioId: e.edward.usuarioId, pedido: 'responder' }], mensaje });
}

describe('avisos de la aduana: bandeja + correo en la misma transaccion', () => {
  it('pedir informacion -> area; parte lista -> vuelve a la aduana; clasificada; reapertura solicitada; reabierta', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await fijarPartida(e.ctx(e.brian), { referenciaId: id, partida: '9999.99.99.99', versionEsperada: await versionDe(e.db, id, 'partida_arancelaria') });
    const enlace = new RegExp(`/referencias/${id}`);

    // 1) La aduana pide un dato con «Enviar a» (pedido «Responder»): el area recibe aviso y correo con enlace.
    await pedirInformacion(id);
    const pedido = await unAviso(e.edward.usuarioId, 'asignacion', id);
    const [cPedido] = await correoDe(pedido);
    expect(cPedido).toMatchObject({ destinatario: e.edward.email, plantilla: 'pendiente', estado: 'pendiente' });
    expect(cPedido!.cuerpoTexto).toMatch(/para responder lo que te piden/);
    expect(cPedido!.cuerpoTexto).toMatch(enlace);
    const [delArea] = await e.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, e.edward.usuarioId)));
    expect(delArea).toMatchObject({ pedido: 'responder', estado: 'pendiente', mensaje: 'Necesito el caudal nominal en m3/h.' });

    // 2) El area marca «Listo por mi parte»: la aduana recibe el aviso y la ficha vuelve a ella para clasificar.
    await marcarListo(e.ctx(e.edward), { referenciaId: id });
    const respuesta = await unAviso(e.brian.usuarioId, 'respuesta', id);
    expect(await correoDe(respuesta)).toEqual([expect.objectContaining({ destinatario: e.brian.email, plantilla: 'devuelta' })]);
    const activasBrian = await e.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, e.brian.usuarioId), eq(asignacion.estado, 'pendiente')));
    expect(activasBrian).toEqual([expect.objectContaining({ pedido: 'clasificar', deUsuarioId: e.edward.usuarioId })]);
    expect(respuesta.asignacionId).toBe(activasBrian[0]!.id);

    // 3) La aduana cierra: avisa a quien creo la ficha.
    await finalizar(e.ctx(e.brian), { referenciaId: id, motivoCerrarDeTodosModos: 'Cierre con lo disponible.' });
    const clasificada = await unAviso(e.edward.usuarioId, 'clasificada', id);
    const [cClasif] = await correoDe(clasificada);
    expect(cClasif).toMatchObject({ destinatario: e.edward.email, plantilla: 'clasificada' });
    expect(cClasif!.cuerpoTexto).toMatch(enlace);

    // 4) El solicitante pide reabrir: avisan el administrador y quien clasifico.
    await solicitarReapertura(e.ctx(e.edward), { referenciaId: id, motivo: 'Cambio de proveedor.' });
    const adminAviso = await unAviso(e.admin.usuarioId, 'reapertura_solicitada', id);
    expect(await correoDe(adminAviso)).toEqual([expect.objectContaining({ destinatario: e.admin.email, plantilla: 'reapertura_solicitada' })]);
    const brianAviso = await unAviso(e.brian.usuarioId, 'reapertura_solicitada', id);
    expect(await correoDe(brianAviso)).toHaveLength(1);

    // 5) La aduana reabre: avisa a quien creo la ficha.
    await reabrir(e.ctx(e.brian), { referenciaId: id, motivo: 'Atendiendo la solicitud.' });
    const reabierta = await unAviso(e.edward.usuarioId, 'reabierta', id);
    expect(await correoDe(reabierta)).toEqual([expect.objectContaining({ destinatario: e.edward.email, plantilla: 'reabierta' })]);
  });

  it('si la aduana aun tiene la ficha en la mano, «Listo» del area no abre otro pendiente para ella', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    // Un admin le pide el dato al area: la asignacion de la aduana sigue abierta.
    await enviarA(e.ctx(e.admin), { referenciaId: id, destinatarios: [{ usuarioId: e.edward.usuarioId, pedido: 'responder' }], mensaje: '¿Cuál es el caudal?' });
    await marcarListo(e.ctx(e.edward), { referenciaId: id });
    const deBrian = await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, e.brian.usuarioId)));
    expect(deBrian).toHaveLength(1);
    // El admin pidio «Responder» y no tenia la ficha: vuelve a el para clasificar.
    const deAdmin = await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, e.admin.usuarioId)));
    expect(deAdmin).toEqual([expect.objectContaining({ pedido: 'clasificar', estado: 'pendiente' })]);
  });

  it('«Listo» no le devuelve la ficha a una agencia a la que un admin le retiro el acceso (D-29)', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await pedirInformacion(id); // Brian (agencia A) se la pasa a Edward con «Responder»: su pendiente queda hecho
    await retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: id, organizacionId: e.orgA });
    await enviarA(e.ctx(e.admin), { referenciaId: id, destinatarios: [{ usuarioId: e.brianB.usuarioId, pedido: 'clasificar' }] });
    // Un comentario «todos» ya no le llega a la agencia que dejo de ver la ficha (sigue como remitente de Edward)
    await comentar(e.ctx(e.edward), { referenciaId: id, texto: 'Ya casi tengo el dato.', visibilidad: 'todos' });
    expect(await avisosDe(e, e.brian.usuarioId, 'comentario', id)).toHaveLength(0);

    await marcarListo(e.ctx(e.edward), { referenciaId: id });
    const ahora = new Date();
    expect((await agenciasConAcceso(e.db, id, ahora)).map((a) => a.id)).toEqual([e.orgB]);
    expect(await fichaVisibleParaTest(e, id, e.brian, ahora)).toBe(false);
    expect(await avisosDe(e, e.brian.usuarioId, 'respuesta', id)).toHaveLength(0);
    const deBrian = await e.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, e.brian.usuarioId), eq(asignacion.estado, 'pendiente')));
    expect(deBrian).toHaveLength(0);
  });

  it('quien eligio «solo en la plataforma» recibe el aviso en la campana pero no el correo', async () => {
    await e.db.update(usuario).set({ preferenciaAviso: 'solo_bandeja' }).where(eq(usuario.id, e.edward.usuarioId));
    try {
      const id = await fichaEnAduana(e, { llena: true });
      await pedirInformacion(id, 'Falta el tipo de aceite.');
      const aviso = await unAviso(e.edward.usuarioId, 'asignacion', id);
      expect(await correoDe(aviso)).toHaveLength(0);
    } finally {
      await e.db.update(usuario).set({ preferenciaAviso: 'inmediato' }).where(eq(usuario.id, e.edward.usuarioId));
    }
  });

  it('si la transaccion se revierte no queda ni aviso ni correo', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    const antesAvisos = (await e.db.select().from(notificacion).where(eq(notificacion.referenciaId, id))).length;
    const antesCorreos = (await e.db.select().from(entregaCorreo)).length;
    const persona = { id: e.edward.usuarioId, nombre: e.edward.nombre, rol: e.edward.rol, organizacionId: e.edward.organizacionId, organizacionTipo: e.edward.organizacionTipo };
    await expect(
      e.db.transaction(async (tx) => {
        await avisarAduana(tx, { actor: e.brian, persona, tipo: 'clasificada', ficha: { id, codigo: 'X' }, titulo: 'Prueba', ahora: new Date() });
        throw new Error('falla despues de avisar');
      }),
    ).rejects.toThrow('falla despues de avisar');
    expect((await e.db.select().from(notificacion).where(eq(notificacion.referenciaId, id))).length).toBe(antesAvisos);
    expect((await e.db.select().from(entregaCorreo)).length).toBe(antesCorreos);
  });
});
