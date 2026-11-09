/**
 * Regresiones de la revision independiente de H1 (datos y acciones). Cada bloque reproduce un defecto
 * reportado; deben fallar sin la correccion y pasar con ella.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, campoHistorial, edicionActiva, organizacion, referencia, usuario } from '@/db/esquema';
import { CAMPOS } from '@/dominio/campos';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { MAX_LATIDOS_ACTIVOS, estadoFicha, latidoEdicion } from '@/server/acciones/estado-ficha';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cambiarOrganizacion } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { cargarReferenciaVisible } from '@/server/politicas/referencias';
import { asignarAAduana, nuevoEscenario, nuevaFicha, versionDe, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (x) {
    if (x instanceof ErrorAccion) return x.codigo;
    return `RAW:${String(x).slice(0, 120)}`;
  }
}

const guardar = async (
  ficha: string,
  campo: string,
  valor: unknown,
  quien: Actor = e.edward,
  extra: { motivo?: string | null; versionEsperada?: number } = {},
) =>
  guardarCampo(e.ctx(quien), {
    referenciaId: ficha,
    campo,
    valor,
    versionEsperada: extra.versionEsperada ?? (await versionDe(e.db, ficha, campo)),
    ...(extra.motivo !== undefined ? { motivo: extra.motivo } : {}),
  });

describe('codigo_norm absorbe invisibles y variantes Unicode (SPEC 6.3, C-14, D-27)', () => {
  const VARIANTES: Array<[string, string]> = [
    ['B3210​KIT5', 'espacio de ancho cero'],
    ['B32­10KIT5', 'guion blando'],
    ['B32−10KIT5', 'signo menos'],
    ['B32－10KIT5', 'guion de ancho completo'],
    ['Ｂ３２１０KIT5', 'letras y digitos de ancho completo'],
    ['B3210⁠KIT5', 'word joiner'],
    ['B3210·KIT5', 'punto medio'],
    ['B3210﻿KIT5', 'BOM'],
    ['B3210　KIT5', 'espacio ideografico'],
    ['B32–10—KIT5', 'guion medio y raya'],
    ['B3210\u0000KIT5', 'NUL'],
  ];

  it('cada variante del mismo codigo es DUPLICADO y no crea una segunda ficha', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: 'B32 10-KIT5', nombreProducto: 'Kit original', tipoProducto: 'INSUMO' });
    for (const [codigo, que] of VARIANTES) {
      const r = await codigoDe(crearReferencia(e.ctx(e.edward), { codigo, nombreProducto: 'Kit duplicado', tipoProducto: 'INSUMO' }));
      expect(r, que).toBe('DUPLICADO');
    }
  });

  it('corregir el codigo y crear usan la misma normalizacion (sin separadores, ancho completo ni invisibles)', async () => {
    const { normalizarCodigo } = await import('@/dominio/normalizacion');
    expect(normalizarCodigo('B3210​KIT5')).toBe(normalizarCodigo('B32 10-KIT5'));
  });
});

describe('caracteres que Postgres no admite: se limpian o se rechazan, nunca ERROR_INTERNO', () => {
  it('crearReferencia: U+0000 en nombre y codigo se elimina; un codigo solo de U+0000 es VALIDACION', async () => {
    const a = await crearReferencia(e.ctx(e.edward), { codigo: 'NUL-1', nombreProducto: 'a\u0000b', tipoProducto: 'INSUMO' });
    const b = await crearReferencia(e.ctx(e.edward), { codigo: 'NU\u0000L-2', nombreProducto: 'nombre', tipoProducto: 'INSUMO' });
    expect(b.codigo).toBe('NUL-2');
    const [fa] = await e.db.select().from(referencia).where(eq(referencia.id, a.id));
    expect(fa!.nombreProducto).toBe('ab');
    expect(await codigoDe(crearReferencia(e.ctx(e.edward), { codigo: '\u0000', nombreProducto: 'x', tipoProducto: 'INSUMO' }))).toBe('VALIDACION');
    expect(await codigoDe(crearReferencia(e.ctx(e.edward), { codigo: 'NUL-3', nombreProducto: '\u0000\u0000', tipoProducto: 'INSUMO' }))).toBe('VALIDACION');
  });

  it('crearReferencia: un sustituto UTF-16 suelto no revienta; queda U+FFFD', async () => {
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'SUS-1', nombreProducto: 'x\ud800y', tipoProducto: 'INSUMO' });
    const [f] = await e.db.select().from(referencia).where(eq(referencia.id, r.id));
    expect(f!.nombreProducto).toBe('x�y');
  });

  it('guardarCampo: un sustituto suelto en el valor queda como U+FFFD', async () => {
    const f = await nuevaFicha(e);
    const r = await guardar(f, 'uso', 'a\ud800b');
    expect(r.valor).toBe('a�b');
  });

  it('guardarCampo: el motivo con U+0000 o sustituto suelto se limpia (no revienta)', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'De Edward');
    await guardar(f, 'uso', 'De Charles', e.charles, { motivo: 'cor\u0000reg\ud800ir' });
    const h = await e.db
      .select()
      .from(campoHistorial)
      .where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'uso')))
      .orderBy(campoHistorial.versionCampo);
    expect(h[1]!.motivo).toBe('correg�ir');
  });

  it('guardarCampo con una clave que no es un campo de la ficha responde VALIDACION', async () => {
    const f = await nuevaFicha(e);
    for (const campo of ['dm:abc', 'dm:', 'dm:00000000-0000-4000-8000-000000000000', 'no_existe']) {
      expect(await codigoDe(guardar(f, campo, 'x', e.edward, { versionEsperada: 0 })), campo).toBe('VALIDACION');
    }
  });
});
describe('motivo invisible no cuenta como motivo (SPEC 9.3)', () => {
  const INVISIBLES = ['​', '⁠', '﻿', '­', ' ​\t', '‎', '　', '\u0007'];

  it('al pisar un valor ajeno, un motivo sin texto visible es FALTA_MOTIVO y no cambia nada', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'De Edward');
    for (const motivo of INVISIBLES) {
      expect(await codigoDe(guardar(f, 'uso', 'De Charles', e.charles, { motivo })), JSON.stringify(motivo)).toBe('FALTA_MOTIVO');
    }
    expect(await versionDe(e.db, f, 'uso')).toBe(1);
  });

  it('un motivo con texto real y un caracter invisible al borde se guarda sin el invisible', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'De Edward');
    await guardar(f, 'uso', 'De Charles', e.charles, { motivo: '​Corrijo con la ficha tecnica​' });
    const h = await e.db
      .select()
      .from(campoHistorial)
      .where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'uso')))
      .orderBy(campoHistorial.versionCampo);
    expect(h[1]!.motivo).toBe('Corrijo con la ficha tecnica');
  });
});

describe('posibles duplicados: el codigo guardado no actua como patron LIKE', () => {
  it('un % guardado en un codigo no es comodin', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: 'ABCD%EF', nombreProducto: 'Con porcentaje', tipoProducto: 'INSUMO' });
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'ABCDXXXXXEF', nombreProducto: 'Otro', tipoProducto: 'INSUMO' });
    expect(r.posiblesDuplicados.map((p) => p.codigo)).not.toContain('ABCD%EF');
  });

  it('control: un codigo que es prefijo del nuevo si se avisa', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: 'LARGOCODIGO', nombreProducto: 'Base', tipoProducto: 'INSUMO' });
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'LARGOCODIGO2', nombreProducto: 'Derivado', tipoProducto: 'INSUMO' });
    expect(r.posiblesDuplicados.map((p) => p.codigo)).toContain('LARGOCODIGO');
  });

  it('el nuevo codigo con % o _ tampoco actua como comodin al buscar', async () => {
    await crearReferencia(e.ctx(e.edward), { codigo: 'ZZTOP99', nombreProducto: 'Z', tipoProducto: 'INSUMO' });
    const r = await crearReferencia(e.ctx(e.edward), { codigo: 'ZZ%99', nombreProducto: 'Z2', tipoProducto: 'INSUMO' });
    expect(r.posiblesDuplicados.map((p) => p.codigo)).not.toContain('ZZTOP99');
  });
});

describe('latido de edicion valida la clave y acota las filas', () => {
  it('una clave que no es un campo, o un campo que la persona no escribe, responde VALIDACION o SIN_PERMISO y no escribe', async () => {
    const ficha = await nuevaFicha(e);
    for (const campo of ['dm:basura-0', 'dm:abc', 'dm:00000000-0000-4000-8000-000000000000', 'no_existe']) {
      expect(await codigoDe(latidoEdicion(e.ctx(e.edward), { referenciaId: ficha, campo })), campo).toBe('VALIDACION');
    }
    expect(await codigoDe(latidoEdicion(e.ctx(e.edward), { referenciaId: ficha, campo: 'descripciones_minimas' }))).toBe('SIN_PERMISO');
    const filas = await e.db.select().from(edicionActiva).where(eq(edicionActiva.referenciaId, ficha));
    expect(filas).toHaveLength(0);
  });

  it('un campo valido de la ficha si marca "editando" para los demas', async () => {
    const ficha = await nuevaFicha(e);
    await latidoEdicion(e.ctx(e.edward), { referenciaId: ficha, campo: 'uso' });
    const est = await estadoFicha(e.ctx(e.charles), { referenciaId: ficha });
    expect(est.editando.map((x) => x.campo)).toEqual(['uso']);
  });

  it('nadie acumula mas de MAX_LATIDOS_ACTIVOS filas activas por ficha', async () => {
    const ficha = await nuevaFicha(e);
    const claves = CAMPOS.filter((c) => c.grupo === 'C' && c.escribible).map((c) => c.clave);
    expect(claves.length).toBeGreaterThan(MAX_LATIDOS_ACTIVOS);
    for (const campo of claves) await latidoEdicion(e.ctx(e.edward), { referenciaId: ficha, campo });
    const filas = await e.db
      .select()
      .from(edicionActiva)
      .where(and(eq(edicionActiva.referenciaId, ficha), eq(edicionActiva.usuarioId, e.edward.usuarioId)));
    expect(filas.length).toBeLessThanOrEqual(MAX_LATIDOS_ACTIVOS);
    // Sigue quedando el mas reciente.
    expect(filas.map((f) => f.campo)).toContain(claves.at(-1));
  });
});
describe('cambiarOrganizacion no entrega a la nueva agencia las fichas de la anterior', () => {
  async function otroDeAgenciaA(email: string): Promise<Actor> {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Relevo A', email, rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'agencia' })
      .returning({ id: usuario.id });
    return (await cargarActorPorId(e.db, u!.id))!;
  }
  const ve = async (actor: Actor, ficha: string) => (await codigoDe(cargarReferenciaVisible(e.db, actor, ficha, new Date()))) === 'OK';

  it('con una asignacion pendiente exige reasignarla (VALIDACION) y no mueve a nadie', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    expect(await ve(e.brianB, f)).toBe(false);
    const err = await cambiarOrganizacion(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, organizacionId: e.orgB }).catch((x) => x);
    expect(err).toBeInstanceOf(ErrorAccion);
    expect((err as ErrorAccion).codigo).toBe('VALIDACION');
    expect(((err as ErrorAccion).detalle as { pendientes: string[] }).pendientes).toEqual([f]);
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.brian.usuarioId));
    expect(u!.organizacionId).toBe(e.orgA);
    expect(await ve(e.brianB, f)).toBe(false);
  });

  it('con la reasignacion pasa: la ficha sigue en la agencia A y la agencia B no la ve', async () => {
    const f = await nuevaFicha(e);
    const g = await nuevaFicha(e);
    const relevo = await otroDeAgenciaA('relevo1@prueba.invalid');
    const origen = await otroDeAgenciaA('origen1@prueba.invalid');
    await asignarAAduana(e, f, origen);
    // Una asignacion YA TERMINADA con acceso vigente: tampoco debe pasar a la agencia nueva.
    await asignarAAduana(e, g, origen);
    await e.db
      .update(asignacion)
      .set({ estado: 'hecha', completadaEn: new Date(), accesoHasta: new Date(Date.now() + 10 * 86_400_000) })
      .where(and(eq(asignacion.referenciaId, g), eq(asignacion.aUsuarioId, origen.usuarioId)));
    expect(await ve(origen, g)).toBe(true);

    await cambiarOrganizacion(e.ctx(e.admin), {
      usuarioId: origen.usuarioId,
      organizacionId: e.orgB,
      reasignaciones: { [f]: relevo.usuarioId },
    });

    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, origen.usuarioId));
    expect(u!.organizacionId).toBe(e.orgB);
    expect(await ve(relevo, f)).toBe(true); // la agencia A conserva su ficha
    expect(await ve(e.brianB, f)).toBe(false); // la B no hereda nada
    const movido = (await cargarActorPorId(e.db, origen.usuarioId))!; // el Actor se relee: ya es de la agencia B
    expect(movido.organizacionId).toBe(e.orgB);
    expect(await ve(movido, f)).toBe(false);
    expect(await ve(e.brianB, g)).toBe(false); // el acceso vigente de la terminada no se transfiere
    expect(await ve(movido, g)).toBe(false);
  });

  it('un cambio sin asignaciones sigue funcionando', async () => {
    const solo = await otroDeAgenciaA('solo1@prueba.invalid');
    await cambiarOrganizacion(e.ctx(e.admin), { usuarioId: solo.usuarioId, organizacionId: e.orgB });
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, solo.usuarioId));
    expect(u!.organizacionId).toBe(e.orgB);
  });

  it('mover entre dos organizaciones internas no exige nada (nadie interno depende de la agencia)', async () => {
    const [nueva] = await e.db.insert(organizacion).values({ nombre: 'Interna 2', tipo: 'interna' }).returning();
    await cambiarOrganizacion(e.ctx(e.admin), { usuarioId: e.lector.usuarioId, organizacionId: nueva!.id });
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.lector.usuarioId));
    expect(u!.organizacionId).toBe(nueva!.id);
  });
});

describe('mensaje de CONFLICTO neutro y alineado con el SPEC (10.5)', () => {
  it('no fija pronombre ("de ella") y nombra a quien guardo primero', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'funciones', 'Primero Edward');
    let msg = '';
    try {
      await guardar(f, 'funciones', 'Segundo Charles', e.charles, { versionEsperada: 0 });
    } catch (x) {
      expect((x as ErrorAccion).codigo).toBe('CONFLICTO');
      msg = (x as ErrorAccion).message;
    }
    expect(msg).toContain('Edward ya guardó este campo. Tu texto no se perdió');
    expect(msg).not.toMatch(/\bella\b|\bél\b/i);
  });

  it('si quien choca es la misma persona (otra pestana) lo dice asi', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'funciones', 'Primero');
    let msg = '';
    try {
      await guardar(f, 'funciones', 'Segundo, otra pestana', e.edward, { versionEsperada: 0 });
    } catch (x) {
      msg = (x as ErrorAccion).message;
    }
    expect(msg).toMatch(/Ya guardaste este campo desde otra pestaña\. Tu texto no se perdió/);
    expect(msg).not.toContain('Edward ya guardó');
  });
});
