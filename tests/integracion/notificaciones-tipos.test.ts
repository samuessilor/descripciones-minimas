/**
 * Pruebas de colaboracion: matriz de los 8 tipos de notificacion (quien la genera, a quien llega y a quien NO),
 * ciclo de lectura (campana y bandeja), aislamiento entre cuentas y ausencia de duplicados.
 * Escenario parecido al de produccion: 1 admin (+1 segundo admin), 4 cuentas de area, 1 agencia de aduana (A) y otra (B).
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, campoHistorial, notificacion, usuario } from '@/db/esquema';
import { enviarA, marcarListo, cancelarAsignacion, reasignar, recordar, abrirFicha } from '@/server/acciones/asignaciones';
import { finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { comentar, listarNotificaciones, marcarNotificacionLeida, marcarTodasLeidas } from '@/server/acciones/comentarios-y-bandeja';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { crearCuenta } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { contarNoLeidasDe } from '@/server/politicas/colaboracion';
import { asignarAAduana, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { escribir, fichaEnAduana, llenarComoArea } from './ayudas-aduana';

let e: Escenario;
let consumibles: Actor;
let mant: Actor;
let instr: Actor;
let mkt: Actor;
let admin2: Actor;
const T0 = new Date('2026-11-02T15:00:00.000Z');
let n = 0;

async function cuenta(nombre: string, usuarioNombre: string, rol: 'admin' | 'solicitante', area?: string): Promise<Actor> {
  const r = await crearCuenta(e.ctx(e.admin), {
    nombre,
    usuario: usuarioNombre,
    email: `${usuarioNombre}@prueba.invalid`,
    organizacionId: e.orgInterna,
    rol,
    ...(area ? { area } : {}),
  });
  return (await cargarActorPorId(e.db, r.id))!;
}

beforeAll(async () => {
  e = await nuevoEscenario();
  await e.db.update(usuario).set({ area: 'Consumibles' }).where(eq(usuario.id, e.edward.usuarioId));
  consumibles = (await cargarActorPorId(e.db, e.edward.usuarioId))!;
  mant = await cuenta('Mantenimiento', 'mantenimiento', 'solicitante', 'Mantenimiento');
  instr = await cuenta('Instrumentos', 'instrumentos', 'solicitante', 'Instrumentos');
  mkt = await cuenta('Marketing', 'marketing', 'solicitante', 'Marketing');
  admin2 = await cuenta('Segundo Admin', 'admin2', 'admin');
});
afterAll(async () => {
  await e.c.cerrar();
});

/** Todos los avisos de una persona, de un tipo, sobre una ficha. */
async function avisos(a: Actor, tipo: string, ficha: string) {
  return e.db
    .select()
    .from(notificacion)
    .where(and(eq(notificacion.usuarioId, a.usuarioId), eq(notificacion.tipo, tipo), eq(notificacion.referenciaId, ficha)));
}

/** Cuantos avisos de `tipo` sobre `ficha` tiene cada persona (para comparar el reparto completo). */
async function reparto(tipo: string, ficha: string): Promise<Record<string, number>> {
  const todos: Array<[string, Actor]> = [
    ['edward', consumibles],
    ['charles', e.charles],
    ['mant', mant],
    ['instr', instr],
    ['mkt', mkt],
    ['admin', e.admin],
    ['admin2', admin2],
    ['lector', e.lector],
    ['brian', e.brian],
    ['brianB', e.brianB],
  ];
  const out: Record<string, number> = {};
  for (const [nombre, a] of todos) out[nombre] = (await avisos(a, tipo, ficha)).length;
  return out;
}
const CERO = { edward: 0, charles: 0, mant: 0, instr: 0, mkt: 0, admin: 0, admin2: 0, lector: 0, brian: 0, brianB: 0 };

async function codigoError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

async function nueva(actor: Actor, area?: string): Promise<string> {
  n += 1;
  const r = await crearReferencia(e.ctx(actor, T0), {
    codigo: `NOTI-${String(n).padStart(3, '0')}`,
    nombreProducto: `Producto de avisos ${n}`,
    tipoProducto: 'INSUMO',
    ...(area ? { areaResponsable: area } : {}),
  });
  return r.id;
}

async function ponerPartida(id: string, actor: Actor = e.brian) {
  return fijarPartida(e.ctx(actor, T0), { referenciaId: id, partida: '8421.39.90.00', versionEsperada: await versionDe(e.db, id, 'partida_arancelaria') });
}

/**
 * Ficha completa con historia: la crea Edward (Consumibles), se la envia a Mantenimiento (completar) y Mantenimiento se la
 * pasa a la agencia A (Brian). Queda lista para cerrar (RIM respondido).
 */
async function fichaConHistoria(): Promise<string> {
  const id = await nueva(consumibles, 'Mantenimiento');
  await llenarComoArea(e, id, consumibles);
  await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
  await enviarA(e.ctx(mant, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'clasificar' }] });
  await escribir(e, e.brian, id, 'requiere_rim', 'NO');
  await ponerPartida(id);
  return id;
}

describe('tipo «asignacion»', () => {
  it('enviar: llega SOLO a los destinatarios (1 c/u), con asignacionId y enlace a la ficha; ni el remitente ni terceros reciben nada', async () => {
    const id = await nueva(consumibles);
    const r = await enviarA(e.ctx(consumibles, T0), {
      referenciaId: id,
      destinatarios: [
        { usuarioId: mant.usuarioId, pedido: 'completar' },
        { usuarioId: instr.usuarioId, pedido: 'completar' },
        { usuarioId: e.brian.usuarioId, pedido: 'clasificar' },
      ],
      mensaje: 'Por favor revisar.',
    });
    expect(r.creadas).toBe(3);
    expect(await reparto('asignacion', id)).toEqual({ ...CERO, mant: 1, instr: 1, brian: 1 });

    const [aviso] = await avisos(mant, 'asignacion', id);
    expect(aviso!.leidaEn).toBeNull();
    expect(aviso!.titulo).toMatch(/te envió NOTI-\d+ para completar/);
    const [asig] = await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, mant.usuarioId)));
    expect(aviso!.asignacionId).toBe(asig!.id);

    const lista = await listarNotificaciones(e.ctx(mant), {});
    const vista = lista.items.find((x) => x.id === aviso!.id)!;
    expect(vista.href).toBe(`/referencias/${id}`);
    expect(vista.tipo).toBe('asignacion');
  });

  it('reenviar igual: nada nuevo; cambiar el mensaje: UN aviso «actualizo»; cancelar y reasignar avisan UNA vez a cada afectado', async () => {
    const id = await nueva(consumibles);
    const base = { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' as const }] };
    await enviarA(e.ctx(consumibles, T0), { ...base, mensaje: 'uno' });
    await enviarA(e.ctx(consumibles, T0), { ...base, mensaje: 'uno' });
    expect((await avisos(mant, 'asignacion', id)).length).toBe(1);
    await enviarA(e.ctx(consumibles, T0), { ...base, mensaje: 'dos' });
    const tras = await avisos(mant, 'asignacion', id);
    expect(tras.length).toBe(2);
    expect(tras.some((a) => /actualizó lo que te pide/.test(a.titulo))).toBe(true);

    // Reasignar a Instrumentos: la vieja (mant) recibe «ya no tienes nada», la nueva (instr) el envio; el resto, nada.
    const [asig] = await e.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, mant.usuarioId), eq(asignacion.estado, 'pendiente')));
    await reasignar(e.ctx(consumibles, T0), { asignacionId: asig!.id, aUsuarioId: instr.usuarioId });
    expect((await avisos(instr, 'asignacion', id)).length).toBe(1);
    const aMant = await avisos(mant, 'asignacion', id);
    expect(aMant.length).toBe(3);
    expect(aMant.some((a) => /Ya no tienes nada pendiente/.test(a.titulo))).toBe(true);

    // Cancelar lo de Instrumentos: un aviso a Instrumentos y nada para Mantenimiento.
    const [asig2] = await e.db
      .select()
      .from(asignacion)
      .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, instr.usuarioId), eq(asignacion.estado, 'pendiente')));
    await cancelarAsignacion(e.ctx(consumibles, T0), { asignacionId: asig2!.id });
    await cancelarAsignacion(e.ctx(consumibles, T0), { asignacionId: asig2!.id }); // doble clic
    const aInstr = await avisos(instr, 'asignacion', id);
    expect(aInstr.length).toBe(2);
    expect(aInstr.filter((a) => /canceló/.test(a.titulo)).length).toBe(1);
    expect((await avisos(mant, 'asignacion', id)).length).toBe(3);
  });
});

describe('tipo «recordatorio»', () => {
  it('lo genera quien envio (o admin/lector), llega solo al destinatario, tope de 1 por dia y se repite al dia siguiente', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
    const [asig] = await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, mant.usuarioId)));

    expect(await codigoError(recordar(e.ctx(instr, T0), { asignacionId: asig!.id }))).toBe('SIN_PERMISO'); // un tercero no recuerda
    await recordar(e.ctx(consumibles, new Date(T0.getTime() + 3 * 86_400_000)), { asignacionId: asig!.id });
    expect(await codigoError(recordar(e.ctx(consumibles, new Date(T0.getTime() + 3 * 86_400_000 + 60_000)), { asignacionId: asig!.id }))).toBe('LIMITE_TASA');
    expect(await reparto('recordatorio', id)).toEqual({ ...CERO, mant: 1 });
    const [rec] = await avisos(mant, 'recordatorio', id);
    expect(rec!.asignacionId).toBe(asig!.id);
    expect(rec!.titulo).toMatch(/te recuerda NOTI-\d+, que sigue pendiente desde hace 3 días/);

    await recordar(e.ctx(e.admin, new Date(T0.getTime() + 4 * 86_400_000)), { asignacionId: asig!.id }); // el admin tambien puede, otro dia
    await recordar(e.ctx(e.lector, new Date(T0.getTime() + 5 * 86_400_000)), { asignacionId: asig!.id }); // y quien lleva el proceso
    expect((await avisos(mant, 'recordatorio', id)).length).toBe(3);
  });
});

describe('tipo «respuesta»', () => {
  it('«Listo por mi parte»: avisa UNA vez a quien envio; repetirlo no duplica; los demas no reciben nada', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
    const r1 = await marcarListo(e.ctx(mant, T0), { referenciaId: id });
    const r2 = await marcarListo(e.ctx(mant, T0), { referenciaId: id });
    expect(r1.avisados).toEqual([consumibles.usuarioId]);
    expect(r2).toMatchObject({ yaEstaba: true, avisados: [] });
    expect(await reparto('respuesta', id)).toEqual({ ...CERO, edward: 1 });
  });

  it('la respuesta del area a la solicitud de la aduana avisa a quien la escribio; corregir la respuesta renueva el aviso sin leer, y si ya lo leyo avisa de nuevo', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'descripciones_minimas', 'Necesito el caudal nominal.');
    await escribir(e, e.edward, id, 'respuesta_area', 'Son 12 m3/h.');
    expect((await avisos(e.brian, 'respuesta', id)).length).toBe(1);
    // Corregida la respuesta antes de que la aduana lea el aviso: se renueva ese mismo aviso (avisos agrupados), no se suma otro
    const [primero] = await avisos(e.brian, 'respuesta', id);
    await escribir(e, e.edward, id, 'respuesta_area', 'Son 14 m3/h.');
    const trasCorregir = await avisos(e.brian, 'respuesta', id);
    expect(trasCorregir).toHaveLength(1);
    expect(trasCorregir[0]!.id).toBe(primero!.id);
    expect(trasCorregir[0]!.leidaEn).toBeNull();
    // Si la aduana ya lo leyo, la siguiente correccion si es una novedad y avisa de nuevo
    await marcarNotificacionLeida(e.ctx(e.brian), { notificacionId: primero!.id });
    await escribir(e, e.edward, id, 'respuesta_area', 'Son 15 m3/h.');
    expect(await avisos(e.brian, 'respuesta', id)).toHaveLength(2);
    // nadie mas
    expect((await avisos(e.admin, 'respuesta', id)).length).toBe(0);
    expect((await avisos(e.brianB, 'respuesta', id)).length).toBe(0);
  });
});

describe('tipo «clasificada»', () => {
  it('al cerrar: la reciben quien creo la ficha y quienes la enviaron; NO quien cierra, ni admins, ni otras agencias, ni el lector', async () => {
    const id = await fichaConHistoria();
    await finalizar(e.ctx(e.brian, T0), { referenciaId: id, motivoCerrarDeTodosModos: 'Cierre de prueba.' });
    expect(await reparto('clasificada', id)).toEqual({ ...CERO, edward: 1, mant: 1 });
    const [a] = await avisos(consumibles, 'clasificada', id);
    expect(a!.titulo).toMatch(/Brian cerró la clasificación de/);
    // cerrar de nuevo es imposible y no genera otro aviso
    expect(await codigoError(finalizar(e.ctx(e.brian, T0), { referenciaId: id }))).toBe('FICHA_CERRADA');
    expect((await avisos(consumibles, 'clasificada', id)).length).toBe(1);
  });
});

describe('tipo «reabierta» y «reapertura_solicitada»', () => {
  it('solicitar reapertura: avisa a TODOS los admins (menos al solicitante) y a quien clasifico; no a terceros', async () => {
    const id = await fichaConHistoria();
    await finalizar(e.ctx(e.brian, T0), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await solicitarReapertura(e.ctx(consumibles, T0), { referenciaId: id, motivo: 'Cambio la ficha tecnica del proveedor.' });
    expect(await reparto('reapertura_solicitada', id)).toEqual({ ...CERO, admin: 1, admin2: 1, brian: 1 });
    const [a] = await avisos(e.admin, 'reapertura_solicitada', id);
    expect(a!.titulo).toMatch(/Edward pidió reabrir la clasificación de/);
    // el solicitante (no admin) sin permiso para reabrir; y la solicitud no reabrio nada
    expect(await codigoError(reabrir(e.ctx(consumibles, T0), { referenciaId: id, motivo: 'x' }))).toBe('SIN_PERMISO');
  });

  it('reabrir: avisa a creador, remitentes, a quien clasifico y a quien recibe la ficha; NO a quien reabre ni a terceros', async () => {
    const id = await fichaConHistoria();
    await finalizar(e.ctx(e.brian, T0), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await reabrir(e.ctx(e.admin, new Date(T0.getTime() + 86_400_000)), { referenciaId: id, motivo: 'La agencia pide corregir la partida.' });
    expect(await reparto('reabierta', id)).toEqual({ ...CERO, edward: 1, mant: 1, brian: 1 });

    // segundo ciclo, ahora reabre la propia aduana: ella no se avisa a si misma
    await finalizar(e.ctx(e.brian, new Date(T0.getTime() + 2 * 86_400_000)), { referenciaId: id, motivoCerrarDeTodosModos: 'ok' });
    await reabrir(e.ctx(e.brian, new Date(T0.getTime() + 3 * 86_400_000)), { referenciaId: id, motivo: 'Otra vez.' });
    // el admin que reabrio dejo a Brian un pendiente «clasificar» (de: admin) y desde entonces es remitente interesado en la ficha
    expect(await reparto('reabierta', id)).toEqual({ ...CERO, edward: 2, mant: 2, brian: 1, admin: 1 });
    expect(await reparto('clasificada', id)).toEqual({ ...CERO, edward: 2, mant: 2, admin: 1 });
  });
});

describe('tipo «cambio_en_mi_campo»', () => {
  it('lo recibe el autor del valor reemplazado por otra persona (guardar, restaurar y vaciar como admin); nunca el propio autor', async () => {
    const id = await nueva(consumibles);
    const w = (actor: Actor, campo: string, valor: unknown, motivo?: string) =>
      versionDe(e.db, id, campo).then((v) => guardarCampo(e.ctx(actor, T0), { referenciaId: id, campo, valor, versionEsperada: v, ...(motivo ? { motivo } : {}) }));

    await w(consumibles, 'uso', 'Uso original');
    await w(consumibles, 'uso', 'Uso corregido por mi'); // propio: sin aviso
    expect(await reparto('cambio_en_mi_campo', id)).toEqual(CERO);

    await w(e.charles, 'uso', 'Uso de Charles', 'La ficha tecnica dice otra cosa');
    expect(await reparto('cambio_en_mi_campo', id)).toEqual({ ...CERO, edward: 1 });

    // restaurar el valor de Edward sobre el de Charles: ahora el afectado es Charles
    const [h] = await e.db
      .select({ id: campoHistorial.id })
      .from(campoHistorial)
      .where(and(eq(campoHistorial.referenciaId, id), eq(campoHistorial.campo, 'uso'), eq(campoHistorial.versionCampo, 2)));
    await restaurarCampo(e.ctx(consumibles, T0), { referenciaId: id, campo: 'uso', historialId: Number(h!.id), motivo: 'Vuelvo al texto de la ficha.' });
    expect(await reparto('cambio_en_mi_campo', id)).toEqual({ ...CERO, edward: 1, charles: 1 });

    // un admin vacia un valor ajeno (con motivo): avisa a su autor
    await w(e.admin, 'uso', null, 'Estaba duplicado en otra referencia');
    expect((await avisos(consumibles, 'cambio_en_mi_campo', id)).length).toBe(2);
  });
});

describe('tipo «comentario»', () => {
  it('interno no llega a la agencia; «tambien la aduana» si; nunca al autor, al lector ni a terceros sin relacion con la ficha', async () => {
    const id = await nueva(consumibles, 'Instrumentos'); // area responsable: Instrumentos
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
    await asignarAAduana(e, id, e.brian, mant);

    await comentar(e.ctx(mant, T0), { referenciaId: id, texto: 'Solo internos', visibilidad: 'interno' });
    expect(await reparto('comentario', id)).toEqual({ ...CERO, edward: 1 }); // creador; Brian (agencia) no

    await comentar(e.ctx(mant, T0), { referenciaId: id, texto: 'Para todos', visibilidad: 'todos', campo: 'uso' });
    expect(await reparto('comentario', id)).toEqual({ ...CERO, edward: 2, brian: 1 });
    const [conCampo] = (await avisos(e.brian, 'comentario', id));
    expect(conCampo!.titulo).toMatch(/Mantenimiento comentó en «.*» de NOTI-\d+/);

    // La aduana comenta: avisa al creador y a quien se la envio (Mantenimiento), no a si misma ni a la otra agencia
    await comentar(e.ctx(e.brian, T0), { referenciaId: id, texto: 'Dudas de la aduana', visibilidad: 'todos' });
    expect(await reparto('comentario', id)).toEqual({ ...CERO, edward: 3, mant: 1, brian: 1 });
  });

  it('OBSERVACION: la cuenta del AREA responsable (responsabilidad derivada) no recibe aviso de comentarios si nadie le envio la ficha', async () => {
    const id = await nueva(consumibles, 'Instrumentos');
    await comentar(e.ctx(e.admin, T0), { referenciaId: id, texto: 'Admin comenta', visibilidad: 'interno' });
    const r = await reparto('comentario', id);
    expect(r.edward).toBe(1); // el creador si
    expect(r.instr).toBe(0); // el area responsable (Instrumentos) no: solo ve el pendiente en «Para mi», sin aviso de comentario
  });
});

describe('ciclo de lectura: campana y bandeja', () => {
  it('marcar una (idempotente, conserva la primera hora), solo las propias, marcar todas, abrir la ficha marca solo esa ficha', async () => {
    const f1 = await nueva(consumibles);
    const f2 = await nueva(consumibles);
    for (const f of [f1, f2]) await enviarA(e.ctx(consumibles, T0), { referenciaId: f, destinatarios: [{ usuarioId: mkt.usuarioId, pedido: 'completar' }] });
    const antes = await contarNoLeidasDe(e.db, mkt);
    expect(antes).toBeGreaterThanOrEqual(2);

    const lista = await listarNotificaciones(e.ctx(mkt), { soloNoLeidas: true });
    expect(lista.noLeidas).toBe(antes);
    const primera = lista.items.find((x) => x.referenciaId === f1)!;
    // Otra persona no puede marcar un aviso ajeno
    expect(await codigoError(marcarNotificacionLeida(e.ctx(mant), { notificacionId: primera.id }))).toBe('NO_ENCONTRADO');
    await marcarNotificacionLeida(e.ctx(mkt, new Date('2026-11-02T16:00:00Z')), { notificacionId: primera.id });
    await marcarNotificacionLeida(e.ctx(mkt, new Date('2026-11-02T17:00:00Z')), { notificacionId: primera.id });
    const [fila] = await e.db.select().from(notificacion).where(eq(notificacion.id, primera.id));
    expect(fila!.leidaEn?.toISOString()).toBe('2026-11-02T16:00:00.000Z'); // la segunda llamada no pisa la primera
    expect(await contarNoLeidasDe(e.db, mkt)).toBe(antes - 1);

    // abrir la ficha 2 marca como leidos los avisos de ESA ficha y vuelve en_curso el pendiente
    const ab = await abrirFicha(e.ctx(mkt, T0), { referenciaId: f2 });
    expect(ab.enCurso).toBe(1);
    expect(ab.leidas).toBeGreaterThanOrEqual(1);
    expect(await abrirFicha(e.ctx(mkt, T0), { referenciaId: f2 })).toEqual({ enCurso: 0, leidas: 0 });

    // filtros de la bandeja
    const leidas = await listarNotificaciones(e.ctx(mkt), { soloLeidas: true });
    expect(leidas.items.every((x) => x.leidaEn !== null)).toBe(true);
    const sinLeer = await contarNoLeidasDe(e.db, mkt);
    const todas = await marcarTodasLeidas(e.ctx(mkt, T0));
    expect(todas.marcadas).toBe(sinLeer);
    expect(await contarNoLeidasDe(e.db, mkt)).toBe(0);
    expect((await marcarTodasLeidas(e.ctx(mkt, T0))).marcadas).toBe(0);
  });

  it('aislamiento entre cuentas: leer/marcar todo en una cuenta no toca a las demas', async () => {
    const f = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), {
      referenciaId: f,
      destinatarios: [
        { usuarioId: mant.usuarioId, pedido: 'completar' },
        { usuarioId: instr.usuarioId, pedido: 'completar' },
      ],
    });
    const instrAntes = await contarNoLeidasDe(e.db, instr);
    await marcarTodasLeidas(e.ctx(mant, T0));
    expect(await contarNoLeidasDe(e.db, mant)).toBe(0);
    expect(await contarNoLeidasDe(e.db, instr)).toBe(instrAntes);
    const deMant = await listarNotificaciones(e.ctx(mant), { limite: 100 });
    expect(deMant.items.every((x) => x.id !== '')).toBe(true);
    const idsInstr = new Set((await listarNotificaciones(e.ctx(instr), { limite: 100 })).items.map((x) => x.id));
    expect(deMant.items.some((x) => idsInstr.has(x.id))).toBe(false);
  });

  it('la base solo admite los 8 tipos de aviso', async () => {
    let fallo = '';
    try {
      const f = await nueva(consumibles);
      await e.db.insert(notificacion).values({ usuarioId: mant.usuarioId, tipo: 'inventado', referenciaId: f, titulo: 'x' });
    } catch (err) {
      fallo = String((err as { cause?: { message?: string }; message?: string }).cause?.message ?? (err as Error).message);
    }
    expect(fallo).toMatch(/notificacion_tipo_valido/);
  });
});
