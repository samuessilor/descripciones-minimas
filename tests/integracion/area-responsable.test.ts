/**
 * Reunion con el area (2026-10-29), P4, C1, C2 y A2 en el servidor:
 *  - la referencia nace con su «Área responsable» (elegida, o la del area de quien la crea) y queda en el historial;
 *  - las cuentas activas del area la ven en «Para mí» e Inicio aunque nadie se la haya enviado, mientras tenga
 *    secciones del area pendientes sin persona asignada (responsabilidad derivada, sin filas extra);
 *  - el Resumen y el listado nombran al area en vez de «Sin responsable», y el KPI, el filtro del listado y el contador
 *    de Inicio siguen coincidiendo entre si;
 *  - la solicitud de la aduana le llega al area responsable, no a quien creo la referencia.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, campoHistorial, referencia, usuario } from '@/db/esquema';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { cambiarRol, crearCuenta } from '@/server/acciones/usuarios';
import { editarUsuario } from '@/server/acciones/usuarios-admin';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { pendientesDe, resumenInicioDe } from '@/server/politicas/colaboracion';
import { FILTROS_VACIOS, listarPagina } from '@/server/politicas/listado';
import { tableroDe } from '@/server/politicas/tablero';
import { asignarAAduana, nuevoEscenario, type Escenario } from './ayudas';
import { escribir, llenarComoArea } from './ayudas-aduana';

let e: Escenario;
let mant: Actor;
let consumibles: Actor;
let n = 0;

async function conArea(actor: Actor, area: string): Promise<Actor> {
  await e.db.update(usuario).set({ area }).where(eq(usuario.id, actor.usuarioId));
  return (await cargarActorPorId(e.db, actor.usuarioId))!;
}

async function crear(actor: Actor, area?: string): Promise<string> {
  n += 1;
  const r = await crearReferencia(e.ctx(actor), {
    codigo: `AREA-${String(n).padStart(3, '0')}`,
    nombreProducto: `Producto del area ${n}`,
    tipoProducto: 'REPUESTO',
    ...(area ? { areaResponsable: area } : {}),
  });
  return r.id;
}

const areaDe = async (id: string) => {
  const [f] = await e.db.select({ d: referencia.datos }).from(referencia).where(eq(referencia.id, id));
  return f?.d?.area_responsable?.v ?? null;
};
const delArea = async (actor: Actor) => (await pendientesDe(e.db, actor, new Date())).filter((p) => p.delArea);
const activas = (id: string, usuarioId: string) =>
  e.db
    .select()
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])));

beforeAll(async () => {
  e = await nuevoEscenario();
  // Edward es de Consumibles; Mantenimiento tiene su cuenta general; Marketing no tiene a nadie.
  consumibles = await conArea(e.edward, 'Consumibles');
  const r = await crearCuenta(e.ctx(e.admin), {
    nombre: 'Mantenimiento',
    usuario: 'mantenimiento',
    email: 'mantenimiento@prueba.invalid',
    organizacionId: e.orgInterna,
    rol: 'solicitante',
    area: 'Mantenimiento',
  });
  mant = (await cargarActorPorId(e.db, r.id))!;
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('P4: area responsable al crear', () => {
  it('se guarda la elegida, o la del area de quien crea; queda como hecho en el historial', async () => {
    const elegida = await crear(consumibles, 'Mantenimiento');
    expect(await areaDe(elegida)).toBe('Mantenimiento');
    expect(await areaDe(await crear(consumibles))).toBe('Consumibles');
    expect(await areaDe(await crear(e.admin))).toBeNull(); // sin area: queda pendiente en la ficha
    const h = await e.db
      .select()
      .from(campoHistorial)
      .where(and(eq(campoHistorial.referenciaId, elegida), eq(campoHistorial.campo, 'area_responsable')));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ versionCampo: 1, valor: 'Mantenimiento' });
  });

  it('un area fuera del catalogo se rechaza', async () => {
    await expect(crearReferencia(e.ctx(consumibles), { codigo: 'AREA-X', nombreProducto: 'X', tipoProducto: 'INSUMO', areaResponsable: 'Logística' })).rejects.toMatchObject({
      codigo: 'VALIDACION',
    });
  });
});

describe('C2: el area del usuario es del catalogo', () => {
  it('crear cuenta y editar solo aceptan las cuatro areas (o ninguna)', async () => {
    await expect(
      crearCuenta(e.ctx(e.admin), { nombre: 'Y', usuario: 'yyy', email: 'y@prueba.invalid', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Insumos' }),
    ).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: 'Charles', area: 'Instrumentos' });
    expect((await cargarActorPorId(e.db, e.charles.usuarioId))?.area).toBe('Instrumentos');
    // Un solicitante SIEMPRE es de un area: no se le puede dejar sin area (ni crearlo sin ella).
    await expect(editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: 'Charles', area: '' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    expect((await cargarActorPorId(e.db, e.charles.usuarioId))?.area).toBe('Instrumentos');
    await expect(
      crearCuenta(e.ctx(e.admin), { nombre: 'Sin area', usuario: 'sin-area', organizacionId: e.orgInterna, rol: 'solicitante' }),
    ).rejects.toMatchObject({ codigo: 'VALIDACION' });
    // Los demas roles internos si pueden no tener area.
    const lector = await crearCuenta(e.ctx(e.admin), { nombre: 'Lectora', usuario: 'lectora-sin-area', organizacionId: e.orgInterna, rol: 'lector' });
    await editarUsuario(e.ctx(e.admin), { usuarioId: lector.id, nombre: 'Lectora', area: '' });
    expect((await cargarActorPorId(e.db, lector.id))?.area).toBeNull();
    // Y para pasar a alguien a solicitante primero hay que darle area.
    await expect(cambiarRol(e.ctx(e.admin), { usuarioId: lector.id, rol: 'solicitante' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: 'Charles', area: 'Otra' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    // Una cuenta de agencia no tiene area interna.
    await editarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, nombre: 'Brian', area: 'Marketing' });
    expect((await cargarActorPorId(e.db, e.brian.usuarioId))?.area).toBeNull();
  });
});

describe('C1: responsabilidad derivada del area', () => {
  it('la cuenta del area la ve en «Para mí» e Inicio aunque nadie se la envio; otra area no', async () => {
    const id = await crear(consumibles, 'Mantenimiento');
    const fila = (await delArea(mant)).find((p) => p.referenciaId === id);
    expect(fila).toMatchObject({ asignacionId: null, delArea: 'Mantenimiento', pedido: 'completar' });
    expect(fila?.falta).toMatch(/^Falta: Producto y Detalle/);
    const resumen = await resumenInicioDe(e.db, mant, new Date());
    expect(resumen.pendientesParaMi).toBe((await pendientesDe(e.db, mant, new Date())).length);
    expect((await delArea(consumibles)).some((p) => p.referenciaId === id)).toBe(false);
    // El lector y la aduana nunca tienen pendientes derivados.
    expect(await delArea(e.lector)).toEqual([]);
  });

  it('deja de ser del area cuando una persona tiene en la mano lo que falta, o cuando el area ya lo lleno', async () => {
    const id = await crear(consumibles, 'Mantenimiento');
    // Solo Producto para Charles: Detalle sigue siendo del area (Especificaciones ya no tiene nada del cliente).
    await e.db.insert(asignacion).values({ referenciaId: id, deUsuarioId: consumibles.usuarioId, aUsuarioId: e.charles.usuarioId, pedido: 'completar', secciones: 'producto', estado: 'pendiente' });
    const parcial = (await delArea(mant)).find((p) => p.referenciaId === id);
    expect(parcial?.falta).toMatch(/^Falta: Detalle/);
    // Todo para Charles: ya no es del area.
    await e.db.update(asignacion).set({ secciones: null }).where(eq(asignacion.referenciaId, id));
    expect((await delArea(mant)).some((p) => p.referenciaId === id)).toBe(false);

    // Lo del area completo: no queda nada que llenar, sale de «Para mí».
    const llena = await crear(consumibles, 'Mantenimiento');
    await llenarComoArea(e, llena, consumibles);
    await escribir(e, consumibles, llena, 'area_responsable', 'Mantenimiento');
    await escribir(e, consumibles, llena, 'maquina_destino', 'Pulidora 3');
    expect((await delArea(mant)).some((p) => p.referenciaId === llena)).toBe(false);
  });

  it('Resumen, listado e Inicio nombran al area y cuentan «Sin responsable» con la misma regla', async () => {
    const deMant = await crear(consumibles, 'Mantenimiento');
    const deMarketing = await crear(consumibles, 'Marketing'); // area sin cuentas
    for (const id of [deMant, deMarketing]) await e.db.update(referencia).set({ estado: 'EN_GESTION' }).where(eq(referencia.id, id));

    const ahora = new Date();
    const tablero = await tableroDe(e.db, e.admin, ahora);
    const fMant = tablero.abiertas.find((f) => f.id === deMant)!;
    expect(fMant.area).toBe('Mantenimiento');
    expect(fMant.bloqueo).toMatchObject({ clase: 'persona' });
    expect(fMant.bloqueo.texto).toContain('Área Mantenimiento (Producto y Detalle)');
    expect(tablero.abiertas.find((f) => f.id === deMarketing)?.bloqueo.clase).toBe('sin_responsable');

    const sin = await listarPagina(e.db, e.admin, { ...FILTROS_VACIOS, sinResponsable: true }, ahora);
    const codigoMarketing = (await e.db.select({ c: referencia.codigo }).from(referencia).where(eq(referencia.id, deMarketing)))[0]!.c;
    expect(sin.filas.map((f) => f.codigo)).toContain(codigoMarketing);
    expect(sin.filas.some((f) => f.id === deMant)).toBe(false);
    const filaMant = (await listarPagina(e.db, e.admin, { ...FILTROS_VACIOS, q: fMant.codigo }, ahora)).filas[0]!;
    expect(filaMant).toMatchObject({ area: 'Mantenimiento', sinResponsable: false, responsables: [] });

    const inicio = await resumenInicioDe(e.db, e.admin, ahora);
    expect(tablero.resumen.sinResponsable).toBe(sin.total);
    expect(inicio.sinResponsable).toBe(sin.total);

    // Si el area se queda sin cuentas activas, vuelve a ser «Sin responsable» en los tres.
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, mant.usuarioId));
    const sin2 = await listarPagina(e.db, e.admin, { ...FILTROS_VACIOS, sinResponsable: true }, ahora);
    expect(sin2.filas.some((f) => f.id === deMant)).toBe(true);
    expect((await tableroDe(e.db, e.admin, ahora)).resumen.sinResponsable).toBe(sin2.total);
    expect((await resumenInicioDe(e.db, e.admin, ahora)).sinResponsable).toBe(sin2.total);
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, mant.usuarioId));
  });
});

describe('A2 + C1: la solicitud de la aduana le llega al area responsable', () => {
  it('pendiente «Responder» para las cuentas del area (no para quien creo la ficha); la respuesta lo cierra', async () => {
    const id = await crear(consumibles, 'Mantenimiento');
    await asignarAAduana(e, id, e.brian, consumibles);
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿El motor es AC o DC?');
    expect(await activas(id, mant.usuarioId)).toEqual([expect.objectContaining({ pedido: 'responder', deUsuarioId: e.brian.usuarioId })]);
    expect(await activas(id, consumibles.usuarioId)).toHaveLength(0);
    expect((await pendientesDe(e.db, mant, new Date())).find((p) => p.referenciaId === id)).toMatchObject({ pedido: 'responder', delArea: null });

    await escribir(e, mant, id, 'respuesta_area', 'AC, 2 A');
    expect(await activas(id, mant.usuarioId)).toHaveLength(0);
  });

  it('si el area no tiene cuentas, le llega a quien creo la referencia', async () => {
    const id = await crear(consumibles, 'Marketing');
    await asignarAAduana(e, id, e.brian, consumibles);
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿Material?');
    expect((await activas(id, consumibles.usuarioId)).map((a) => a.pedido)).toEqual(['responder']);
  });
});
