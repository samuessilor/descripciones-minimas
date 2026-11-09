/**
 * H3 · Comentarios con alcance, notificaciones, bandeja, seguimiento de envios, historial y candidatos
 * a destinatario: lo que cada rol puede ver (13.2, RV-29, PA-38, A5). PGlite en memoria.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, comentario, entregaCorreo, referencia, usuario } from '@/db/esquema';
import { enviarA, marcarListo } from '@/server/acciones/asignaciones';
import { comentar, listarMisPendientes, listarNotificaciones, marcarNotificacionLeida, marcarTodasLeidas } from '@/server/acciones/comentarios-y-bandeja';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { crearMailerMemoria } from '@/server/correo/consola';
import { despachar } from '@/server/correo/despachar';
import {
  candidatosDestinoDe,
  comentariosDe,
  contextoEnvioDe,
  esperandoDe,
  historialDeFichaDe,
  notificacionesDe,
  pendientesDe,
  recientesDe,
  resumenCamposDe,
  resumenInicioDe,
  seguimientoDeFicha,
} from '@/server/politicas/colaboracion';
import { nuevoEscenario, nuevaFicha, rechazaCon, versionDe, type Escenario } from './ayudas';
import { d } from './ayudas-colab';

let e: Escenario;
const T0 = new Date('2026-10-21T15:00:00.000Z');

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigo(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

async function escribir(actor: Escenario['edward'], id: string, campo: string, valor: unknown, motivo?: string) {
  return guardarCampo(e.ctx(actor, T0), { referenciaId: id, campo, valor, versionEsperada: await versionDe(e.db, id, campo), ...(motivo ? { motivo } : {}) });
}

describe('comentarios con alcance (RV-29)', () => {
  it('interno por defecto para internos; la aduana solo escribe "todos"; el lector no comenta', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });

    expect(await codigo(comentar(e.ctx(e.lector, T0), { referenciaId: id, texto: 'hola', visibilidad: 'interno' }))).toBe('SIN_PERMISO');
    expect(await codigo(comentar(e.ctx(e.brian, T0), { referenciaId: id, texto: 'solo para mi', visibilidad: 'interno' }))).toBe('SIN_PERMISO');
    await comentar(e.ctx(e.brian, d(T0, 0, 0.01)), { referenciaId: id, texto: 'Necesito la marca', visibilidad: 'todos' });
    await comentar(e.ctx(e.edward, d(T0, 0, 0.05)), { referenciaId: id, texto: 'Nota interna: ojo con el proveedor', visibilidad: 'interno' });
    await comentar(e.ctx(e.edward, d(T0, 0, 0.1)), { referenciaId: id, texto: 'Te la mando hoy', visibilidad: 'todos' });

    const paraInterno = await comentariosDe(e.db, e.edward, id, T0);
    expect(paraInterno.map((c) => c.texto)).toEqual(['Necesito la marca', 'Nota interna: ojo con el proveedor', 'Te la mando hoy']);
    // La aduana NUNCA ve el comentario interno (se filtra en SQL).
    const paraAduana = await comentariosDe(e.db, e.brian, id, T0);
    expect(paraAduana.map((c) => c.texto)).toEqual(['Necesito la marca', 'Te la mando hoy']);
    expect(JSON.stringify(paraAduana)).not.toContain('proveedor');
  });

  it('un comentario interno no se notifica a la aduana; uno para todos si; el autor no se notifica a si mismo', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    // Brian ya vio su aviso de envio; limpiamos para contar solo los comentarios.
    await marcarTodasLeidas(e.ctx(e.brian, T0));

    const r1 = await comentar(e.ctx(e.edward, T0), { referenciaId: id, texto: 'interno', visibilidad: 'interno' });
    expect(r1.notificados).toBe(0);
    expect((await notificacionesDe(e.db, e.brian, { soloNoLeidas: true })).items.filter((n) => n.referenciaId === id)).toHaveLength(0);

    const r2 = await comentar(e.ctx(e.edward, T0), { referenciaId: id, texto: 'para todos', visibilidad: 'todos' });
    expect(r2.notificados).toBe(1); // Brian; el creador (Edward) es el autor
    const nb = (await notificacionesDe(e.db, e.brian, { soloNoLeidas: true })).items.filter((n) => n.referenciaId === id);
    expect(nb).toHaveLength(1);
    expect(nb[0]?.tipo).toBe('comentario');
    expect(nb[0]?.titulo).toContain('comentó en');
    expect((await notificacionesDe(e.db, e.edward, { soloNoLeidas: true })).items.filter((n) => n.tipo === 'comentario' && n.referenciaId === id)).toHaveLength(0);

    // Brian responde: avisa a quien creo la ficha y a quien se la envio (la misma persona, una vez).
    const r3 = await comentar(e.ctx(e.brian, d(T0, 0, 0.02)), { referenciaId: id, texto: 'Recibido', visibilidad: 'todos' });
    expect(r3.notificados).toBe(1);
    // Los comentarios de la bandeja no salen por correo (14).
    const correosDeComentario = (await e.db.select().from(entregaCorreo)).filter((c) => c.plantilla === 'comentario');
    expect(correosDeComentario).toHaveLength(0);
  });

  it('un comentario sobre un campo guarda el campo y valida que exista', async () => {
    const id = await nuevaFicha(e);
    await comentar(e.ctx(e.edward, T0), { referenciaId: id, campo: 'marca', texto: 'Confirmar con el proveedor', visibilidad: 'interno' });
    const lista = await comentariosDe(e.db, e.edward, id, T0, { campo: 'marca' });
    expect(lista).toHaveLength(1);
    expect(lista[0]?.campoEtiqueta).toBe('Marca');
    expect(await codigo(comentar(e.ctx(e.edward, T0), { referenciaId: id, campo: 'no_existe', texto: 'x', visibilidad: 'interno' }))).toBe('VALIDACION');
    expect(await codigo(comentar(e.ctx(e.edward, T0), { referenciaId: id, campo: 'dm:no-es-uuid', texto: 'x', visibilidad: 'interno' }))).toBe('VALIDACION');
    expect(await codigo(comentar(e.ctx(e.edward, T0), { referenciaId: id, texto: '   ', visibilidad: 'interno' }))).toBe('VALIDACION');
  });

  it('se puede comentar una ficha clasificada, no una archivada; y un comentario no se edita ni se borra', async () => {
    const id = await nuevaFicha(e);
    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: T0 }).where(eq(referencia.id, id));
    const r = await comentar(e.ctx(e.edward, T0), { referenciaId: id, texto: 'Sigue válida', visibilidad: 'interno' });
    expect(r.id).toBeTruthy();
    await rechazaCon(e.db.update(comentario).set({ texto: 'cambiado' }).where(eq(comentario.id, r.id)), /solo escritura|solo-escritura|no admite/i);
    await rechazaCon(e.db.delete(comentario).where(eq(comentario.id, r.id)), /solo escritura|solo-escritura|no admite/i);

    const arch = await nuevaFicha(e);
    await e.db.update(referencia).set({ archivadaEn: T0 }).where(eq(referencia.id, arch));
    expect(await codigo(comentar(e.ctx(e.admin, T0), { referenciaId: arch, texto: 'x', visibilidad: 'interno' }))).toBe('FICHA_CERRADA');
  });

  it('una agencia sin acceso no puede comentar ni leer (404)', async () => {
    const id = await nuevaFicha(e);
    expect(await codigo(comentar(e.ctx(e.brian, T0), { referenciaId: id, texto: 'hola', visibilidad: 'todos' }))).toBe('NO_ENCONTRADO');
    await expect(comentariosDe(e.db, e.brian, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});

describe('notificaciones de la bandeja', () => {
  it('lista, cuenta, marca una como leida (solo las propias) y marca todas', async () => {
    const id1 = await nuevaFicha(e);
    const id2 = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id1, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    await enviarA(e.ctx(e.edward, d(T0, 0, 1)), { referenciaId: id2, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });

    const l = await listarNotificaciones(e.ctx(e.charles, T0), {});
    const delTest = l.items.filter((n) => n.referenciaId === id1 || n.referenciaId === id2);
    expect(delTest).toHaveLength(2);
    expect(l.noLeidas).toBeGreaterThanOrEqual(2);
    // Mas nueva primero.
    expect(delTest[0]?.referenciaId).toBe(id2);
    expect(delTest[0]?.href).toBe(`/referencias/${id2}`);

    expect(await codigo(marcarNotificacionLeida(e.ctx(e.edward, T0), { notificacionId: delTest[0]!.id }))).toBe('NO_ENCONTRADO');
    await marcarNotificacionLeida(e.ctx(e.charles, T0), { notificacionId: delTest[0]!.id });
    await marcarNotificacionLeida(e.ctx(e.charles, T0), { notificacionId: delTest[0]!.id }); // idempotente
    const despues = await listarNotificaciones(e.ctx(e.charles, T0), { soloNoLeidas: true });
    expect(despues.items.find((n) => n.id === delTest[0]!.id)).toBeUndefined();
    expect(despues.noLeidas).toBe(l.noLeidas - 1);

    const r = await marcarTodasLeidas(e.ctx(e.charles, T0));
    expect(r.marcadas).toBe(l.noLeidas - 1);
    expect((await listarNotificaciones(e.ctx(e.charles, T0), {})).noLeidas).toBe(0);
  });

  it('pagina por cursor sin repetir ni saltar avisos', async () => {
    for (let i = 0; i < 5; i++) {
      const id = await nuevaFicha(e);
      await enviarA(e.ctx(e.edward, d(T0, 1, i)), { referenciaId: id, destinatarios: [{ usuarioId: e.lector.usuarioId === '' ? '' : e.admin.usuarioId }] });
    }
    const todas = await notificacionesDe(e.db, e.admin, { limite: 100 });
    const p1 = await notificacionesDe(e.db, e.admin, { limite: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.siguiente).toBeTruthy();
    const p2 = await notificacionesDe(e.db, e.admin, { limite: 2, antes: p1.siguiente });
    const p3 = await notificacionesDe(e.db, e.admin, { limite: 2, antes: p2.siguiente });
    const ids = [...p1.items, ...p2.items, ...p3.items].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(todas.items.slice(0, ids.length).map((n) => n.id));
    // Un cursor basura se ignora (no revienta).
    expect((await notificacionesDe(e.db, e.admin, { limite: 2, antes: "x'; drop table notificacion;--" })).items).toHaveLength(2);
  });
});

describe('bandeja: Mis pendientes, Esperando a otros, recientes y resumen (10.3)', () => {
  it('Mis pendientes: solo las activas, mas dias en gestion primero, con quien la envio y que falta', async () => {
    const vieja = await nuevaFicha(e, { codigo: 'BAN-VIEJA' });
    const nueva = await nuevaFicha(e, { codigo: 'BAN-NUEVA' });
    await e.db.update(referencia).set({ fechaSolicitud: '2026-10-10' }).where(eq(referencia.id, vieja));
    await e.db.update(referencia).set({ fechaSolicitud: '2026-10-20' }).where(eq(referencia.id, nueva));
    await enviarA(e.ctx(e.edward, d(T0, 0, 1)), { referenciaId: nueva, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }], mensaje: 'Antes del viernes' });
    await enviarA(e.ctx(e.edward, d(T0, 0, 2)), { referenciaId: vieja, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });

    const filas = await listarMisPendientes(e.ctx(e.charles, T0));
    const mias = filas.filter((f) => f.codigo === 'BAN-VIEJA' || f.codigo === 'BAN-NUEVA');
    expect(mias.map((f) => f.codigo)).toEqual(['BAN-VIEJA', 'BAN-NUEVA']);
    expect(mias[0]?.diasEnGestion).toBeGreaterThan(mias[1]!.diasEnGestion);
    expect(mias[1]?.deUsuario).toBe('Edward');
    expect(mias[1]?.mensaje).toBe('Antes del viernes');
    expect(mias[1]?.pedido).toBe('completar');
    expect(mias[1]?.falta).toMatch(/Falta: |Faltan /);
    expect(mias[0]?.color).toBe('amarillo');

    // Al terminar, sale de "Mis pendientes".
    await marcarListo(e.ctx(e.charles, T0), { referenciaId: vieja });
    expect((await pendientesDe(e.db, e.charles, T0)).some((f) => f.codigo === 'BAN-VIEJA')).toBe(false);
  });

  it('Esperando a otros: quien envio ve lo suyo; el lector y el admin ven todo; el estado del correo sigue al outbox', async () => {
    const id = await nuevaFicha(e, { codigo: 'ESP-0001' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });

    const deEdward = await esperandoDe(e.db, e.edward, T0);
    const fila = deEdward.find((f) => f.codigo === 'ESP-0001')!;
    expect(fila.aUsuario.nombre).toBe('Brian');
    expect(fila.esMia).toBe(true);
    expect(fila.puedeRecordar).toBe(true);
    expect(fila.puedeGestionar).toBe(true);
    expect(fila.entrega.estado).toBe('en_cola');
    // Charles no envio nada: no la ve en su lista... pero la dueña del proceso si.
    expect((await esperandoDe(e.db, e.charles, T0)).some((f) => f.codigo === 'ESP-0001')).toBe(false);
    const delLector = (await esperandoDe(e.db, e.lector, T0)).find((f) => f.codigo === 'ESP-0001')!;
    expect(delLector.esMia).toBe(false);
    expect(delLector.puedeRecordar).toBe(true);
    expect(delLector.puedeGestionar).toBe(false);
    expect((await esperandoDe(e.db, e.admin, T0)).some((f) => f.codigo === 'ESP-0001')).toBe(true);

    // El correo sale -> "enviado".
    await despachar({ db: e.db, mailer: crearMailerMemoria(), ahora: new Date(Date.now() + 5000) });
    expect((await esperandoDe(e.db, e.edward, T0)).find((f) => f.codigo === 'ESP-0001')?.entrega.estado).toBe('enviado');
    // Si el correo no sale del todo -> "no_entregable" visible para quien envio.
    const [a] = await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, id));
    await e.db.update(entregaCorreo).set({ estado: 'abandonado', ultimoError: 'ECONNREFUSED' }).where(eq(entregaCorreo.destinatario, 'brian@prueba.invalid'));
    expect((await esperandoDe(e.db, e.edward, T0)).find((f) => f.asignacionId === a!.id)?.entrega.estado).toBe('no_entregable');
  });

  it('un envio entre dos personas internas no aparece en la lista de otra agencia', async () => {
    const id = await nuevaFicha(e, { codigo: 'ESP-0002' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    expect((await esperandoDe(e.db, e.brianB, T0)).some((f) => f.codigo === 'ESP-0002')).toBe(false);
    expect((await pendientesDe(e.db, e.brianB, T0)).some((f) => f.codigo === 'ESP-0002')).toBe(false);
  });

  it('resumen del inicio y sin responsable (8.3 regla 11), recientes', async () => {
    const id = await nuevaFicha(e, { codigo: 'SIN-RESP' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, pedido: 'completar' }] });
    const [a] = await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, id));
    await marcarListo(e.ctx(e.charles, T0), { referenciaId: id });
    expect(a).toBeTruthy();

    const delLector = await resumenInicioDe(e.db, e.lector, T0);
    expect(delLector.sinResponsable).toBeGreaterThanOrEqual(1);
    expect((await resumenInicioDe(e.db, e.edward, T0)).sinResponsable).toBeNull();
    const r = await resumenInicioDe(e.db, e.charles, T0);
    expect(r.pendientesParaMi).toBeGreaterThanOrEqual(0);
    expect(typeof r.listas).toBe('number');

    const rec = await recientesDe(e.db, e.edward, T0, 3);
    expect(rec).toHaveLength(3);
    expect(rec[0]!.actualizadaEn >= rec[1]!.actualizadaEn).toBe(true);
    // La aduana solo ve recientes de lo que tiene.
    expect(await recientesDe(e.db, e.brianB, T0, 5)).toEqual([]);
  });
});

describe('seguimiento de los envios de una ficha', () => {
  it('quien envio ve el estado del correo; el destinatario no; la aduana solo ve a su organizacion', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }, { usuarioId: e.charles.usuarioId, pedido: 'completar' }] });

    const paraEdward = await seguimientoDeFicha(e.db, e.edward, id, T0);
    expect(paraEdward).toHaveLength(2);
    expect(paraEdward.every((s) => s.entrega !== null && s.esMia)).toBe(true);
    expect(paraEdward.every((s) => s.puedeRecordar && s.puedeCancelar && s.puedeReasignar)).toBe(true);
    expect(paraEdward.find((s) => s.a.nombre === 'Brian')?.codigo).toBeTruthy();

    // Charles ve las dos asignaciones (es interno) pero NO el estado del correo ni puede gestionarlas.
    const paraCharles = await seguimientoDeFicha(e.db, e.charles, id, T0);
    expect(paraCharles.every((s) => s.entrega === null)).toBe(true);
    expect(paraCharles.every((s) => !s.puedeCancelar && !s.puedeReasignar)).toBe(true);

    // Brian (aduana) solo ve la asignacion de su organizacion, y sin el estado del correo.
    const paraBrian = await seguimientoDeFicha(e.db, e.brian, id, T0);
    expect(paraBrian.map((s) => s.a.nombre)).toEqual(['Brian']);
    expect(paraBrian[0]?.entrega).toBeNull();
    // La dueña del proceso ve el correo y puede recordar, pero no cancelar.
    const paraLector = await seguimientoDeFicha(e.db, e.lector, id, T0);
    expect(paraLector.every((s) => s.entrega !== null && s.puedeRecordar && !s.puedeCancelar)).toBe(true);

    await expect(seguimientoDeFicha(e.db, e.brianB, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('a una agencia, otra agencia se le muestra como "Otra agencia" (A5)', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    await enviarA(e.ctx(e.admin, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brianB.usuarioId }] });
    const paraBrian = await seguimientoDeFicha(e.db, e.brian, id, T0);
    // Solo ve lo de su organizacion; y en candidatos no aparece nadie de la otra agencia.
    expect(paraBrian.every((s) => s.a.nombre !== 'Brenda')).toBe(true);
    const cs = await candidatosDestinoDe(e.db, e.brian, id, T0);
    expect(cs.some((c) => c.nombre === 'Brenda')).toBe(false);
  });
});

describe('candidatos a destinatario y contexto del dialogo', () => {
  it('un interno ve a todos los activos que no son lector; el pedido por defecto sigue al rol', async () => {
    const id = await nuevaFicha(e);
    const cs = await candidatosDestinoDe(e.db, e.edward, id, T0);
    const nombres = cs.map((c) => c.nombre);
    expect(nombres).toContain('Brian');
    expect(nombres).toContain('Charles');
    expect(nombres).not.toContain('Lucia Lectora'); // lector
    expect(nombres).not.toContain('Edward'); // uno mismo
    expect(cs.find((c) => c.nombre === 'Brian')?.pedidoPorDefecto).toBe('clasificar');
    expect(cs.find((c) => c.nombre === 'Charles')?.pedidosPermitidos).toEqual(['completar', 'responder', 'revisar']);
    expect(cs.find((c) => c.nombre === 'Brian')?.esAgencia).toBe(true);

    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, e.charles.usuarioId));
    expect((await candidatosDestinoDe(e.db, e.edward, id, T0)).some((c) => c.nombre === 'Charles')).toBe(false);
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, e.charles.usuarioId));
  });

  it('marca "ya la tiene pendiente" y bloquea a una segunda agencia salvo para el admin', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const deEdward = await candidatosDestinoDe(e.db, e.edward, id, T0);
    expect(deEdward.find((c) => c.nombre === 'Brian')?.yaTiene).toBe('clasificar');
    expect(deEdward.find((c) => c.nombre === 'Brenda')?.noDisponible).toMatch(/ya está con otra agencia/);
    const deAdmin = await candidatosDestinoDe(e.db, e.admin, id, T0);
    expect(deAdmin.find((c) => c.nombre === 'Brenda')?.noDisponible).toBeNull();
  });

  it('una agencia solo ve a quien creo la ficha, a quien se la envio y a su agencia', async () => {
    const id = await nuevaFicha(e);
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const cs = await candidatosDestinoDe(e.db, e.brian, id, T0);
    expect(cs.map((c) => c.nombre)).toEqual(['Edward']); // Charles, Ana y Lucia no se revelan a un externo
  });

  it('el contexto dice cuantos campos faltan, mi asignacion y si puedo comentar', async () => {
    const id = await nuevaFicha(e, { codigo: 'CTX-0001' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const ctxEdward = await contextoEnvioDe(e.db, e.edward, id, T0);
    expect(ctxEdward.codigo).toBe('CTX-0001');
    expect(ctxEdward.quien).toBe('Edward');
    expect(ctxEdward.faltanDelArea).toBeGreaterThan(0);
    expect(ctxEdward.miAsignacion).toBeNull();
    expect(ctxEdward.puedeEnviar).toBe(true);
    expect(ctxEdward.agenciaActual).toBe('Agencia A');

    const ctxBrian = await contextoEnvioDe(e.db, e.brian, id, T0);
    expect(ctxBrian.miAsignacion?.pedido).toBe('clasificar');
    expect(ctxBrian.miAsignacion?.deNombre).toBe('Edward');
    expect(ctxBrian.comentaSoloParaTodos).toBe(true);
    expect(ctxBrian.agenciaActual).toBeNull(); // no se le dice a una agencia cual es la otra

    const ctxLector = await contextoEnvioDe(e.db, e.lector, id, T0);
    expect(ctxLector.puedeEnviar).toBe(false);
    expect(ctxLector.puedeComentar).toBe(false);
  });
});

describe('historial de la ficha: autor, motivo oculto a la aduana (PA-38) y restaurar', () => {
  it('lista el historial con el valor anterior restaurable; el motivo de un interno no llega a la aduana', async () => {
    const id = await nuevaFicha(e, { codigo: 'HIS-0001' });
    await escribir(e.edward, id, 'marca', { texto: 'NAGA' });
    await escribir(e.admin, id, 'marca', { texto: 'NAGA Chemicals' }, 'Así aparece en la factura');
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId }] });

    const h = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'marca' });
    expect(h.items.map((x) => x.version)).toEqual([2, 1]);
    expect(h.items[0]).toMatchObject({ vigente: true, restaurable: false, autor: 'Ana Admin', motivo: 'Así aparece en la factura', valor: 'NAGA Chemicals' });
    expect(h.items[1]).toMatchObject({ vigente: false, restaurable: true, autor: 'Edward', autorEsPropio: true, valor: 'NAGA' });
    expect(h.campos.map((c) => c.etiqueta)).toContain('Marca');

    // La aduana ve que hubo un cambio, quien y cuando, pero NO el porque.
    const paraAduana = await historialDeFichaDe(e.db, e.brian, id, T0, { campo: 'marca' });
    expect(paraAduana.items[0]?.motivo).toBeNull();
    expect(paraAduana.items[0]?.hayMotivoOculto).toBe(true);
    expect(JSON.stringify(paraAduana)).not.toContain('factura');
    // Y no puede restaurar un campo del grupo cliente.
    expect(paraAduana.items.every((x) => !x.restaurable)).toBe(true);
  });

  it('restaurar repone el valor con un hecho nuevo, pide motivo y avisa al autor; el historial no pierde nada', async () => {
    const id = await nuevaFicha(e, { codigo: 'HIS-0002' });
    await escribir(e.edward, id, 'marca', { texto: 'NAGA' });
    await escribir(e.admin, id, 'marca', { texto: 'OTRA' }, 'Corrección');
    const antes = await historialDeFichaDe(e.db, e.admin, id, T0, { campo: 'marca' });
    const v1 = antes.items.find((x) => x.version === 1)!;

    await rechazaCon(restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'marca', historialId: v1.id }), /motivo/i);
    // Edward restaura su valor sobre el de Ana: exige motivo y a Ana le llega el aviso.
    const r = await restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'marca', historialId: v1.id, motivo: 'Era el nombre correcto' });
    expect(r.escrito).toBe(true);
    const despues = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'marca' });
    expect(despues.items.map((x) => [x.version, x.tipoEvento])).toEqual([
      [3, 'restaurar'],
      [2, 'fijar'],
      [1, 'fijar'],
    ]);
    expect(despues.items[0]).toMatchObject({ vigente: true, valor: 'NAGA', motivo: 'Era el nombre correcto' });
    const avisosAna = (await notificacionesDe(e.db, e.admin, { limite: 50 })).items.filter((n) => n.tipo === 'cambio_en_mi_campo' && n.referenciaId === id);
    expect(avisosAna.length).toBeGreaterThanOrEqual(1);
  });

  it('una ficha clasificada no ofrece restaurar; el filtro por campo y la paginacion funcionan', async () => {
    const id = await nuevaFicha(e, { codigo: 'HIS-0003' });
    for (let i = 1; i <= 5; i++) await escribir(e.edward, id, 'uso', `Uso versión ${i}`);
    await escribir(e.edward, id, 'marca', { texto: 'X' });
    const todo = await historialDeFichaDe(e.db, e.edward, id, T0, { limite: 4 });
    expect(todo.items).toHaveLength(4);
    expect(todo.siguiente).toBeTruthy();
    const resto = await historialDeFichaDe(e.db, e.edward, id, T0, { limite: 4, antes: todo.siguiente });
    expect(resto.items.length).toBeGreaterThan(0);
    const solo = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'uso' });
    expect(solo.items.every((x) => x.campo === 'uso')).toBe(true);

    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: T0 }).where(eq(referencia.id, id));
    const cerrada = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'uso' });
    expect(cerrada.items.every((x) => !x.restaurable)).toBe(true);
  });

  it('resumen "quien lo puso y cuando" por campo, con el autor enmascarado segun quien mira', async () => {
    const id = await nuevaFicha(e, { codigo: 'RES-0001' });
    await escribir(e.edward, id, 'marca', { texto: 'NAGA' });
    await escribir(e.admin, id, 'marca', { texto: 'NAGA 2' }, 'Corrección');
    const r = await resumenCamposDe(e.db, e.edward, id, T0);
    const marca = r.campos.find((c) => c.clave === 'marca')!;
    expect(marca).toMatchObject({ autor: 'Ana Admin', propio: false, version: 2 });
    expect(r.campos.find((c) => c.clave === 'nombre_producto')).toBeTruthy();
    await expect(resumenCamposDe(e.db, e.brianB, id, T0)).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
