/**
 * Pruebas con las 6 cuentas de produccion: 1 admin, 4 cuentas de area (Consumibles, Mantenimiento, Instrumentos,
 * Marketing) y agencias de aduana (A y B). Que ve y que NO ve cada una, que avisos recibe y ninguna fuga entre agencias.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificacion, usuario } from '@/db/esquema';
import { cancelarAsignacion, enviarA, marcarListo, recordar } from '@/server/acciones/asignaciones';
import { comentar, listarNotificaciones } from '@/server/acciones/comentarios-y-bandeja';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { crearCuenta } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { candidatosDestinoDe, comentariosDe, esperandoDe, historialDeFichaDe, pendientesDe, resumenInicioDe, seguimientoDeFicha } from '@/server/politicas/colaboracion';
import { FILTROS_VACIOS, listarPagina } from '@/server/politicas/listado';
import { asignarAAduana, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { escribir } from './ayudas-aduana';
import { fichaVisibleParaTest } from './ayudas-visibilidad';

let e: Escenario;
let consumibles: Actor;
let mant: Actor;
let instr: Actor;
let mkt: Actor;
const T0 = new Date('2026-11-02T15:00:00.000Z');
const fichas: Record<string, string> = {};
let n = 0;

async function cuenta(nombre: string, usuarioNombre: string, area: string): Promise<Actor> {
  const r = await crearCuenta(e.ctx(e.admin), {
    nombre,
    usuario: usuarioNombre,
    email: `${usuarioNombre}@prueba.invalid`,
    organizacionId: e.orgInterna,
    rol: 'solicitante',
    area,
  });
  return (await cargarActorPorId(e.db, r.id))!;
}

async function nueva(actor: Actor, area: string): Promise<string> {
  n += 1;
  const r = await crearReferencia(e.ctx(actor, T0), { codigo: `PROD-${n}`, nombreProducto: `Producto de ${area}`, tipoProducto: 'INSUMO', areaResponsable: area });
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

beforeAll(async () => {
  e = await nuevoEscenario();
  await e.db.update(usuario).set({ area: 'Consumibles' }).where(eq(usuario.id, e.edward.usuarioId));
  consumibles = (await cargarActorPorId(e.db, e.edward.usuarioId))!;
  mant = await cuenta('Mantenimiento', 'mantenimiento', 'Mantenimiento');
  instr = await cuenta('Instrumentos', 'instrumentos', 'Instrumentos');
  mkt = await cuenta('Marketing', 'marketing', 'Marketing');
  fichas.consumibles = await nueva(consumibles, 'Consumibles');
  fichas.mant = await nueva(mant, 'Mantenimiento');
  fichas.instr = await nueva(instr, 'Instrumentos');
  fichas.mkt = await nueva(mkt, 'Marketing');
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('cuentas de area: «lo suyo» es Para mi / avisos / Inicio, NO el listado', () => {
  it('«Para mi» e Inicio de cada area muestran SOLO las referencias de su area (responsabilidad derivada)', async () => {
    const esperado: Array<[Actor, string]> = [
      [consumibles, 'consumibles'],
      [mant, 'mant'],
      [instr, 'instr'],
      [mkt, 'mkt'],
    ];
    for (const [actor, clave] of esperado) {
      const para = await pendientesDe(e.db, actor, T0);
      expect(para.map((p) => p.referenciaId), actor.nombre).toEqual([fichas[clave]]);
      expect(para[0]!.delArea).toBe(actor.area);
      expect((await resumenInicioDe(e.db, actor, T0)).pendientesParaMi).toBe(1);
    }
  });

  it('DISENO S-02 (importante para el dueno): el listado y la ficha NO se restringen por area; cualquier cuenta de area ve y puede escribir los campos del cliente de TODAS', async () => {
    for (const actor of [consumibles, mant, instr, mkt]) {
      const l = await listarPagina(e.db, actor, FILTROS_VACIOS, T0);
      expect(l.total, actor.nombre).toBeGreaterThanOrEqual(4);
      for (const id of Object.values(fichas)) expect(await fichaVisibleParaTest(e, id, actor, T0)).toBe(true);
    }
    // Marketing escribe un campo de la ficha de Consumibles (nada se lo impide)
    await escribir(e, mkt, fichas.consumibles!, 'uso', 'Escrito por otra area');
    expect(await versionDe(e.db, fichas.consumibles!, 'uso')).toBe(1);
  });

  it('los avisos son por cuenta: lo que recibe Mantenimiento no lo ve Instrumentos, y nadie lee los avisos de otra cuenta', async () => {
    await enviarA(e.ctx(consumibles, T0), { referenciaId: fichas.consumibles!, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] });
    const deMant = await listarNotificaciones(e.ctx(mant), { limite: 100 });
    const deInstr = await listarNotificaciones(e.ctx(instr), { limite: 100 });
    expect(deMant.items.some((x) => x.referenciaId === fichas.consumibles)).toBe(true);
    expect(deInstr.items.some((x) => x.referenciaId === fichas.consumibles)).toBe(false);
    const ids = new Set(deMant.items.map((x) => x.id));
    expect(deInstr.items.some((x) => ids.has(x.id))).toBe(false);
  });
});

describe('agencia de aduana: solo lo asignado, solo mientras tenga acceso, sin ver a otras agencias', () => {
  it('Brian (A) ve solo lo que se le asigno; Brenda (B) no ve nada; tras marcar listo conserva 30 dias y luego pierde el acceso y los avisos no filtran nada', async () => {
    const id = fichas.consumibles!;
    expect((await listarPagina(e.db, e.brian, FILTROS_VACIOS, T0)).total).toBe(0);
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'clasificar' }] });
    const lista = await listarPagina(e.db, e.brian, FILTROS_VACIOS, T0);
    expect(lista.filas.map((x) => x.id)).toEqual([id]);
    expect((await listarPagina(e.db, e.brianB, FILTROS_VACIOS, T0)).total).toBe(0);
    expect(await codigoError(comentariosDe(e.db, e.brianB, id, T0))).toBe('NO_ENCONTRADO');
    expect(await codigoError(seguimientoDeFicha(e.db, e.brianB, id, T0))).toBe('NO_ENCONTRADO');
    expect(await codigoError(historialDeFichaDe(e.db, e.brianB, id, T0))).toBe('NO_ENCONTRADO');
    expect(await codigoError(guardarCampo(e.ctx(e.brianB, T0), { referenciaId: id, campo: 'observaciones_aduana', valor: 'x', versionEsperada: 0 }))).toBe('NO_ENCONTRADO');
    expect(await codigoError(enviarA(e.ctx(e.brianB, T0), { referenciaId: id, destinatarios: [{ usuarioId: consumibles.usuarioId, pedido: 'responder' }] }))).toBe('NO_ENCONTRADO');

    await marcarListo(e.ctx(e.brian, T0), { referenciaId: id });
    const dentro = new Date(T0.getTime() + 29 * 86_400_000);
    const fuera = new Date(T0.getTime() + 31 * 86_400_000);
    expect((await listarPagina(e.db, e.brian, FILTROS_VACIOS, dentro)).total).toBe(1);
    expect((await listarPagina(e.db, e.brian, FILTROS_VACIOS, fuera)).total).toBe(0);
    // «Para mi» de la agencia: sin pendientes tras marcar listo
    expect(await pendientesDe(e.db, e.brian, T0)).toEqual([]);
  });

  it('a quien puede enviar una agencia: solo a quien creo la ficha, a quien se la envio y a su propia agencia (no ve al resto del equipo interno)', async () => {
    const id = await nueva(consumibles, 'Consumibles');
    await enviarA(e.ctx(consumibles, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, pedido: 'clasificar' }] });
    const candidatos = await candidatosDestinoDe(e.db, e.brian, id, T0);
    const nombres = candidatos.map((c) => c.nombre);
    expect(nombres).toContain('Edward');
    expect(nombres).not.toContain('Mantenimiento');
    expect(nombres).not.toContain('Instrumentos');
    expect(nombres).not.toContain('Marketing');
    expect(await codigoError(enviarA(e.ctx(e.brian, T0), { referenciaId: id, destinatarios: [{ usuarioId: mkt.usuarioId, pedido: 'responder' }] }))).toBe('SIN_PERMISO');
    // si, a quien se la envio
    expect(await codigoError(enviarA(e.ctx(e.brian, T0), { referenciaId: id, destinatarios: [{ usuarioId: consumibles.usuarioId, pedido: 'responder' }] }))).toBe('NINGUNO');
  });

  it('con DOS agencias en la misma ficha (la agrega un admin) los avisos y el seguimiento nunca nombran a la otra agencia ni muestran comentarios internos', async () => {
    const id = await nueva(consumibles, 'Consumibles');
    await asignarAAduana(e, id, e.brian);
    await enviarA(e.ctx(e.admin, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brianB.usuarioId, pedido: 'clasificar' }] }); // solo un admin agrega la 2a agencia

    await comentar(e.ctx(e.brianB, T0), { referenciaId: id, texto: 'Comentario de B', visibilidad: 'todos' });
    await comentar(e.ctx(consumibles, T0), { referenciaId: id, texto: 'Interno: precio confidencial', visibilidad: 'interno' });
    await escribir(e, e.brian, id, 'observaciones_aduana', 'Primera nota de A');
    await escribir(e, e.brianB, id, 'observaciones_aduana', 'B corrige a A', 'Motivo de B');

    const avisosA = (await listarNotificaciones(e.ctx(e.brian), { limite: 100 })).items.filter((x) => x.referenciaId === id);
    expect(avisosA.length).toBeGreaterThan(0);
    for (const a of avisosA) {
      expect(a.titulo, a.titulo).not.toMatch(/Brenda|Agencia B/);
    }
    expect(avisosA.some((a) => /Otra agencia/.test(a.titulo))).toBe(true);
    const comentariosA = await comentariosDe(e.db, e.brian, id, T0);
    expect(comentariosA.map((c) => c.texto)).toEqual(['Comentario de B']);
    expect(comentariosA[0]!.autor).toBe('Otra agencia');
    const seg = await seguimientoDeFicha(e.db, e.brian, id, T0);
    for (const s of seg) expect(JSON.stringify(s)).not.toMatch(/Brenda/);
    // y de B no llega a A ni el cambio ni el motivo: el historial de la agencia es solo el de su organizacion
    const h = await historialDeFichaDe(e.db, e.brian, id, T0, { campo: 'observaciones_aduana' });
    expect(h.items.map((x) => x.autor)).toEqual(['Brian']);
    expect(JSON.stringify(h)).not.toMatch(/Motivo de B|Otra agencia|Brenda/);
  });
});

describe('admin y lector', () => {
  it('el admin ve y gestiona todo (cancelar, recordar de cualquier persona); el lector ve y recuerda pero no envia ni comenta ni recibe', async () => {
    const id = await nueva(mkt, 'Marketing');
    await enviarA(e.ctx(mkt, T0), { referenciaId: id, destinatarios: [{ usuarioId: instr.usuarioId, pedido: 'completar' }] });
    const [fila] = (await esperandoDe(e.db, e.admin, T0)).filter((x) => x.referenciaId === id);
    expect(fila).toMatchObject({ puedeRecordar: true, puedeGestionar: true });
    const [filaLector] = (await esperandoDe(e.db, e.lector, T0)).filter((x) => x.referenciaId === id);
    expect(filaLector).toMatchObject({ puedeRecordar: true, puedeGestionar: false });

    await recordar(e.ctx(e.lector, T0), { asignacionId: fila!.asignacionId });
    expect(await codigoError(enviarA(e.ctx(e.lector, T0), { referenciaId: id, destinatarios: [{ usuarioId: mant.usuarioId, pedido: 'completar' }] }))).toBe('SIN_PERMISO');
    expect(await codigoError(comentar(e.ctx(e.lector, T0), { referenciaId: id, texto: 'x', visibilidad: 'interno' }))).toBe('SIN_PERMISO');
    expect(await codigoError(enviarA(e.ctx(mkt, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.lector.usuarioId }] }))).toBe('VALIDACION');
    const avisosLector = await e.db.select().from(notificacion).where(eq(notificacion.usuarioId, e.lector.usuarioId));
    expect(avisosLector).toHaveLength(0);

    await cancelarAsignacion(e.ctx(e.admin, T0), { asignacionId: fila!.asignacionId }); // el admin cancela lo de otra persona
    expect((await pendientesDe(e.db, instr, T0)).some((p) => p.asignacionId === fila!.asignacionId)).toBe(false);
  });
});
