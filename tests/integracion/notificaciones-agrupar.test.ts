/**
 * Agrupacion de avisos (src/server/notificaciones/crear.ts), con PGlite:
 *  - repetir un aviso agrupable SIN LEER lo renueva (un solo aviso, titulo y hora nuevos);
 *  - si el anterior ya se leyo, se crea uno nuevo;
 *  - carrera: si la persona lo lee ENTRE el SELECT y el UPDATE, el UPDATE ya no lo toca y la novedad
 *    llega como aviso nuevo y sin leer (no escondida bajo uno leido).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { notificacion } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';
import { crearNotificacion } from '@/server/notificaciones/crear';
import { nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

let e: Escenario;
let ficha: string;

beforeAll(async () => {
  e = await nuevoEscenario();
  ficha = await nuevaFicha(e);
});
afterAll(async () => {
  await e.c.cerrar();
});
beforeEach(async () => {
  await e.db.delete(notificacion);
});

const avisos = () => e.db.select().from(notificacion).orderBy(notificacion.creadaEn);
const base = () => ({ usuarioId: e.edward.usuarioId, tipo: 'respuesta' as const, referenciaId: ficha });

/**
 * Ejecutor que deja correr el SELECT de la busqueda y, justo despues (antes del UPDATE), ejecuta `tras`:
 * reproduce la lectura del aviso en otra transaccion que no bloquea la ficha.
 */
function conLecturaEnMedio(tras: () => Promise<unknown>): Ejecutor {
  const espiar = (b: any): any =>
    new Proxy(b, {
      get(t, p) {
        if (p === 'limit') {
          return (...a: unknown[]) => {
            const q = t.limit(...a);
            return { then: (ok: any, ko: any) => Promise.resolve(q).then(async (r) => (await tras(), r)).then(ok, ko) };
          };
        }
        const v = t[p];
        return typeof v === 'function' ? (...a: unknown[]) => espiar(v.apply(t, a)) : v;
      },
    });
  return new Proxy(e.db, {
    get(t, p) {
      if (p === 'select') return (...a: unknown[]) => espiar((t.select as any)(...a));
      const v = (t as any)[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as Ejecutor;
}

describe('crearNotificacion: agrupacion', () => {
  it('un aviso agrupable repetido sin leer se renueva: queda uno solo con el titulo y la hora nuevos', async () => {
    const id1 = await crearNotificacion(e.db, { ...base(), titulo: 'primero', creadaEn: new Date('2026-11-09T10:00:00Z') });
    const id2 = await crearNotificacion(e.db, { ...base(), titulo: 'segundo', creadaEn: new Date('2026-11-09T11:00:00Z') });
    expect(id2).toBe(id1);
    const filas = await avisos();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ titulo: 'segundo', leidaEn: null });
    expect(filas[0]!.creadaEn.toISOString()).toBe('2026-11-09T11:00:00.000Z');
  });

  it('si el anterior ya se leyo, se inserta uno nuevo sin leer', async () => {
    const id1 = await crearNotificacion(e.db, { ...base(), titulo: 'primero' });
    await e.db.update(notificacion).set({ leidaEn: new Date() }).where(eq(notificacion.id, id1));
    const id2 = await crearNotificacion(e.db, { ...base(), titulo: 'segundo' });
    expect(id2).not.toBe(id1);
    const filas = await avisos();
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.id === id1)).toMatchObject({ titulo: 'primero' }); // el leido no se toca
    expect(filas.find((f) => f.id === id2)).toMatchObject({ titulo: 'segundo', leidaEn: null });
  });

  it('carrera: lo leen entre el SELECT y el UPDATE => el UPDATE no afecta nada y se inserta uno nuevo sin leer', async () => {
    const id1 = await crearNotificacion(e.db, { ...base(), titulo: 'primero' });
    const ej = conLecturaEnMedio(() => e.db.update(notificacion).set({ leidaEn: new Date() }).where(eq(notificacion.id, id1)));

    const id2 = await crearNotificacion(ej, { ...base(), titulo: 'segundo' });

    expect(id2).not.toBe(id1);
    const filas = await avisos();
    expect(filas).toHaveLength(2);
    const leido = filas.find((f) => f.id === id1)!;
    expect(leido.titulo).toBe('primero'); // el titulo nuevo NO quedo sobre el aviso ya leido
    expect(leido.leidaEn).not.toBeNull();
    expect(filas.find((f) => f.id === id2)).toMatchObject({ titulo: 'segundo', leidaEn: null });
  });
});
