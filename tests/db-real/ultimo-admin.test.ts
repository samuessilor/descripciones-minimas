/**
 * Carrera del «ultimo administrador activo» en Postgres REAL con dos conexiones (RV-24): dos admins que se
 * desactivan o se degradan a la vez, cada uno a si mismo. Sin serializar la guarda, ambas transacciones ven al
 * otro admin todavia activo (READ COMMITTED) y la plataforma queda sin nadie que la administre.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizacion, usuario } from '@/db/esquema';
import { cambiarRol, desactivarUsuario } from '@/server/acciones/usuarios';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let orgId: string;

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  orgId = interna!.id;
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

async function dosAdmins(prefijo: string): Promise<[Actor, Actor]> {
  // Aislar la ronda: solo existen estos dos administradores activos.
  await r.migrador.db.update(usuario).set({ activo: false }).where(eq(usuario.rol, 'admin'));
  const mk = async (n: string) => {
    const [u] = await r.migrador.db
      .insert(usuario)
      .values({ nombre: n, email: `${prefijo}-${n}@x.invalid`, rol: 'admin', organizacionId: orgId, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    return (await cargarActorPorId(r.app.db, u!.id))!;
  };
  return [await mk('a'), await mk('b')];
}

async function adminsActivos(): Promise<number> {
  const q = (await r.migrador.db.execute(sql`select count(*)::int as n from usuario where rol = 'admin' and activo`)) as unknown as {
    rows: Array<{ n: number }>;
  };
  return q.rows[0]!.n;
}

const codigo = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as { codigo?: string }).codigo ?? `RAW:${String(e).slice(0, 80)}`;
  }
};

const RONDAS = 25;
const ctx = (actor: Actor) => ({ db: r.app.db, actor });

describe('ultimo admin activo: dos conexiones reales en paralelo', () => {
  it('desactivarse mutuamente: siempre queda al menos un admin y una de las dos se rechaza', async () => {
    for (let i = 0; i < RONDAS; i++) {
      const [a, b] = await dosAdmins(`d${i}`);
      const sal = await Promise.all([
        codigo(desactivarUsuario(ctx(a), { usuarioId: a.usuarioId })),
        codigo(desactivarUsuario(ctx(b), { usuarioId: b.usuarioId })),
      ]);
      expect(await adminsActivos(), `ronda ${i}: ${sal.join('/')}`).toBeGreaterThanOrEqual(1);
      expect(sal.sort(), `ronda ${i}`).toEqual(['OK', 'VALIDACION']);
    }
  }, 120_000);

  it('degradarse mutuamente con cambiarRol: siempre queda al menos un admin', async () => {
    for (let i = 0; i < RONDAS; i++) {
      const [a, b] = await dosAdmins(`c${i}`);
      const sal = await Promise.all([
        codigo(cambiarRol(ctx(a), { usuarioId: a.usuarioId, rol: 'lector' })),
        codigo(cambiarRol(ctx(b), { usuarioId: b.usuarioId, rol: 'lector' })),
      ]);
      expect(await adminsActivos(), `ronda ${i}: ${sal.join('/')}`).toBeGreaterThanOrEqual(1);
      expect(sal.sort(), `ronda ${i}`).toEqual(['OK', 'VALIDACION']);
    }
  }, 120_000);

  it('cruzado (uno desactiva al otro, el otro lo degrada): siempre queda al menos un admin', async () => {
    for (let i = 0; i < RONDAS; i++) {
      const [a, b] = await dosAdmins(`x${i}`);
      const sal = await Promise.all([
        codigo(desactivarUsuario(ctx(a), { usuarioId: b.usuarioId })),
        codigo(cambiarRol(ctx(b), { usuarioId: a.usuarioId, rol: 'lector' })),
      ]);
      expect(await adminsActivos(), `ronda ${i}: ${sal.join('/')}`).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);
});
