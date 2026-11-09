/**
 * Pruebas en Postgres REAL (rol `app`, conexiones concurrentes): doble clic y dos pestanas sobre las acciones de
 * colaboracion. Ningun aviso se pierde ni se duplica, no hay interbloqueos (40P01) y el tope de envios por hora es exacto.
 */
import { and, count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, auditoria, comentario, notificacion, organizacion, usuario } from '@/db/esquema';
import { cancelarAsignacion, enviarA, marcarListo, recordar, reasignar } from '@/server/acciones/asignaciones';
import { finalizar, solicitarReapertura } from '@/server/acciones/aduana';
import { comentar } from '@/server/acciones/comentarios-y-bandeja';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { latidoEdicion } from '@/server/acciones/estado-ficha';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let admin: Actor;
let edward: Actor;
let charles: Actor;
let mant: Actor;
let brian: Actor;
let n = 0;

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  const [agencia] = await r.migrador.db.insert(organizacion).values({ nombre: 'Agencia A', tipo: 'agencia' }).returning();
  const mk = async (nombre: string, email: string, rol: string, org = interna!, tipo = 'interna', area?: string) => {
    const [u] = await r.migrador.db
      .insert(usuario)
      .values({ nombre, email, rol, organizacionId: org.id, organizacionTipo: tipo, ...(area ? { area } : {}) })
      .returning({ id: usuario.id });
    return (await cargarActorPorId(r.app.db, u!.id))!;
  };
  admin = await mk('Ana Admin', 'ana@prueba.invalid', 'admin');
  edward = await mk('Edward', 'edward@prueba.invalid', 'solicitante', interna!, 'interna', 'Consumibles');
  charles = await mk('Charles', 'charles@prueba.invalid', 'solicitante', interna!, 'interna', 'Consumibles');
  mant = await mk('Mantenimiento', 'mant@prueba.invalid', 'solicitante', interna!, 'interna', 'Mantenimiento');
  brian = await mk('Brian', 'brian@prueba.invalid', 'aduana', agencia!, 'agencia');
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

const ctx = (actor: Actor, ahora?: Date) => ({ db: r.app.db, actor, ...(ahora ? { ahora } : {}) });

async function ficha(actor = edward): Promise<string> {
  n += 1;
  const x = await crearReferencia(ctx(actor), { codigo: `CONC-${n}`, nombreProducto: `Concurrencia ${n}`, tipoProducto: 'INSUMO' });
  return x.id;
}

/** Resultados de N ejecuciones simultaneas: cuantas fueron bien y los codigos de error de las que no. */
async function enParalelo<T>(veces: number, fn: (i: number) => Promise<T>) {
  const res = await Promise.allSettled(Array.from({ length: veces }, (_, i) => fn(i)));
  const ok = res.filter((x): x is PromiseFulfilledResult<Awaited<T>> => x.status === 'fulfilled').map((x) => x.value);
  const errores = res
    .filter((x): x is PromiseRejectedResult => x.status === 'rejected')
    .map((x) => (x.reason instanceof ErrorAccion ? x.reason.codigo : `INESPERADO:${String((x.reason as { cause?: { code?: string } })?.cause?.code ?? (x.reason as Error)?.message)}`));
  return { ok, errores };
}

const avisos = async (usuarioId: string, tipo: string, referenciaId: string) =>
  (await r.migrador.db.select({ c: count() }).from(notificacion).where(and(eq(notificacion.usuarioId, usuarioId), eq(notificacion.tipo, tipo), eq(notificacion.referenciaId, referenciaId))))[0]!.c;

describe('doble clic y varias pestanas en Postgres real', () => {
  it('«Enviar a…» x8 simultaneos con el mismo contenido: una asignacion, un aviso y una auditoria por destinatario, sin interbloqueos', async () => {
    const id = await ficha();
    const entrada = { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' as const }, { usuarioId: mant.usuarioId, pedido: 'completar' as const }, { usuarioId: brian.usuarioId, pedido: 'clasificar' as const }], mensaje: 'Doble clic' };
    const { ok, errores } = await enParalelo(8, () => enviarA(ctx(edward), entrada));
    expect(errores).toEqual([]);
    expect(ok.reduce((a, x) => a + x.creadas, 0)).toBe(3); // exactamente 3 creaciones entre las 8 llamadas
    const activas = await r.migrador.db.select().from(asignacion).where(eq(asignacion.referenciaId, id));
    expect(activas.filter((a) => a.estado === 'pendiente')).toHaveLength(3);
    for (const dest of [charles, mant, brian]) expect(await avisos(dest.usuarioId, 'asignacion', id), dest.nombre).toBe(1);
    const aud = await r.migrador.db.select({ c: count() }).from(auditoria).where(eq(auditoria.accion, 'enviar_a'));
    expect(aud[0]!.c).toBeGreaterThanOrEqual(3);
  });

  it('«Listo por mi parte» x6: una sola transicion y un solo aviso a quien envio', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' }] });
    const { ok, errores } = await enParalelo(6, () => marcarListo(ctx(charles), { referenciaId: id }));
    expect(errores).toEqual([]);
    expect(ok.filter((x) => !x.yaEstaba)).toHaveLength(1);
    expect(await avisos(edward.usuarioId, 'respuesta', id)).toBe(1);
  });

  it('«Cancelar» x5: un solo aviso a la persona; el resto responde «ya estaba»', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' }] });
    const [a] = await r.migrador.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, charles.usuarioId)));
    const { ok, errores } = await enParalelo(5, () => cancelarAsignacion(ctx(edward), { asignacionId: a!.id }));
    expect(errores).toEqual([]);
    expect(ok.filter((x) => !x.yaEstaba)).toHaveLength(1);
    expect(await avisos(charles.usuarioId, 'asignacion', id)).toBe(2); // el envio + la cancelacion
  });

  it('«Recordar» x6 el mismo dia: el tope de 1 por dia se respeta exacto (1 aviso, 5 LIMITE_TASA)', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
    const [a] = await r.migrador.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, mant.usuarioId)));
    const { ok, errores } = await enParalelo(6, () => recordar(ctx(edward), { asignacionId: a!.id }));
    expect(ok).toHaveLength(1);
    expect(errores.filter((x) => x === 'LIMITE_TASA')).toHaveLength(5);
    expect(await avisos(mant.usuarioId, 'recordatorio', id)).toBe(1);
  });

  it('«Reasignar» x4 la misma asignacion: una sola gana, la nueva persona recibe UN aviso, sin interbloqueo', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' }] });
    const [a] = await r.migrador.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, charles.usuarioId)));
    const { ok, errores } = await enParalelo(4, () => reasignar(ctx(edward), { asignacionId: a!.id, aUsuarioId: mant.usuarioId }));
    expect(ok).toHaveLength(1);
    expect(errores.every((x) => x === 'VALIDACION')).toBe(true);
    expect(await avisos(mant.usuarioId, 'asignacion', id)).toBe(1);
  });

  it('mezcla cruzada sobre la misma ficha (enviar, listo, cancelar, comentar, guardar, latido) sin interbloqueos 40P01 ni errores inesperados', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' }] });
    const [a] = await r.migrador.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, charles.usuarioId)));
    const tareas = [
      () => marcarListo(ctx(charles), { referenciaId: id }),
      () => cancelarAsignacion(ctx(edward), { asignacionId: a!.id }),
      () => enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] }),
      () => comentar(ctx(charles), { referenciaId: id, texto: 'en paralelo', visibilidad: 'interno' }),
      () => guardarCampo(ctx(edward), { referenciaId: id, campo: 'uso', valor: 'uso', versionEsperada: 0 }),
      () => latidoEdicion(ctx(charles), { referenciaId: id, campo: 'funciones' }),
      () => recordar(ctx(admin), { asignacionId: a!.id }),
      () => enviarA(ctx(charles), { referenciaId: id, destinatarios: [{ usuarioId: edward.usuarioId, pedido: 'completar' }] }),
    ];
    for (let ronda = 0; ronda < 5; ronda++) {
      const res = await Promise.allSettled(tareas.map((t) => t()));
      const inesperados = res.filter((x) => x.status === 'rejected' && !(x.reason instanceof ErrorAccion));
      expect(inesperados.map((x) => String((x as PromiseRejectedResult).reason?.cause?.code ?? (x as PromiseRejectedResult).reason)), `ronda ${ronda}`).toEqual([]);
    }
    // invariante: a lo sumo una asignacion activa por (ficha, persona)
    const activas = await r.migrador.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id)));
    const claves = activas.filter((x) => x.estado === 'pendiente' || x.estado === 'en_curso').map((x) => x.aUsuarioId);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it('«Comentar» x10 a la vez: 10 comentarios y 10 avisos al creador, ninguno perdido', async () => {
    const id = await ficha();
    const { errores } = await enParalelo(10, (i) => comentar(ctx(charles), { referenciaId: id, texto: `comentario ${i}`, visibilidad: 'interno' }));
    expect(errores).toEqual([]);
    expect((await r.migrador.db.select({ c: count() }).from(comentario).where(eq(comentario.referenciaId, id)))[0]!.c).toBe(10);
    expect(await avisos(edward.usuarioId, 'comentario', id)).toBe(10);
  });

  it('«Cerrar clasificacion» x3 a la vez: una cierra, las otras reciben FICHA_CERRADA, un solo aviso «clasificada»', async () => {
    const id = await ficha();
    await enviarA(ctx(edward), { referenciaId: id, destinatarios: [{ usuarioId: brian.usuarioId, pedido: 'clasificar' }] });
    const v = (campo: string) => 0 * campo.length;
    await guardarCampo(ctx(admin), { referenciaId: id, campo: 'requiere_rim', valor: 'NO', versionEsperada: v('requiere_rim') });
    await fijarPartida(ctx(admin), { referenciaId: id, partida: '8421.39.90.00', versionEsperada: 0 });
    const { ok, errores } = await enParalelo(3, () => finalizar(ctx(brian), { referenciaId: id, motivoCerrarDeTodosModos: 'Cierre de prueba' }));
    expect(ok).toHaveLength(1);
    expect(errores.every((x) => x === 'FICHA_CERRADA')).toBe(true);
    expect(await avisos(edward.usuarioId, 'clasificada', id)).toBe(1);

    // Avisos agrupados: dos «Solicitar reapertura» simultaneas dejan UNA solicitud y UN aviso a cada admin
    // (la segunda espera el bloqueo de la ficha, ve el aviso sin leer de la primera y lo renueva)
    const dos = await enParalelo(2, () => solicitarReapertura(ctx(edward), { referenciaId: id, motivo: 'Cambio el proveedor' }));
    expect(dos.errores).toEqual([]);
    expect(await avisos(admin.usuarioId, 'reapertura_solicitada', id)).toBe(1);
    const revisar = (await r.migrador.db.select().from(asignacion).where(eq(asignacion.referenciaId, id))).filter((x) => x.pedido === 'revisar' && (x.estado === 'pendiente' || x.estado === 'en_curso'));
    expect(revisar).toHaveLength(1);
  });

  it('tope de 60 envios/hora con 75 llamadas simultaneas de la misma persona: exactamente 60 pasan y 15 reciben LIMITE_TASA', async () => {
    const id = await ficha(mant);
    const hora = new Date('2026-11-03T14:10:00.000Z');
    const entrada = { referenciaId: id, destinatarios: [{ usuarioId: charles.usuarioId, pedido: 'completar' as const }] };
    const { ok, errores } = await enParalelo(75, () => enviarA(ctx(mant, hora), entrada));
    expect(ok).toHaveLength(60);
    expect(errores.filter((x) => x === 'LIMITE_TASA')).toHaveLength(15);
    expect(errores.filter((x) => x !== 'LIMITE_TASA')).toEqual([]);
    expect(await avisos(charles.usuarioId, 'asignacion', id)).toBe(1);
  });
});
