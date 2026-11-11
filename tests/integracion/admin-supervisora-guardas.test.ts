/**
 * Guardas por objetivo de la supervisora general (`exigirRolAsignable` y `exigirCuentaTocable`), con el mensaje que ve.
 * Ella gestiona personas con `supervisar`, asi que estas guardas se alcanzan de verdad: si alguien quita una de una accion,
 * o la supervisora llega a una cuenta de administrador o de supervisora, estas pruebas fallan.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, usuario } from '@/db/esquema';
import { cambiarOrganizacion, cambiarRol, crearCuenta, desactivarUsuario, reactivarUsuario, restablecerClave } from '@/server/acciones/usuarios';
import { editarUsuario } from '@/server/acciones/usuarios-admin';
import type { Actor, Contexto } from '@/server/politicas/actor';
import { crearSupervisora, nuevoEscenario, rechazaCon, type Escenario } from './ayudas';

let e: Escenario;
let angie: Actor;
let otra: Actor;
let ctxAngie: Contexto;

beforeAll(async () => {
  e = await nuevoEscenario();
  angie = await crearSupervisora(e);
  otra = await crearSupervisora(e, 'Otra Supervisora', 'otra@prueba.invalid');
  ctxAngie = e.ctx(angie);
});
afterAll(async () => {
  await e.c.cerrar();
});

const SOLO_ADMIN_ROL = /Solo el administrador puede dar el rol/;
const CUENTA_RESERVADA = /cuentas de administrador y de supervisora general solo las gestiona/;
const SOLO_ADMIN = /Esta acción es solo del administrador/;

describe('la supervisora actua sobre cuentas comunes pero las guardas por objetivo siguen cerrando', () => {
  it('actua sobre una cuenta que no es de administrador ni de supervisora', async () => {
    await expect(editarUsuario(ctxAngie, { usuarioId: e.charles.usuarioId, nombre: 'Charles', area: 'Consumibles' })).resolves.toEqual({ ok: true });
    await expect(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol: 'lector' })).resolves.toEqual({ ok: true });
    await expect(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol: 'solicitante' })).resolves.toEqual({ ok: true });
  });

  it('las claves son del administrador: ni siquiera de una cuenta comun', async () => {
    await rechazaCon(restablecerClave(ctxAngie, { usuarioId: e.charles.usuarioId }), SOLO_ADMIN);
  });

  it('no crea ni promueve administradores o supervisoras', async () => {
    for (const rol of ['admin', 'supervisor'] as const) {
      await rechazaCon(crearCuenta(ctxAngie, { nombre: 'Intrusa', usuario: `intrusa-${rol}`, organizacionId: e.orgInterna, rol }), SOLO_ADMIN_ROL);
      await rechazaCon(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol }), SOLO_ADMIN_ROL);
    }
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId)))[0]!.rol).toBe('solicitante');
    expect((await e.db.select().from(usuario).where(eq(usuario.username, 'intrusa-admin'))).length).toBe(0);
  });

  it('no toca las cuentas de administrador ni de supervisora: clave, rol, datos, organizacion, estado ni sesiones', async () => {
    for (const objetivo of [e.admin.usuarioId, otra.usuarioId, angie.usuarioId]) {
      const [antes] = await e.db.select().from(account).where(and(eq(account.userId, objetivo), eq(account.providerId, 'credential')));
      const fila = (await e.db.select().from(usuario).where(eq(usuario.id, objetivo)))[0]!;
      await rechazaCon(cambiarRol(ctxAngie, { usuarioId: objetivo, rol: 'lector' }), CUENTA_RESERVADA);
      await rechazaCon(editarUsuario(ctxAngie, { usuarioId: objetivo, nombre: 'Cambiado' }), CUENTA_RESERVADA);
      await rechazaCon(cambiarOrganizacion(ctxAngie, { usuarioId: objetivo, organizacionId: e.orgInterna }), CUENTA_RESERVADA);
      await rechazaCon(desactivarUsuario(ctxAngie, { usuarioId: objetivo }), CUENTA_RESERVADA);
      await rechazaCon(reactivarUsuario(ctxAngie, { usuarioId: objetivo }), CUENTA_RESERVADA);

      const [despues] = await e.db.select().from(account).where(and(eq(account.userId, objetivo), eq(account.providerId, 'credential')));
      expect(despues?.password).toBe(antes?.password);
      expect((await e.db.select().from(usuario).where(eq(usuario.id, objetivo)))[0]).toMatchObject({ rol: fila.rol, activo: true, nombre: fila.nombre, organizacionId: fila.organizacionId });
    }
  });
});
