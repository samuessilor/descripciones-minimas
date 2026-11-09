/**
 * H3 · Asignaciones "Enviar a" (SPEC 8.3, 12.4, 14): flujo completo con avisos en la app, upsert, lote, visibilidad
 * por organizacion, recordatorios con tope, devolver, cancelar y reasignar. PGlite en memoria (logica;
 * las carreras reales viven en tests/db-real).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import { reiniciarConfig } from '@/server/config';
import { abrirFicha, avisarAsignacionExistente, cancelarAsignacion, enviarA, enviarALote, marcarListo, reasignar, recordar } from '@/server/acciones/asignaciones';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cargarReferenciaVisible } from '@/server/politicas/referencias';
import { cargarActorPorId } from '@/server/politicas/actor';
import { nuevoEscenario, nuevaFicha, rechazaCon, type Escenario } from './ayudas';
import { asignacionesDe, auditorias, d, estadoFicha, notificacionesDe } from './ayudas-colab';

let e: Escenario;
const T0 = new Date('2026-10-21T15:00:00.000Z');

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

describe('enviarA: asignacion + notificacion en la misma transaccion', () => {
  it('Edward envia a Brian: queda el pendiente y el aviso, y la ficha sale de borrador', async () => {
    const id = await nuevaFicha(e, { codigo: 'ENV-0001', nombre: 'Producto secreto' });
    expect(await estadoFicha(e.db, id)).toBe('BORRADOR');

    const r = await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }], mensaje: 'Brian, falta la partida' });

    expect(r.creadas).toBe(1);
    expect(r.actualizadas).toBe(0);

    const [a] = await asignacionesDe(e.db, id);
    expect(a?.estado).toBe('pendiente');
    expect(a?.aUsuarioId).toBe(e.brian.usuarioId);
    expect(a?.deUsuarioId).toBe(e.edward.usuarioId);
    expect(a?.pedido).toBe('clasificar'); // por defecto segun el rol aduana
    expect(a?.mensaje).toBe('Brian, falta la partida');

    const [n] = await notificacionesDe(e.db, e.brian.usuarioId);
    expect(n?.tipo).toBe('asignacion');
    expect(n?.asignacionId).toBe(a?.id);
    expect(n?.titulo).toContain('ENV-0001'); // la bandeja esta detras del login: puede llevar el codigo
    expect(n?.leidaEn).toBeNull();

    expect(n?.titulo).toContain('Edward te envió ENV-0001 para clasificar');

    expect(await estadoFicha(e.db, id)).toBe('EN_GESTION');
    const aud = (await auditorias(e.db, 'enviar_a')).find((x) => x.entidadId === a?.id);
    expect(aud?.usuarioId).toBe(e.edward.usuarioId);

    // Brian ahora ve la ficha (antes era un 404).
    const ver = await cargarReferenciaVisible(e.db, e.brian, id, T0);
    expect(ver.id).toBe(id);
  });

  it('upsert: enviar dos veces lo mismo no duplica pendiente ni aviso', async () => {
    const id = await nuevaFicha(e);
    const entrada = { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }], mensaje: 'Hola' };
    await enviarA(e.ctx(e.edward, T0), entrada);
    const r2 = await enviarA(e.ctx(e.edward, d(T0, 0, 0.01)), entrada);

    expect(r2.creadas).toBe(0);
    expect(r2.actualizadas).toBe(0);
    expect(r2.destinatarios[0]?.sinCambios).toBe(1);
    expect(r2.yaTenianPendiente).toEqual([e.brian.usuarioId]);
    expect(await asignacionesDe(e.db, id)).toHaveLength(1);
    expect(await notificacionesDe(e.db, e.brian.usuarioId).then((x) => x.filter((n) => n.referenciaId === id))).toHaveLength(1);
  });

  it('upsert: si cambia el pedido o el mensaje se actualiza la misma fila y se avisa "te actualizaron el pedido"', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'clasificar' }] });
    const r = await enviarA(e.ctx(e.edward, d(T0, 0, 1)), {
      referenciaId: id,
      destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'revisar' }],
      mensaje: 'Mejor revisa primero',
    });
    expect(r.creadas).toBe(0);
    expect(r.actualizadas).toBe(1);
    const filas = await asignacionesDe(e.db, id);
    expect(filas).toHaveLength(1);
    expect(filas[0]?.pedido).toBe('revisar');
    expect(filas[0]?.mensaje).toBe('Mejor revisa primero');
    const delFicha = (await notificacionesDe(e.db, e.brian.usuarioId)).filter((n) => n.referenciaId === id);
    expect(delFicha).toHaveLength(2);
    expect(delFicha[1]?.titulo).toContain('actualizó lo que te pide');
  });

  it('varias personas a la vez, cada una con su pedido', async () => {
    const id = await nuevaFicha(e);
    const r = await enviarA(e.ctx(e.admin, T0), {
      referenciaId: id,
      destinatarios: [
        { usuarioId: e.charles.usuarioId, pedido: 'responder' },
        { usuarioId: e.brian.usuarioId, pedido: 'clasificar' },
      ],
    });
    expect(r.creadas).toBe(2);
    const filas = await asignacionesDe(e.db, id);
    expect(filas.map((f) => f.pedido).sort()).toEqual(['clasificar', 'responder']);
  });

  it('rechaza lector, pedido incompatible, a uno mismo y usuario inactivo (con mensaje que dice que hacer)', async () => {
    const id = await nuevaFicha(e);
    await rechazaCon(enviarA(e.ctx(e.edward), { referenciaId: id, destinatarios: [{ usuarioId: e.lector.usuarioId }] }), /solo puede consultar/);
    await rechazaCon(
      enviarA(e.ctx(e.edward), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'completar' }] }),
      /no le corresponde «Completar»/,
    );
    await rechazaCon(enviarA(e.ctx(e.edward), { referenciaId: id, destinatarios: [{ usuarioId: e.edward.usuarioId }] }), /No puedes enviarte/);

    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, e.charles.usuarioId));
    expect(await codigoError(enviarA(e.ctx(e.edward), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId }] }))).toBe('NO_ENCONTRADO');
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, e.charles.usuarioId));

    // El lector no puede enviar.
    expect(await codigoError(enviarA(e.ctx(e.lector), { referenciaId: id, destinatarios: [{ usuarioId: e.edward.usuarioId }] }))).toBe('SIN_PERMISO');
    expect(await asignacionesDe(e.db, id)).toHaveLength(0);
  });

  it('es atomico: si uno de los destinatarios es invalido no queda ni asignacion ni aviso', async () => {
    const id = await nuevaFicha(e);
    const antesNotif = (await notificacionesDe(e.db, e.brian.usuarioId)).length;
    await expect(
      enviarA(e.ctx(e.edward, T0), {
        referenciaId: id,
        destinatarios: [{ usuarioId: e.brian.usuarioId }, { usuarioId: e.lector.usuarioId }],
      }),
    ).rejects.toBeInstanceOf(ErrorAccion);
    expect(await asignacionesDe(e.db, id)).toHaveLength(0);
    expect((await notificacionesDe(e.db, e.brian.usuarioId)).length).toBe(antesNotif);
    expect(await estadoFicha(e.db, id)).toBe('BORRADOR');
  });

  it('un nombre con saltos de linea queda en una sola linea en el aviso', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Eva\r\nBcc: x@y.z', email: 'eva@prueba.invalid', rol: 'solicitante', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    const eva = await cargarActorPorId(e.db, (u as { id: string }).id);
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(eva!, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId }] });
    const titulos = (await notificacionesDe(e.db, e.charles.usuarioId)).filter((n) => n.referenciaId === id).map((n) => n.titulo);
    expect(titulos).toHaveLength(1);
    expect(titulos[0]).not.toMatch(/[\r\n]/);
  });
});

describe('visibilidad por organizacion y una sola agencia a la vez (8.3 reglas 2 y 10)', () => {
  it('una agencia ve solo lo que se le envia; al cancelar lo pierde', async () => {
    const id = await nuevaFicha(e);
    await expect(cargarReferenciaVisible(e.db, e.brian, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    await cargarReferenciaVisible(e.db, e.brian, id, T0);
    await expect(cargarReferenciaVisible(e.db, e.brianB, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    const [a] = await asignacionesDe(e.db, id);
    await cancelarAsignacion(e.ctx(e.edward, T0), { asignacionId: a!.id });
    await expect(cargarReferenciaVisible(e.db, e.brian, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('una segunda agencia solo la agrega un admin', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    await rechazaCon(
      enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brianB.usuarioId }] }),
      /ya está con Agencia A\. Pide a un administrador/,
    );
    const r = await enviarA(e.ctx(e.admin, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brianB.usuarioId }] });
    expect(r.creadas).toBe(1);
  });

  it('una agencia solo puede enviar a quien creo la ficha, a quien se la envio o a su propia agencia', async () => {
    const id = await nuevaFicha(e, { actor: e.edward });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    // Charles no la creo ni se la envio: no se revela ni se le puede enviar.
    expect(await codigoError(enviarA(e.ctx(e.brian, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'responder' }] }))).toBe('SIN_PERMISO');
    const r = await enviarA(e.ctx(e.brian, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.edward.usuarioId, pedido: 'responder' }] });
    expect(r.creadas).toBe(1);
    // Regla 5: la asignacion de Brian queda hecha y conserva acceso de lectura unos dias (S-22).
    const mia = (await asignacionesDe(e.db, id)).find((a) => a.aUsuarioId === e.brian.usuarioId);
    expect(mia?.estado).toBe('hecha');
    expect(mia?.accesoHasta && mia.accesoHasta.getTime() > T0.getTime()).toBe(true);
    await cargarReferenciaVisible(e.db, e.brian, id, T0);
    await expect(cargarReferenciaVisible(e.db, e.brian, id, d(T0, 40))).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('una ficha archivada o clasificada no se envia salvo para revisar', async () => {
    const id = await nuevaFicha(e);
    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: T0, clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, id));
    expect(await codigoError(enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] }))).toBe('FICHA_CERRADA');
    const r = await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'revisar' }] });
    expect(r.creadas).toBe(1);

    const id2 = await nuevaFicha(e);
    await e.db.update(referencia).set({ archivadaEn: T0, archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, id2));
    expect(await codigoError(enviarA(e.ctx(e.admin, T0), { referenciaId: id2, destinatarios: [{ usuarioId: e.charles.usuarioId }] }))).toBe('FICHA_CERRADA');
  });
});

describe('enviarALote (RV-37): hasta 25 fichas a varias personas', () => {
  it('3 fichas a 2 personas: 6 asignaciones y 6 avisos', async () => {
    const ids = [await nuevaFicha(e), await nuevaFicha(e), await nuevaFicha(e)];
    const r = await enviarALote(e.ctx(e.edward, T0), {
      referenciaIds: ids,
      destinatarios: [
        { usuarioId: e.charles.usuarioId, pedido: 'completar' },
        { usuarioId: e.brian.usuarioId },
      ],
      mensaje: 'Para esta semana',
    });
    expect(r.creadas).toBe(6);
    expect(r.loteId).toBeTruthy();
    for (const id of ids) {
      expect(await estadoFicha(e.db, id)).toBe('EN_GESTION');
      expect(await asignacionesDe(e.db, id)).toHaveLength(2);
    }
    expect((await auditorias(e.db, 'enviar_lote')).length).toBeGreaterThan(0);

    // Repetir el mismo lote no avisa otra vez.
    const rep = await enviarALote(e.ctx(e.edward, d(T0, 0, 0.1)), {
      referenciaIds: ids,
      destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }, { usuarioId: e.brian.usuarioId }],
      mensaje: 'Para esta semana',
    });
    expect(rep.creadas).toBe(0);
  });

  it('mas de 25 fichas se rechaza; y si una ficha no se puede enviar no queda nada del lote', async () => {
    const muchas = Array.from({ length: 26 }, () => crypto.randomUUID());
    expect(await codigoError(enviarALote(e.ctx(e.edward), { referenciaIds: muchas, destinatarios: [{ usuarioId: e.charles.usuarioId }] }))).toBe('VALIDACION');

    const buena = await nuevaFicha(e);
    const archivada = await nuevaFicha(e);
    await e.db.update(referencia).set({ archivadaEn: T0, archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, archivada));
    await expect(
      enviarALote(e.ctx(e.admin, T0), { referenciaIds: [buena, archivada], destinatarios: [{ usuarioId: e.charles.usuarioId }] }),
    ).rejects.toMatchObject({ codigo: 'FICHA_CERRADA' });
    expect(await asignacionesDe(e.db, buena)).toHaveLength(0);
  });
});

describe('recordar: tope diario configurable (8.3 regla 8)', () => {
  it('una vez al dia; al dia siguiente se puede; el lector puede; quien no envio, no', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const [a] = await asignacionesDe(e.db, id);

    const r1 = await recordar(e.ctx(e.edward, d(T0, 1)), { asignacionId: a!.id });
    expect(r1.hoy).toBe(1);
    expect(r1.maxPorDia).toBe(1);
    const aviso = (await notificacionesDe(e.db, e.brian.usuarioId)).find((n) => n.tipo === 'recordatorio' && n.asignacionId === a!.id);
    expect(aviso?.titulo).toContain('te recuerda');
    expect(aviso?.titulo).toContain('desde hace 1 día');

    await rechazaCon(recordar(e.ctx(e.edward, d(T0, 1, 2)), { asignacionId: a!.id }), /Ya enviaste un recordatorio hoy/);
    expect(await codigoError(recordar(e.ctx(e.edward, d(T0, 1, 2)), { asignacionId: a!.id }))).toBe('LIMITE_TASA');
    // El lector (la dueña del proceso) cuenta contra el mismo tope por asignacion.
    expect(await codigoError(recordar(e.ctx(e.lector, d(T0, 1, 3)), { asignacionId: a!.id }))).toBe('LIMITE_TASA');
    // Al dia siguiente (calendario de Bogota) se puede otra vez.
    const r2 = await recordar(e.ctx(e.lector, d(T0, 2)), { asignacionId: a!.id });
    expect(r2.hoy).toBe(1);

    expect(await codigoError(recordar(e.ctx(e.charles, d(T0, 3)), { asignacionId: a!.id }))).toBe('SIN_PERMISO');
    const [fila] = await e.db.select().from(asignacion).where(eq(asignacion.id, a!.id));
    expect(fila?.nRecordatorios).toBe(2);
  });

  it('el tope se configura con RECORDATORIO_MANUAL_MAX_DIA', async () => {
    process.env.RECORDATORIO_MANUAL_MAX_DIA = '2';
    reiniciarConfig();
    try {
      const id = await nuevaFicha(e);
      await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
      const [a] = await asignacionesDe(e.db, id);
      await recordar(e.ctx(e.edward, d(T0, 1)), { asignacionId: a!.id });
      const r = await recordar(e.ctx(e.edward, d(T0, 1, 1)), { asignacionId: a!.id });
      expect(r.hoy).toBe(2);
      expect(await codigoError(recordar(e.ctx(e.edward, d(T0, 1, 2)), { asignacionId: a!.id }))).toBe('LIMITE_TASA');
    } finally {
      delete process.env.RECORDATORIO_MANUAL_MAX_DIA;
      reiniciarConfig();
    }
  });

  it('no se recuerda una asignacion terminada', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    const [a] = await asignacionesDe(e.db, id);
    await marcarListo(e.ctx(e.charles, T0), { referenciaId: id });
    await rechazaCon(recordar(e.ctx(e.edward, d(T0, 1)), { asignacionId: a!.id }), /ya terminó/);
  });
});

describe('marcarListo, cancelar, reasignar, abrir', () => {
  it('Brian marca listo: su asignacion queda hecha y Edward recibe el aviso; repetirlo no duplica', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const r = await marcarListo(e.ctx(e.brian, d(T0, 1)), { referenciaId: id });
    expect(r.yaEstaba).toBe(false);
    expect(r.avisados).toEqual([e.edward.usuarioId]);
    const [a] = await asignacionesDe(e.db, id);
    expect(a?.estado).toBe('hecha');
    expect(a?.completadaEn).not.toBeNull();
    const delFicha = (await notificacionesDe(e.db, e.edward.usuarioId)).filter((n) => n.referenciaId === id);
    expect(delFicha).toHaveLength(1);
    expect(delFicha[0]?.titulo).toContain('Brian terminó su parte');

    const otra = await marcarListo(e.ctx(e.brian, d(T0, 1, 1)), { referenciaId: id });
    expect(otra.yaEstaba).toBe(true);
    expect((await notificacionesDe(e.db, e.edward.usuarioId)).filter((n) => n.referenciaId === id)).toHaveLength(1);
  });

  it('marcar listo sin tener la ficha pendiente es un error con salida', async () => {
    const id = await nuevaFicha(e);
    await rechazaCon(marcarListo(e.ctx(e.charles), { referenciaId: id }), /no está pendiente para ti/);
  });

  it('cancelar: solo quien envio o un admin; avisa a quien lo tenia; es idempotente', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    const [a] = await asignacionesDe(e.db, id);
    expect(await codigoError(cancelarAsignacion(e.ctx(e.lector, T0), { asignacionId: a!.id }))).toBe('SIN_PERMISO');
    expect(await codigoError(cancelarAsignacion(e.ctx(e.charles, T0), { asignacionId: a!.id }))).toBe('SIN_PERMISO');

    const r = await cancelarAsignacion(e.ctx(e.edward, T0), { asignacionId: a!.id });
    expect(r.yaEstaba).toBe(false);
    expect((await asignacionesDe(e.db, id))[0]?.estado).toBe('cancelada');
    const avisos = (await notificacionesDe(e.db, e.charles.usuarioId)).filter((n) => n.referenciaId === id);
    expect(avisos.some((n) => n.titulo.includes('canceló'))).toBe(true);

    expect((await cancelarAsignacion(e.ctx(e.admin, T0), { asignacionId: a!.id })).yaEstaba).toBe(true);
    // Se puede volver a enviar: ya no hay una activa.
    const re = await enviarA(e.ctx(e.edward, d(T0, 0, 1)), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    expect(re.creadas).toBe(1);
  });

  it('reasignar: la vieja queda "reasignada", la nueva recibe aviso y quien envio sigue siendo el remitente', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    const [a] = await asignacionesDe(e.db, id);
    expect(await codigoError(reasignar(e.ctx(e.lector, T0), { asignacionId: a!.id, aUsuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    const r = await reasignar(e.ctx(e.edward, d(T0, 1)), { asignacionId: a!.id, aUsuarioId: e.admin.usuarioId });
    expect(r.nueva.creadas).toBe(1);
    const filas = await asignacionesDe(e.db, id);
    expect(filas.map((f) => f.estado).sort()).toEqual(['pendiente', 'reasignada']);
    const nueva = filas.find((f) => f.estado === 'pendiente');
    expect(nueva?.aUsuarioId).toBe(e.admin.usuarioId);
    expect(nueva?.deUsuarioId).toBe(e.edward.usuarioId);
    expect((await notificacionesDe(e.db, e.charles.usuarioId)).some((n) => n.titulo.includes('Ya no tienes nada pendiente'))).toBe(true);
    await rechazaCon(reasignar(e.ctx(e.edward, d(T0, 1)), { asignacionId: nueva!.id, aUsuarioId: e.admin.usuarioId }), /ya tiene la referencia/);
  });

  it('abrir la ficha pasa pendiente a en_curso y marca leidos los avisos de esa ficha', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const r = await abrirFicha(e.ctx(e.brian, d(T0, 0, 1)), { referenciaId: id });
    expect(r.enCurso).toBe(1);
    expect(r.leidas).toBe(1);
    const [a] = await asignacionesDe(e.db, id);
    expect(a?.estado).toBe('en_curso');
    expect(a?.vistaEn).not.toBeNull();
    const r2 = await abrirFicha(e.ctx(e.brian, d(T0, 0, 2)), { referenciaId: id });
    expect(r2).toEqual({ enCurso: 0, leidas: 0 });
    // Una persona sin acceso no puede "abrir" una ficha ajena.
    await expect(abrirFicha(e.ctx(e.brianB, T0), { referenciaId: id })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('el indice unico de asignaciones activas se respeta tambien con envios simultaneos a la misma persona', async () => {
    const id = await nuevaFicha(e);
    const entrada = { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' as const }] };
    await Promise.allSettled([enviarA(e.ctx(e.edward, T0), entrada), enviarA(e.ctx(e.admin, T0), entrada)]);
    const activas = (await asignacionesDe(e.db, id)).filter((a) => a.estado === 'pendiente' || a.estado === 'en_curso');
    expect(activas.filter((a) => a.aUsuarioId === e.charles.usuarioId)).toHaveLength(1);
  });
});

describe('organizaciones: nada se cuela entre agencias', () => {
  it('los datos de la agencia B no aparecen en lo que ve la agencia A', async () => {
    const a = await e.db.select().from(organizacion).where(eq(organizacion.id, e.orgA));
    expect(a).toHaveLength(1);
    const idB = await nuevaFicha(e);
    await enviarA(e.ctx(e.admin, T0), { referenciaId: idB, destinatarios: [{ usuarioId: e.brianB.usuarioId }] });
    await expect(cargarReferenciaVisible(e.db, e.brian, idB, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    const filas = await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, idB), eq(asignacion.aUsuarioId, e.brian.usuarioId)));
    expect(filas).toHaveLength(0);
  });
});

describe('asignaciones creadas por otra via (reasignar al desactivar a un usuario)', () => {
  it('avisarAsignacionExistente deja el aviso en la misma transaccion y es idempotente', async () => {
    const id = await nuevaFicha(e);
    const [a] = await e.db
      .insert(asignacion)
      .values({ referenciaId: id, deUsuarioId: e.edward.usuarioId, aUsuarioId: e.charles.usuarioId, pedido: 'completar', estado: 'pendiente' })
      .returning();
    const r = await e.db.transaction((tx) => avisarAsignacionExistente(tx, { asignacionId: a!.id, quien: 'Ana Admin', ahora: T0 }));
    expect(r?.notificacionId).toBeTruthy();
    const avisos = (await notificacionesDe(e.db, e.charles.usuarioId)).filter((n) => n.asignacionId === a!.id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.titulo).toContain('Ana Admin te envió');
    // Una segunda llamada no duplica nada.
    expect(await e.db.transaction((tx) => avisarAsignacionExistente(tx, { asignacionId: a!.id, quien: 'Ana Admin', ahora: T0 }))).toBeNull();
    expect((await notificacionesDe(e.db, e.charles.usuarioId)).filter((n) => n.asignacionId === a!.id)).toHaveLength(1);
  });
});
