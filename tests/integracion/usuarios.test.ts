/** Usuarios (M1, 10.4, 13.1): invitar, reglas rol x organizacion, desactivar con reasignacion. */
import { and, eq, ne } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, auditoria, usuario } from '@/db/esquema';
import { cambiarOrganizacion, cambiarRol, desactivarUsuario, crearCuenta, reactivarUsuario } from '@/server/acciones/usuarios';
import { ErrorAccion } from '@/server/acciones/resultado';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

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
  } catch (err) {
    return err instanceof ErrorAccion ? err.codigo : `otro:${String(err)}`;
  }
  return 'OK';
}

describe('invitar (D-28 en politicas)', () => {
  it('solo un admin crea cuentas', async () => {
    for (const quien of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(crearCuenta(e.ctx(quien), { nombre: 'X', usuario: 'xxx', email: 'x@prueba.invalid', organizacionId: e.orgInterna, rol: 'lector' }))).toBe('SIN_PERMISO');
    }
  });

  it('una agencia solo admite el rol aduana; una interna admite todos', async () => {
    for (const rol of ['admin', 'solicitante', 'lector'] as const) {
      expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'X', usuario: `${rol}-ag`, email: `${rol}@agencia.invalid`, organizacionId: e.orgA, rol }))).toBe('VALIDACION');
    }
    for (const rol of ['admin', 'solicitante', 'aduana', 'lector'] as const) {
      const r = await crearCuenta(e.ctx(e.admin), { nombre: `Interno ${rol}`, usuario: `interno-${rol}`, email: `${rol}@interna.invalid`, organizacionId: e.orgInterna, rol });
      expect(r.organizacionTipo).toBe('interna');
    }
  });

  it('guarda el usuario y el correo en minusculas, rechaza duplicados sin importar mayusculas y audita', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Nueva', usuario: ' Nueva.Interna ', email: ' Nueva@Interna.INVALID ', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' });
    expect(r.usuario).toBe('nueva.interna');
    const [fila] = await e.db.select().from(usuario).where(eq(usuario.id, r.id));
    expect(fila).toMatchObject({ username: 'nueva.interna', email: 'nueva@interna.invalid' });
    expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'Otra', usuario: 'NUEVA.interna', organizacionId: e.orgInterna, rol: 'solicitante' }))).toBe('DUPLICADO');
    // Sin correo propio, repetir el usuario dice «usuario» (no «correo»).
    const sinCorreo = await crearCuenta(e.ctx(e.admin), { nombre: 'Area X', usuario: 'area-x', organizacionId: e.orgInterna, rol: 'solicitante' });
    expect(sinCorreo.usuario).toBe('area-x');
    await expect(crearCuenta(e.ctx(e.admin), { nombre: 'Area X2', usuario: 'AREA-X', organizacionId: e.orgInterna, rol: 'solicitante' })).rejects.toThrow('Ya existe una cuenta con ese usuario.');
    expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'Otra', usuario: 'otra.persona', email: 'NUEVA@interna.invalid', organizacionId: e.orgInterna, rol: 'solicitante' }))).toBe('DUPLICADO');
    const a = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'crear_cuenta'), eq(auditoria.entidadId, r.id)));
    expect(a).toHaveLength(1);
    expect(a[0]!.usuarioId).toBe(e.admin.usuarioId);
  });

  it('rechaza correos y organizaciones invalidos', async () => {
    expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'X', usuario: 'xxx', email: 'no-es-correo', organizacionId: e.orgInterna, rol: 'lector' }))).toBe('VALIDACION');
    expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'X', usuario: 'xxx', email: 'o@prueba.invalid', organizacionId: '00000000-0000-4000-8000-000000000000', rol: 'lector' }))).toBe('NO_ENCONTRADO');
  });
});

describe('cambiar rol y organizacion', () => {
  it('no se puede pasar a un usuario de agencia a un rol interno ni mover a un interno no-aduana a una agencia', async () => {
    expect(await codigoDe(cambiarRol(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, rol: 'solicitante' }))).toBe('VALIDACION');
    expect(await codigoDe(cambiarOrganizacion(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, organizacionId: e.orgA }))).toBe('VALIDACION');
    expect(await codigoDe(cambiarRol(e.ctx(e.edward), { usuarioId: e.charles.usuarioId, rol: 'lector' }))).toBe('SIN_PERMISO');
  });

  it('un interno con rol aduana si puede moverse a una agencia (PA-16 lo deja abierto)', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Clasificador interno', usuario: 'clasif', email: 'clasif@interna.invalid', organizacionId: e.orgInterna, rol: 'aduana' });
    expect(await codigoDe(cambiarOrganizacion(e.ctx(e.admin), { usuarioId: r.id, organizacionId: e.orgB }))).toBe('OK');
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, r.id));
    expect(u).toMatchObject({ organizacionId: e.orgB, organizacionTipo: 'agencia' });
  });

  it('el unico administrador activo no puede perder su rol', async () => {
    await e.db.update(usuario).set({ activo: false }).where(and(eq(usuario.rol, 'admin'), ne(usuario.id, e.admin.usuarioId)));
    expect(await codigoDe(cambiarRol(e.ctx(e.admin), { usuarioId: e.admin.usuarioId, rol: 'solicitante' }))).toBe('VALIDACION');
  });
});

describe('desactivar (10.4, 10.6, CA-29)', () => {
  it('con pendientes EXIGE reasignarlos; reasigna, deja historial y no borra nada', async () => {
    const f1 = await nuevaFicha(e);
    const f2 = await nuevaFicha(e);
    await asignarAAduana(e, f1, e.brian);
    await asignarAAduana(e, f2, e.brian);

    const err = (await desactivarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId }).catch((x: unknown) => x)) as ErrorAccion;
    expect(err).toBeInstanceOf(ErrorAccion);
    expect(err.codigo).toBe('VALIDACION');
    expect(err.message).toContain('2 referencias pendientes');
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.brian.usuarioId)))[0]!.activo).toBe(true);

    // Destino invalido: un lector.
    expect(await codigoDe(desactivarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, reasignaciones: { [f1]: e.lector.usuarioId, [f2]: e.lector.usuarioId } }))).toBe('VALIDACION');

    const colega = await crearCuenta(e.ctx(e.admin), { nombre: 'Colega', usuario: 'u-colega', email: 'colega@agencia.invalid', organizacionId: e.orgA, rol: 'aduana' });
    const r = await desactivarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, reasignaciones: { [f1]: colega.id, [f2]: colega.id } });
    expect(r.reasignadas).toBe(2);

    const viejas = await e.db.select().from(asignacion).where(eq(asignacion.aUsuarioId, e.brian.usuarioId));
    expect(viejas.map((a) => a.estado)).toEqual(['reasignada', 'reasignada']);
    const nuevas = await e.db.select().from(asignacion).where(eq(asignacion.aUsuarioId, colega.id));
    expect(nuevas.map((a) => [a.referenciaId, a.estado]).sort()).toEqual([[f1, 'pendiente'], [f2, 'pendiente']].sort());
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.brian.usuarioId)))[0]!.activo).toBe(false);

    const a = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'desactivar'), eq(auditoria.entidadId, e.brian.usuarioId)));
    expect(a[0]!.detalle).toMatchObject({ reasignadas: 2 });
  });

  it('si el destino ya tenia la ficha pendiente no rompe el indice unico (se cierra solo la vieja)', async () => {
    const f = await nuevaFicha(e);
    const dos = await crearCuenta(e.ctx(e.admin), { nombre: 'Dos', usuario: 'u-dos', email: 'dos@agencia.invalid', organizacionId: e.orgB, rol: 'aduana' });
    const tres = await crearCuenta(e.ctx(e.admin), { nombre: 'Tres', usuario: 'u-tres', email: 'tres@agencia.invalid', organizacionId: e.orgB, rol: 'aduana' });
    await e.db.insert(asignacion).values([
      { referenciaId: f, deUsuarioId: e.edward.usuarioId, aUsuarioId: dos.id, estado: 'pendiente' },
      { referenciaId: f, deUsuarioId: e.edward.usuarioId, aUsuarioId: tres.id, estado: 'pendiente' },
    ]);
    await desactivarUsuario(e.ctx(e.admin), { usuarioId: dos.id, reasignaciones: { [f]: tres.id } });
    const filas = await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, f));
    expect(filas.filter((a) => a.estado === 'pendiente')).toHaveLength(1);
    expect(filas.filter((a) => a.estado === 'reasignada')).toHaveLength(1);
  });

  it('no deja sin administradores y se puede reactivar', async () => {
    await e.db.update(usuario).set({ activo: false }).where(and(eq(usuario.rol, 'admin'), ne(usuario.id, e.admin.usuarioId)));
    expect(await codigoDe(desactivarUsuario(e.ctx(e.admin), { usuarioId: e.admin.usuarioId }))).toBe('VALIDACION');
    const otro = await crearCuenta(e.ctx(e.admin), { nombre: 'Admin 2', usuario: 'u-admin2', email: 'admin2@interna.invalid', organizacionId: e.orgInterna, rol: 'admin' });
    expect(await codigoDe(desactivarUsuario(e.ctx(e.admin), { usuarioId: otro.id }))).toBe('OK');
    expect(await codigoDe(reactivarUsuario(e.ctx(e.admin), { usuarioId: otro.id }))).toBe('OK');
    expect((await e.db.select().from(usuario).where(eq(usuario.id, otro.id)))[0]!.activo).toBe(true);
  });

  it('lo que el usuario ya habia llenado se conserva', async () => {
    const f = await nuevaFicha(e, { actor: e.charles });
    const { guardarCampo } = await import('@/server/acciones/guardar-campo');
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'Lo de Charles', versionEsperada: 0 });
    await desactivarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId });
    const { vistaFicha } = await import('@/server/politicas/referencias');
    const v = await vistaFicha(e.db, e.admin, f, new Date());
    expect(v.campos.uso).toMatchObject({ valor: 'Lo de Charles', autor: 'Charles' });
  });
});
