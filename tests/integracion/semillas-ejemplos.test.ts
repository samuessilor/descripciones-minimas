/** Semilla de ejemplos de desarrollo: 12 fichas EJ-* en estados variados, con historial, comentarios y avisos. */
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, campoHistorial, comentario, entregaCorreo, notificacion, referencia, usuario } from '@/db/esquema';
import { sembrarDatosMaestros } from '@/db/semillas/datos-maestros';
import { sembrarDesarrollo, sembrarTodo } from '@/server/semillas';
import { sembrarEjemplos } from '@/server/semillas-ejemplos';
import { AREAS } from '@/dominio/areas';
import { cargarActorPorId } from '@/server/politicas/actor';
import { pendientesDe } from '@/server/politicas/colaboracion';
import { nuevaBd } from './ayudas';
import type { Conexion } from '@/db/conexion';

let c: Conexion;
beforeAll(async () => {
  c = await nuevaBd();
  await sembrarTodo(c.db, { desarrollo: true });
}, 120_000);
afterAll(async () => {
  await c.cerrar();
});

describe('semilla de ejemplos', () => {
  it('crea 12 referencias EJ-* con estados variados y las tres de la semilla base', async () => {
    const filas = await c.db.select().from(referencia);
    const ej = filas.filter((f) => f.codigo.startsWith('EJ-'));
    expect(ej).toHaveLength(12);
    expect(filas.filter((f) => f.codigo.startsWith('TEST-'))).toHaveLength(3);
    const estados = new Set(ej.map((f) => f.estado));
    expect(estados).toEqual(new Set(['BORRADOR', 'EN_GESTION', 'CLASIFICADA']));
    expect(ej.filter((f) => f.estado === 'CLASIFICADA').length).toBeGreaterThanOrEqual(3);
    expect(ej.filter((f) => f.estado === 'BORRADOR').length).toBeGreaterThanOrEqual(2);
  });

  it('hay varios autores y ediciones de personas distintas en una misma ficha', async () => {
    const ej = (await c.db.select().from(referencia)).filter((f) => f.codigo.startsWith('EJ-'));
    expect(new Set(ej.map((f) => f.creadaPor)).size).toBeGreaterThanOrEqual(3);
    const lampara = ej.find((f) => f.codigo === 'EJ-0007')!;
    const hist = await c.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, lampara.id));
    const autores = new Set(hist.filter((h) => h.campo === 'uso').map((h) => h.autorId));
    expect(autores.size).toBe(2); // Edgar lo escribio y Carla lo reemplazo con motivo
  });

  it('cada rol con trabajo tiene al menos un pendiente y los avisos tienen correo en el outbox', async () => {
    const pend = await c.db
      .select({ email: usuario.email })
      .from(asignacion)
      .innerJoin(usuario, eq(usuario.id, asignacion.aUsuarioId))
      .where(inArray(asignacion.estado, ['pendiente', 'en_curso']));
    const con = new Set(pend.map((p) => p.email));
    for (const e of ['solicitante@', 'solicitante2@', 'aduana-a@', 'aduana-b@', 'admin@']) {
      expect([...con].some((x) => x.startsWith(e)), `pendiente para ${e}`).toBe(true);
    }
    const [{ n: avisos }] = (await c.db.select({ n: sql<number>`count(*)::int` }).from(notificacion)) as [{ n: number }];
    const [{ n: correos }] = (await c.db.select({ n: sql<number>`count(*)::int` }).from(entregaCorreo)) as [{ n: number }];
    expect(avisos).toBeGreaterThanOrEqual(12);
    expect(correos).toBeGreaterThanOrEqual(8);
    const [{ n: comentarios }] = (await c.db.select({ n: sql<number>`count(*)::int` }).from(comentario)) as [{ n: number }];
    expect(comentarios).toBeGreaterThanOrEqual(3);
  });

  it('una cuenta general por area y por agencia; toda referencia de ejemplo tiene area responsable (C1, C3, P4)', async () => {
    const us = await c.db.select({ email: usuario.email, area: usuario.area, rol: usuario.rol, tipo: usuario.organizacionTipo }).from(usuario);
    for (const area of AREAS) {
      expect(us.filter((u) => u.area === area && u.tipo === 'interna' && u.rol === 'solicitante').length, area).toBeGreaterThanOrEqual(1);
    }
    expect(us.filter((u) => u.tipo === 'agencia').map((u) => u.email).sort()).toEqual(['aduana-a@desarrollo.invalid', 'aduana-b@desarrollo.invalid']);
    const sinArea = (await c.db.select().from(referencia)).filter((f) => !f.datos.area_responsable?.v);
    expect(sinArea.map((f) => f.codigo)).toEqual([]);
    // La cuenta de Mantenimiento ve en «Para mí» lo de su area aunque nadie se lo haya enviado.
    const [m] = await c.db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'mantenimiento@desarrollo.invalid'));
    const mant = await cargarActorPorId(c.db, m!.id);
    expect((await pendientesDe(c.db, mant!, new Date())).some((p) => p.delArea === 'Mantenimiento')).toBe(true);
  });

  it('es idempotente y no se siembra sin pasar por las semillas de desarrollo', async () => {
    const antes = (await c.db.select().from(referencia)).length;
    await sembrarDesarrollo(c.db);
    await sembrarEjemplos(c.db);
    expect((await c.db.select().from(referencia)).length).toBe(antes);
    const limpia = await nuevaBd();
    await sembrarDatosMaestros(limpia.db);
    expect((await limpia.db.select().from(referencia)).length).toBe(0);
    await limpia.cerrar();
  });
});
