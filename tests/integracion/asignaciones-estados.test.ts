/**
 * Pruebas de colaboracion: ciclo de vida de las asignaciones (pendiente / en_curso / hecha / reasignada / cancelada),
 * acceso temporal de la agencia, «Enviar a…» a varias personas (areas + agencia + admin), lotes, tope de envios por hora,
 * idempotencia (doble clic, dos pestanas) y solicitud de informacion de la aduana a un area con varias cuentas.
 */
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, notificacion, usuario } from '@/db/esquema';
import { abrirFicha, cancelarAsignacion, enviarA, enviarALote, marcarListo, reasignar } from '@/server/acciones/asignaciones';
import { archivar } from '@/server/acciones/aduana';
import { listarMisPendientes, listarNotificaciones, marcarTodasLeidas } from '@/server/acciones/comentarios-y-bandeja';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { ErrorAccion } from '@/server/acciones/resultado';
import { crearCuenta } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { esperandoDe, pendientesDe, resumenInicioDe } from '@/server/politicas/colaboracion';
import { nuevoEscenario, type Escenario } from './ayudas';
import { asignacionesDe as asigDe, escribir, llenarComoArea } from './ayudas-aduana';
import { fichaVisibleParaTest } from './ayudas-visibilidad';

let e: Escenario;
/** Deja las medidas en la salida de la prueba cuando se pide detalle (VITEST_MEDIDAS=1); si no, no hace ruido. */
function medir(texto: string): void {
  if (process.env.VITEST_MEDIDAS === '1') console.info(texto);
}
let consumibles: Actor;
let mant: Actor;
let instr: Actor;
let mkt: Actor;
let consumibles2: Actor;
let bruno: Actor; // segunda persona de la agencia A
const T0 = new Date('2026-11-02T15:00:00.000Z');
const DIA = 86_400_000;
let n = 0;

async function cuenta(nombre: string, usuarioNombre: string, rol: 'admin' | 'solicitante' | 'aduana', area?: string, org = e.orgInterna): Promise<Actor> {
  const r = await crearCuenta(e.ctx(e.admin), {
    nombre,
    usuario: usuarioNombre,
    email: `${usuarioNombre}@prueba.invalid`,
    organizacionId: org,
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
  consumibles2 = await cuenta('Consumibles 2', 'consumibles2', 'solicitante', 'Consumibles');
  bruno = await cuenta('Bruno', 'bruno', 'aduana', undefined, e.orgA);
});
afterAll(async () => {
  await e.c.cerrar();
});

async function nueva(actor: Actor, area?: string): Promise<string> {
  n += 1;
  const r = await crearReferencia(e.ctx(actor, T0), {
    codigo: `ASIG-${String(n).padStart(4, '0')}`,
    nombreProducto: `Producto de asignaciones ${n}`,
    tipoProducto: 'INSUMO',
    ...(area ? { areaResponsable: area } : {}),
  });
  return r.id;
}

async function codigoError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

const de = (a: Actor, pedido?: 'completar' | 'clasificar' | 'responder' | 'revisar') => ({ usuarioId: a.usuarioId, ...(pedido ? { pedido } : {}) });
const suyas = async (id: string, a: Actor) => (await asigDe(e, id)).filter((x) => x.aUsuarioId === a.usuarioId);
const conteo = async (tabla: typeof notificacion | typeof auditoria) => (await e.db.select({ c: count() }).from(tabla))[0]!.c;

describe('maquina de estados de la asignacion y acceso temporal de la agencia', () => {
  it('pendiente -> en_curso (abrir) -> hecha (listo): fechas, acceso de 30 dias EXACTOS y borde del acceso', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(e.brian, 'clasificar')] });
    const [pendiente] = await suyas(id, e.brian);
    expect(pendiente).toMatchObject({ estado: 'pendiente', vistaEn: null, completadaEn: null, accesoHasta: null });
    expect(await fichaVisibleParaTest(e, id, e.brian, T0)).toBe(true);
    expect(await fichaVisibleParaTest(e, id, e.brianB, T0)).toBe(false);

    const T1 = new Date(T0.getTime() + 3_600_000);
    expect(await abrirFicha(e.ctx(e.brian, T1), { referenciaId: id })).toMatchObject({ enCurso: 1 });
    const [enCurso] = await suyas(id, e.brian);
    expect(enCurso).toMatchObject({ estado: 'en_curso' });
    expect(enCurso!.vistaEn?.toISOString()).toBe(T1.toISOString());
    // abrir de nuevo no cambia nada (ni la hora de vista)
    await abrirFicha(e.ctx(e.brian, new Date(T1.getTime() + 60_000)), { referenciaId: id });
    expect((await suyas(id, e.brian))[0]!.vistaEn?.toISOString()).toBe(T1.toISOString());

    const T2 = new Date(T0.getTime() + 2 * DIA);
    await marcarListo(e.ctx(e.brian, T2), { referenciaId: id });
    const [hecha] = await suyas(id, e.brian);
    expect(hecha).toMatchObject({ estado: 'hecha' });
    expect(hecha!.completadaEn?.toISOString()).toBe(T2.toISOString());
    expect(hecha!.accesoHasta?.toISOString()).toBe(new Date(T2.getTime() + 30 * DIA).toISOString());
    expect(await fichaVisibleParaTest(e, id, e.brian, new Date(T2.getTime() + 30 * DIA - 1))).toBe(true);
    expect(await fichaVisibleParaTest(e, id, e.brian, new Date(T2.getTime() + 30 * DIA))).toBe(false); // el borde ya no cuenta
  });

  it('cancelada: la agencia pierde el acceso al instante y deja de verla en «Para mi»; la persona interna no tiene fecha de acceso', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(e.brian, 'clasificar'), de(mant, 'completar')] });
    expect(await pendientesDe(e.db, e.brian, T0).then((l) => l.some((p) => p.referenciaId === id))).toBe(true);
    const [aBrian] = await suyas(id, e.brian);
    await cancelarAsignacion(e.ctx(consumibles, T0), { asignacionId: aBrian!.id });
    const [cancelada] = await suyas(id, e.brian);
    expect(cancelada).toMatchObject({ estado: 'cancelada', accesoHasta: null });
    expect(cancelada!.completadaEn).not.toBeNull();
    expect(await fichaVisibleParaTest(e, id, e.brian, T0)).toBe(false);
    expect(await pendientesDe(e.db, e.brian, T0).then((l) => l.some((p) => p.referenciaId === id))).toBe(false);

    // Mantenimiento termina: hecha sin fecha de acceso (es interna y ve todo igual)
    await marcarListo(e.ctx(mant, T0), { referenciaId: id });
    expect((await suyas(id, mant))[0]).toMatchObject({ estado: 'hecha', accesoHasta: null });
  });

  it('reasignada: la vieja queda «reasignada» sin acceso propio, la nueva pendiente; la agencia B no puede recibirla salvo por un admin', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(e.brian, 'clasificar')] });
    const [vieja] = await suyas(id, e.brian);
    expect(await codigoError(reasignar(e.ctx(consumibles, T0), { asignacionId: vieja!.id, aUsuarioId: e.brianB.usuarioId }))).toBe('SIN_PERMISO');
    expect((await suyas(id, e.brian))[0]!.estado).toBe('pendiente'); // el rechazo no dejo nada a medias

    await reasignar(e.ctx(consumibles, T0), { asignacionId: vieja!.id, aUsuarioId: bruno.usuarioId });
    expect((await suyas(id, e.brian))[0]).toMatchObject({ estado: 'reasignada', accesoHasta: null });
    expect((await suyas(id, bruno))[0]).toMatchObject({ estado: 'pendiente', deUsuarioId: consumibles.usuarioId });
    // La agencia A sigue con la ficha (Bruno), por su organizacion
    expect(await fichaVisibleParaTest(e, id, e.brian, T0)).toBe(true);
    expect(await fichaVisibleParaTest(e, id, e.brianB, T0)).toBe(false);
    // doble clic en «Reasignar»: la segunda ya no tiene nada que reasignar y no deja otro aviso
    const avisosAntes = await conteo(notificacion);
    expect(await codigoError(reasignar(e.ctx(consumibles, T0), { asignacionId: vieja!.id, aUsuarioId: bruno.usuarioId }))).toBe('VALIDACION');
    expect(await conteo(notificacion)).toBe(avisosAntes);
  });

  it('«Para mi», «Esperando a otros» e Inicio cuentan lo mismo (invariantes) y solo incluyen pendiente/en_curso', async () => {
    const id = await nueva(consumibles);
    const id2 = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(instr, 'completar')] });
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id2, destinatarios: [de(instr, 'completar')] });
    await marcarListo(e.ctx(instr, T0), { referenciaId: id2 });
    const [a1] = await suyas(id, instr);
    for (const actor of [consumibles, mant, instr, mkt, e.admin, e.lector, e.brian, e.brianB]) {
      const para = await listarMisPendientes(e.ctx(actor, T0));
      const resumen = await resumenInicioDe(e.db, actor, T0);
      expect(resumen.pendientesParaMi, `Para mi de ${actor.nombre}`).toBe(para.length);
    }
    const mios = await pendientesDe(e.db, instr, T0);
    expect(mios.some((p) => p.referenciaId === id && p.asignacionId === a1!.id)).toBe(true);
    expect(mios.some((p) => p.referenciaId === id2)).toBe(false); // la que ya marco lista no aparece
    const esperando = await esperandoDe(e.db, consumibles, T0);
    expect(esperando.some((p) => p.referenciaId === id)).toBe(true);
    expect(esperando.some((p) => p.referenciaId === id2)).toBe(false);
    // y lo que envio una cuenta no le aparece como «esperando» a otra de las areas
    expect((await esperandoDe(e.db, mkt, T0)).some((p) => p.referenciaId === id)).toBe(false);
  });

  it('una ficha archivada sale de «Para mi», «Esperando» y del resumen, y vuelve al desarchivar', async () => {
    const id = await nueva(consumibles);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(mkt, 'completar')] });
    expect((await pendientesDe(e.db, mkt, T0)).some((p) => p.referenciaId === id)).toBe(true);
    await archivar(e.ctx(e.admin, T0), { referenciaId: id, motivo: 'Prueba de auditoria.' });
    expect((await pendientesDe(e.db, mkt, T0)).some((p) => p.referenciaId === id)).toBe(false);
    expect((await esperandoDe(e.db, consumibles, T0)).some((p) => p.referenciaId === id)).toBe(false);
    expect(await codigoError(enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(instr, 'completar')] }))).toBe('FICHA_CERRADA');
    expect(await codigoError(marcarListo(e.ctx(mkt, T0), { referenciaId: id }))).toBe('NINGUNO'); // marcar lista una archivada es inocuo
  });
});

describe('«Enviar a…» a varias cuentas a la vez (areas, agencia, admin)', () => {
  it('4 areas + agencia + admin en UN envio: una asignacion y un aviso por destinatario, nada para el remitente; repetir = 0 filas nuevas', async () => {
    const id = await nueva(consumibles);
    const destinos = [de(mant), de(instr), de(mkt), de(consumibles2), de(e.brian), de(e.admin)];
    const avisosAntes = await conteo(notificacion);
    const auditoriaAntes = await conteo(auditoria);
    const r = await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: destinos, mensaje: 'Para todas las areas' });
    expect(r.creadas).toBe(6);
    expect(await conteo(notificacion)).toBe(avisosAntes + 6);
    expect(await conteo(auditoria)).toBe(auditoriaAntes + 6); // una fila de auditoria por destinatario
    for (const a of [mant, instr, mkt, consumibles2, e.brian, e.admin]) expect((await suyas(id, a)).length, a.nombre).toBe(1);
    expect((await suyas(id, consumibles)).filter((x) => x.estado === 'pendiente').length).toBe(0);

    // doble clic en «Enviar»: sin filas nuevas de ningun tipo
    const r2 = await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: destinos, mensaje: 'Para todas las areas' });
    expect(r2).toMatchObject({ creadas: 0, actualizadas: 0 });
    expect(r2.destinatarios.every((d) => d.sinCambios === 1)).toBe(true);
    expect(await conteo(notificacion)).toBe(avisosAntes + 6);
    expect(await conteo(auditoria)).toBe(auditoriaAntes + 6);
  });

  it('el mismo envio llegado dos veces a la vez (dos pestanas) deja una sola asignacion y un solo aviso por persona', async () => {
    const id = await nueva(consumibles);
    const entrada = { referenciaId: id, destinatarios: [de(mant), de(instr)], mensaje: 'x' };
    await Promise.all([enviarA(e.ctx(consumibles, T0), entrada), enviarA(e.ctx(consumibles, T0), entrada)]);
    for (const a of [mant, instr]) {
      expect((await suyas(id, a)).length).toBe(1);
      const av = await e.db.select().from(notificacion).where(and(eq(notificacion.usuarioId, a.usuarioId), eq(notificacion.referenciaId, id)));
      expect(av.length).toBe(1);
    }
  });

  it('mas de 25 destinatarios o 26 referencias en un lote se rechazan sin tocar nada', async () => {
    const id = await nueva(consumibles);
    const ids26 = Array.from({ length: 26 }, () => crypto.randomUUID());
    const antes = await conteo(notificacion);
    expect(await codigoError(enviarALote(e.ctx(consumibles, T0), { referenciaIds: ids26, destinatarios: [de(mant)] }))).toBe('VALIDACION');
    const destinos26 = Array.from({ length: 26 }, () => de(mant, 'completar')).map(() => ({ usuarioId: crypto.randomUUID() }));
    expect(await codigoError(enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: destinos26 }))).toBe('VALIDACION');
    expect(await conteo(notificacion)).toBe(antes);
  });

  it('lote de 25 referencias a 4 personas: 100 asignaciones y 100 avisos, 1 auditoria de lote; repetir no agrega nada (medida de filas)', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) ids.push(await nueva(consumibles));
    const avisosAntes = await conteo(notificacion);
    const audAntes = await conteo(auditoria);
    const t = Date.now();
    const r = await enviarALote(e.ctx(consumibles, T0), { referenciaIds: ids, destinatarios: [de(mant), de(instr), de(mkt), de(e.brian)], mensaje: 'Lote' });
    const ms = Date.now() - t;
    expect(r.creadas).toBe(100);
    expect(await conteo(notificacion)).toBe(avisosAntes + 100);
    // 100 filas de auditoria por asignacion + 1 del lote
    expect(await conteo(auditoria)).toBe(audAntes + 101);
    medir(`[medida] lote 25x4: ${ms} ms, +100 avisos, +101 auditoria`);
    // los 25 avisos de un lote llevan la MISMA hora: la paginacion por cursor (hora, id) no debe repetir ni saltar ninguno
    const vistos: string[] = [];
    let cursor: string | null = null;
    for (let pagina = 0; pagina < 10; pagina++) {
      const lista: Awaited<ReturnType<typeof listarNotificaciones>> = await listarNotificaciones(e.ctx(mant), { limite: 10, antes: cursor });
      vistos.push(...lista.items.map((x) => x.id));
      cursor = lista.siguiente;
      if (!cursor) break;
    }
    const totalMant = (await e.db.select({ c: count() }).from(notificacion).where(eq(notificacion.usuarioId, mant.usuarioId)))[0]!.c;
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos.length).toBe(totalMant);
    const r2 = await enviarALote(e.ctx(consumibles, T0), { referenciaIds: ids, destinatarios: [de(mant), de(instr), de(mkt), de(e.brian)], mensaje: 'Lote' });
    expect(r2.creadas + r2.actualizadas).toBe(0);
    expect(await conteo(notificacion)).toBe(avisosAntes + 100);
    expect(await conteo(auditoria)).toBe(audAntes + 101 + 1); // solo la fila del lote (0 asignaciones tocadas)
  });
});

describe('tope de envios por hora (13.3): 60 operaciones por persona', () => {
  it('la 61 en la misma hora falla con LIMITE_TASA aunque no cambie nada (cuenta tambien los reintentos); a la hora siguiente vuelve', async () => {
    const id = await nueva(mkt);
    const hora = new Date('2026-11-03T14:10:00.000Z'); // dentro de la ventana de [14:00, 15:00)
    const entrada = { referenciaId: id, destinatarios: [de(instr, 'completar')] };
    for (let i = 0; i < 60; i++) await enviarA(e.ctx(mkt, hora), entrada);
    expect(await codigoError(enviarA(e.ctx(mkt, hora), entrada))).toBe('LIMITE_TASA');
    // otra cuenta del area no se ve afectada: el tope es por usuario
    expect(await codigoError(enviarA(e.ctx(mant, hora), { referenciaId: id, destinatarios: [de(instr, 'completar')] }))).toBe('NINGUNO');
    // y un lote cuenta como UNA operacion
    expect(await codigoError(enviarA(e.ctx(mkt, new Date(hora.getTime() + 3_600_000)), entrada))).toBe('NINGUNO');
  });
});

describe('solicitud de informacion de la aduana a un area con varias cuentas', () => {
  it('cada cuenta activa del area recibe UN pendiente «Responder» y UN aviso; al responder se cierran todos', async () => {
    const id = await nueva(consumibles, 'Consumibles');
    await llenarComoArea(e, id, consumibles);
    await escribir(e, consumibles, id, 'area_responsable', 'Consumibles'); // los datos de ejemplo la ponen en Instrumentos
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [de(e.brian, 'clasificar')] });
    await escribir(e, e.brian, id, 'requiere_rim', 'NO');

    await escribir(e, e.brian, id, 'descripciones_minimas', 'Necesito el caudal.');
    for (const a of [consumibles, consumibles2]) {
      const lista = (await suyas(id, a)).filter((x) => x.pedido === 'responder');
      expect(lista.length, a.nombre).toBe(1);
      expect(lista[0]!.estado).toBe('pendiente');
    }
    const avisosArea = async (a: Actor) =>
      (await e.db.select().from(notificacion).where(and(eq(notificacion.usuarioId, a.usuarioId), eq(notificacion.referenciaId, id), eq(notificacion.tipo, 'asignacion')))).length;
    expect(await avisosArea(consumibles2)).toBe(1);
    expect(await avisosArea(mant)).toBe(0); // otra area no se entera

    // Cambiar el TEXTO de la solicitud mientras el area no ha leido el aviso lo renueva, no suma otro (avisos agrupados)
    await escribir(e, e.brian, id, 'descripciones_minimas', 'Necesito el caudal y la presion.');
    await escribir(e, e.brian, id, 'descripciones_minimas', 'Necesito el caudal, la presion y la temperatura.');
    expect(await avisosArea(consumibles2)).toBe(1);
    expect(await avisosArea(consumibles)).toBe(1);
    // ... y sigue siendo UN pendiente «Responder» con el texto nuevo
    const pendiente = (await suyas(id, consumibles2)).filter((x) => x.pedido === 'responder');
    expect(pendiente).toHaveLength(1);
    expect(pendiente[0]!.mensaje).toBe('Necesito el caudal, la presion y la temperatura.');
    // Quien YA leyo el aviso recibe uno nuevo si la aduana cambia la solicitud otra vez
    await marcarTodasLeidas(e.ctx(consumibles2));
    await escribir(e, e.brian, id, 'descripciones_minimas', 'Necesito el caudal, la presion, la temperatura y el voltaje.');
    expect(await avisosArea(consumibles2)).toBe(2);
    expect(await avisosArea(consumibles)).toBe(1);

    // Una de las cuentas responde: los pendientes de TODAS quedan hechos
    await escribir(e, consumibles2, id, 'respuesta_area', '12 m3/h, 4 bar, 60 C.');
    for (const a of [consumibles, consumibles2]) {
      expect((await suyas(id, a)).filter((x) => x.pedido === 'responder').every((x) => x.estado === 'hecha'), a.nombre).toBe(true);
    }
    // aviso de «respuesta» a la aduana: uno
    const respuestas = await e.db
      .select()
      .from(notificacion)
      .where(and(eq(notificacion.usuarioId, e.brian.usuarioId), eq(notificacion.referenciaId, id), eq(notificacion.tipo, 'respuesta')));
    expect(respuestas.length).toBe(1);
  });
});

// Evita avisos de TS por la utilidad no usada en otros bloques
void sql;
