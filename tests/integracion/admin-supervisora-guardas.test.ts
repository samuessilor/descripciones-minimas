/**
 * Guardas por objetivo de la supervisora general (`exigirRolAsignable` y `exigirCuentaTocable`). Con el permiso
 * `administrar` cerrado para ella esas guardas no se alcanzan, asi que aqui se le abre a proposito: si alguien
 * lo abre despues, o quita una guarda de una accion, estas pruebas fallan.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { account, usuario } from '@/db/esquema';

vi.mock('@/dominio/permisos', async (original) => {
  const real = await original<typeof import('@/dominio/permisos')>();
  return {
    ...real,
    puede: ((actor: { rol: string }, accion: string, ctx?: never) =>
      (actor.rol === 'supervisor' && accion === 'administrar') || real.puede(actor as never, accion as never, ctx)) as typeof real.puede,
  };
});

import { cambiarOrganizacion, cambiarRol, crearCuenta, desactivarUsuario, reactivarUsuario, restablecerClave } from '@/server/acciones/usuarios';
import { cerrarSesionesDeUsuario, editarUsuario } from '@/server/acciones/usuarios-admin';
import type { Actor, Contexto } from '@/server/politicas/actor';
import { crearSupervisora, nuevoEscenario, rechazaCon, type Escenario } from './ayudas';

let e: Escenario;
let angie: Actor;
let ctxAngie: Contexto;

beforeAll(async () => {
  e = await nuevoEscenario();
  angie = await crearSupervisora(e);
  ctxAngie = e.ctx(angie);
});
afterAll(async () => {
  await e.c.cerrar();
});

const SOLO_ADMIN_ROL = /Solo el administrador puede dar el rol/;
const CUENTA_ADMIN = /cuentas de administrador solo las gestiona/;

describe('con `administrar` abierto para la supervisora, las guardas por objetivo siguen cerrando', () => {
  it('el mock abre el permiso: puede actuar sobre una cuenta que no es de administrador', async () => {
    const r = await restablecerClave(ctxAngie, { usuarioId: e.charles.usuarioId });
    expect(r.claveTemporal.length).toBeGreaterThan(0);
    await expect(editarUsuario(ctxAngie, { usuarioId: e.charles.usuarioId, nombre: 'Charles', area: 'Consumibles' })).resolves.toEqual({ ok: true });
  });

  it('no crea ni promueve administradores o supervisoras', async () => {
    for (const rol of ['admin', 'supervisor'] as const) {
      await rechazaCon(crearCuenta(ctxAngie, { nombre: 'Intrusa', usuario: `intrusa-${rol}`, organizacionId: e.orgInterna, rol }), SOLO_ADMIN_ROL);
      await rechazaCon(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol }), SOLO_ADMIN_ROL);
    }
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId)))[0]!.rol).toBe('solicitante');
    expect((await e.db.select().from(usuario).where(eq(usuario.username, 'intrusa-admin'))).length).toBe(0);
  });

  it('no toca la cuenta del administrador: clave, rol, datos, organizacion, estado ni sesiones', async () => {
    const admin = e.admin.usuarioId;
    const [antes] = await e.db.select().from(account).where(and(eq(account.userId, admin), eq(account.providerId, 'credential')));
    await rechazaCon(restablecerClave(ctxAngie, { usuarioId: admin }), CUENTA_ADMIN);
    await rechazaCon(cambiarRol(ctxAngie, { usuarioId: admin, rol: 'lector' }), CUENTA_ADMIN);
    await rechazaCon(editarUsuario(ctxAngie, { usuarioId: admin, nombre: 'Cambiado' }), CUENTA_ADMIN);
    await rechazaCon(cambiarOrganizacion(ctxAngie, { usuarioId: admin, organizacionId: e.orgInterna }), CUENTA_ADMIN);
    await rechazaCon(desactivarUsuario(ctxAngie, { usuarioId: admin }), CUENTA_ADMIN);
    await rechazaCon(reactivarUsuario(ctxAngie, { usuarioId: admin }), CUENTA_ADMIN);
    await rechazaCon(cerrarSesionesDeUsuario(ctxAngie, { usuarioId: admin }), CUENTA_ADMIN);

    const [despues] = await e.db.select().from(account).where(and(eq(account.userId, admin), eq(account.providerId, 'credential')));
    expect(despues?.password).toBe(antes?.password);
    expect((await e.db.select().from(usuario).where(eq(usuario.id, admin)))[0]).toMatchObject({ rol: 'admin', activo: true, nombre: 'Ana Admin' });
  });
});
