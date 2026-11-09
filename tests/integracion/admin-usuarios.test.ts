/** Administracion de personas (H5): reenviar invitacion, editar, cerrar sesiones, correo invalido, lecturas y permisos. */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, auditoria, entregaCorreo, notificacion, session, usuario } from '@/db/esquema';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cambiarOrganizacion, cambiarRol, desactivarUsuario, invitarUsuario } from '@/server/acciones/usuarios';
import { cerrarSesionesDeUsuario, editarUsuario, marcarCorreoInvalido, REGLAS_REENVIO, reenviarInvitacion } from '@/server/acciones/usuarios-admin';
import {
  candidatosReasignacion,
  contarAdminsActivos,
  listarSesionesDeUsuario,
  listarUsuariosAdmin,
  obtenerUsuarioAdmin,
  pendientesDeUsuario,
  resumenAdmin,
} from '@/server/politicas/administracion';
import { asignarAAduana, nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

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

async function abrirSesion(userId: string, agente = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'): Promise<string> {
  const [s] = await e.db
    .insert(session)
    .values({ userId, token: `t-${Math.random().toString(36).slice(2)}-${Date.now()}`, expiresAt: new Date(Date.now() + 3_600_000), userAgent: agente, ipAddress: '10.0.0.7' })
    .returning({ id: session.id });
  return (s as { id: string }).id;
}

const auditoriasDe = (accion: string, entidadId: string) =>
  e.db.select().from(auditoria).where(and(eq(auditoria.accion, accion as never), eq(auditoria.entidadId, entidadId)));

describe('permisos: ningun rol salvo admin puede administrar personas', () => {
  it('niega a solicitante, aduana y lector en TODAS las operaciones y lecturas nuevas', async () => {
    const quien = [e.edward, e.brian, e.lector];
    for (const actor of quien) {
      const ctx = e.ctx(actor);
      const objetivo = e.charles.usuarioId;
      const intentos: Array<[string, () => Promise<unknown>]> = [
        ['reenviar', () => reenviarInvitacion(ctx, { usuarioId: objetivo }, async () => {})],
        ['editar', () => editarUsuario(ctx, { usuarioId: objetivo, nombre: 'X' })],
        ['cerrar sesiones', () => cerrarSesionesDeUsuario(ctx, { usuarioId: objetivo })],
        ['correo invalido', () => marcarCorreoInvalido(ctx, { usuarioId: objetivo, invalido: true })],
        ['listar', () => listarUsuariosAdmin(e.db, actor)],
        ['obtener', () => obtenerUsuarioAdmin(e.db, actor, objetivo)],
        ['pendientes', () => pendientesDeUsuario(e.db, actor, objetivo)],
        ['candidatos', () => candidatosReasignacion(e.db, actor, objetivo)],
        ['sesiones', () => listarSesionesDeUsuario(e.db, actor, objetivo)],
        ['admins', () => contarAdminsActivos(e.db, actor)],
        ['resumen', () => resumenAdmin(e.db, actor)],
      ];
      for (const [nombre, p] of intentos) expect(await codigoDe(p()), `${actor.rol}: ${nombre}`).toBe('SIN_PERMISO');
    }
  });
});

describe('reenviar invitacion', () => {
  it('envia por el callback, audita y avisa si es la primera vez', async () => {
    const nuevo = await invitarUsuario(e.ctx(e.admin), { nombre: 'Marta Nueva', email: 'marta@prueba.invalid', organizacionId: e.orgInterna, rol: 'solicitante' });
    const enviados: string[] = [];
    const r = await reenviarInvitacion(e.ctx(e.admin), { usuarioId: nuevo.id }, async (p) => void enviados.push(p.email));
    expect(r).toMatchObject({ email: 'marta@prueba.invalid', sinIngreso: true });
    expect(enviados).toEqual(['marta@prueba.invalid']);
    const a = await auditoriasDe('reenviar_invitacion', nuevo.id);
    expect(a).toHaveLength(1);
    expect(a[0]!.usuarioId).toBe(e.admin.usuarioId);
    expect(a[0]!.detalle).toMatchObject({ enviado: true, sinIngreso: true });
  });

  it('quien ya ingreso no es una invitacion pendiente', async () => {
    await e.db.update(usuario).set({ ultimoIngreso: new Date() }).where(eq(usuario.id, e.charles.usuarioId));
    const r = await reenviarInvitacion(e.ctx(e.admin), { usuarioId: e.charles.usuarioId }, async () => {});
    expect(r.sinIngreso).toBe(false);
  });

  it('limita los reenvios a la misma persona (3 por hora) y no llama al envio cuando se pasa', async () => {
    const u = await invitarUsuario(e.ctx(e.admin), { nombre: 'Insistente', email: 'insistente@prueba.invalid', organizacionId: e.orgInterna, rol: 'lector' });
    let llamadas = 0;
    const ahora = new Date('2026-10-21T15:00:00Z');
    for (let i = 0; i < REGLAS_REENVIO.porPersona.max; i++) {
      await reenviarInvitacion(e.ctx(e.admin, ahora), { usuarioId: u.id }, async () => void llamadas++);
    }
    expect(llamadas).toBe(3);
    let fallo: unknown;
    try {
      await reenviarInvitacion(e.ctx(e.admin, ahora), { usuarioId: u.id }, async () => void llamadas++);
    } catch (err) {
      fallo = err;
    }
    expect(fallo).toBeInstanceOf(ErrorAccion);
    expect((fallo as ErrorAccion).codigo).toBe('LIMITE_TASA');
    expect((fallo as ErrorAccion).message).toMatch(/Espera \d+ minutos? antes de reenviar/);
    expect(llamadas).toBe(3);
    // una hora despues vuelve a poder
    const luego = new Date(ahora.getTime() + 3_600_000 + 1000);
    await reenviarInvitacion(e.ctx(e.admin, luego), { usuarioId: u.id }, async () => void llamadas++);
    expect(llamadas).toBe(4);
  });

  it('rechaza a quien esta desactivado, tiene correo invalido o no existe', async () => {
    const u = await invitarUsuario(e.ctx(e.admin), { nombre: 'Inactiva', email: 'inactiva@prueba.invalid', organizacionId: e.orgInterna, rol: 'lector' });
    await marcarCorreoInvalido(e.ctx(e.admin), { usuarioId: u.id, invalido: true });
    expect(await codigoDe(reenviarInvitacion(e.ctx(e.admin), { usuarioId: u.id }, async () => {}))).toBe('VALIDACION');
    await marcarCorreoInvalido(e.ctx(e.admin), { usuarioId: u.id, invalido: false });
    await desactivarUsuario(e.ctx(e.admin), { usuarioId: u.id });
    expect(await codigoDe(reenviarInvitacion(e.ctx(e.admin), { usuarioId: u.id }, async () => {}))).toBe('VALIDACION');
    expect(await codigoDe(reenviarInvitacion(e.ctx(e.admin), { usuarioId: '00000000-0000-4000-8000-000000000000' }, async () => {}))).toBe('NO_ENCONTRADO');
  });

  it('si el envio falla, el error sube y la auditoria dice que no salio', async () => {
    const u = await invitarUsuario(e.ctx(e.admin), { nombre: 'Sin proveedor', email: 'sinproveedor@prueba.invalid', organizacionId: e.orgInterna, rol: 'lector' });
    await expect(
      reenviarInvitacion(e.ctx(e.admin), { usuarioId: u.id }, async () => {
        throw new Error('proveedor caido');
      }),
    ).rejects.toThrow('proveedor caido');
    const a = await auditoriasDe('reenviar_invitacion', u.id);
    expect(a[0]!.detalle).toMatchObject({ enviado: false });
  });
});

describe('editar datos y correo invalido', () => {
  it('cambia nombre y area, audita el antes y el despues, y no audita si no hay cambio', async () => {
    await editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: 'Charles Mantenimiento', area: 'Mantenimiento' });
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.charles.usuarioId));
    expect(u).toMatchObject({ nombre: 'Charles Mantenimiento', area: 'Mantenimiento' });
    const antes = await auditoriasDe('editar_usuario', e.charles.usuarioId);
    expect(antes).toHaveLength(1);
    expect(antes[0]!.detalle).toMatchObject({ nombre: { de: 'Charles', a: 'Charles Mantenimiento' } });
    await editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: 'Charles Mantenimiento', area: 'Mantenimiento' });
    expect(await auditoriasDe('editar_usuario', e.charles.usuarioId)).toHaveLength(1);
  });

  it('valida el nombre', async () => {
    expect(await codigoDe(editarUsuario(e.ctx(e.admin), { usuarioId: e.charles.usuarioId, nombre: '   ' }))).toBe('VALIDACION');
  });

  it('marca y desmarca el correo invalido con auditoria', async () => {
    await marcarCorreoInvalido(e.ctx(e.admin), { usuarioId: e.lector.usuarioId, invalido: true });
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.lector.usuarioId)))[0]!.correoInvalido).toBe(true);
    await marcarCorreoInvalido(e.ctx(e.admin), { usuarioId: e.lector.usuarioId, invalido: false });
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.lector.usuarioId)))[0]!.correoInvalido).toBe(false);
    expect(await auditoriasDe('marcar_correo_invalido', e.lector.usuarioId)).toHaveLength(2);
  });
});

describe('sesiones de otra persona', () => {
  it('lista solo las vigentes, sin token, y las cierra todas o una sola', async () => {
    const a = await abrirSesion(e.edward.usuarioId);
    const b = await abrirSesion(e.edward.usuarioId, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1');
    const ajena = await abrirSesion(e.charles.usuarioId);
    await e.db.insert(session).values({ userId: e.edward.usuarioId, token: 'vencida', expiresAt: new Date(Date.now() - 1000) });

    const vistas = await listarSesionesDeUsuario(e.db, e.admin, e.edward.usuarioId);
    expect(vistas.map((s) => s.id).sort()).toEqual([a, b].sort());
    expect(JSON.stringify(vistas)).not.toMatch(/"token"/);

    expect(await cerrarSesionesDeUsuario(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, sesionId: a })).toEqual({ cerradas: 1 });
    expect((await listarSesionesDeUsuario(e.db, e.admin, e.edward.usuarioId)).map((s) => s.id)).toEqual([b]);
    expect(await codigoDe(cerrarSesionesDeUsuario(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, sesionId: a }))).toBe('NO_ENCONTRADO');
    // la sesion de otra persona no se puede cerrar diciendo que es de Edward
    expect(await codigoDe(cerrarSesionesDeUsuario(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, sesionId: ajena }))).toBe('NO_ENCONTRADO');
    expect(await listarSesionesDeUsuario(e.db, e.admin, e.charles.usuarioId)).toHaveLength(1);

    expect(await cerrarSesionesDeUsuario(e.ctx(e.admin), { usuarioId: e.edward.usuarioId })).toEqual({ cerradas: 2 }); // la vigente y la vencida
    const a2 = await auditoriasDe('cerrar_sesion', e.edward.usuarioId);
    expect(a2.some((x) => (x.detalle as { porAdmin?: boolean }).porAdmin === true)).toBe(true);
  });
});

describe('listados y filtros', () => {
  it('filtra por rol, organizacion, estado y texto (sin tildes ni mayusculas)', async () => {
    const todos = await listarUsuariosAdmin(e.db, e.admin);
    expect(todos.length).toBeGreaterThanOrEqual(6);
    expect((await listarUsuariosAdmin(e.db, e.admin, { rol: 'aduana' })).every((u) => u.rol === 'aduana')).toBe(true);
    expect((await listarUsuariosAdmin(e.db, e.admin, { organizacionId: e.orgA })).map((u) => u.email)).toEqual(['brian@prueba.invalid']);
    expect((await listarUsuariosAdmin(e.db, e.admin, { q: 'LUCIA' })).map((u) => u.email)).toEqual(['lucia@prueba.invalid']);
    expect((await listarUsuariosAdmin(e.db, e.admin, { q: 'lucía' })).map((u) => u.email)).toEqual(['lucia@prueba.invalid']);
    expect((await listarUsuariosAdmin(e.db, e.admin, { q: '@prueba.invalid' })).length).toBeGreaterThan(3);
    expect(await listarUsuariosAdmin(e.db, e.admin, { q: '%' })).toHaveLength(0); // el comodin no es comodin
    const inactivos = await listarUsuariosAdmin(e.db, e.admin, { estado: 'inactivo' });
    expect(inactivos.every((u) => !u.activo)).toBe(true);
    expect(inactivos.some((u) => u.email === 'inactiva@prueba.invalid')).toBe(true);
    const sinIngreso = await listarUsuariosAdmin(e.db, e.admin, { estado: 'sin_ingreso' });
    expect(sinIngreso.every((u) => u.activo && u.ultimoIngreso === null)).toBe(true);
    expect(sinIngreso.some((u) => u.email === 'marta@prueba.invalid')).toBe(true);
    expect(await obtenerUsuarioAdmin(e.db, e.admin, 'no-es-un-uuid')).toBeNull();
  });

  it('un filtro de organizacion que no es uuid se ignora en vez de romper', async () => {
    expect((await listarUsuariosAdmin(e.db, e.admin, { organizacionId: "x' or 1=1 --" })).length).toBeGreaterThan(0);
  });
});

describe('pendientes y candidatos de reasignacion', () => {
  it('lista las asignaciones abiertas con codigo, quien envio y desde cuando; los candidatos son activos y no lectores', async () => {
    const f1 = await nuevaFicha(e);
    const f2 = await nuevaFicha(e, { codigo: 'ADM-0002', nombre: 'Motor de prueba' });
    await asignarAAduana(e, f1, e.brian);
    await asignarAAduana(e, f2, e.brian);
    const p = await pendientesDeUsuario(e.db, e.admin, e.brian.usuarioId);
    expect(p).toHaveLength(2);
    expect(p.map((x) => x.codigo)).toEqual(expect.arrayContaining(['ADM-0002']));
    expect(p[0]).toMatchObject({ deNombre: 'Edward', pedido: 'clasificar' });

    const c = await candidatosReasignacion(e.db, e.admin, e.brian.usuarioId);
    expect(c.every((x) => x.rol !== 'lector' && x.id !== e.brian.usuarioId)).toBe(true);
    expect(c.map((x) => x.id)).toContain(e.brianB.usuarioId);
    expect(c.map((x) => x.id)).not.toContain(e.lector.usuarioId);
    expect(c.find((x) => x.id === e.brianB.usuarioId)?.pendientes).toBe(0);
  });

  it('guia la desactivacion: sin destino falla con la lista; con destino reasigna y cierra sesiones en la misma transaccion', async () => {
    await abrirSesion(e.brian.usuarioId);
    const pendientes = await pendientesDeUsuario(e.db, e.admin, e.brian.usuarioId);
    let fallo: ErrorAccion | undefined;
    try {
      await desactivarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId });
    } catch (err) {
      fallo = err as ErrorAccion;
    }
    expect(fallo?.codigo).toBe('VALIDACION');
    expect(fallo?.message).toMatch(/2 referencias pendientes/);
    expect((fallo?.detalle as { pendientes: string[] }).pendientes.sort()).toEqual(pendientes.map((p) => p.referenciaId).sort());
    expect((await e.db.select().from(usuario).where(eq(usuario.id, e.brian.usuarioId)))[0]!.activo).toBe(true); // nada cambio

    const mapa = Object.fromEntries(pendientes.map((p) => [p.referenciaId, e.brianB.usuarioId]));
    const r = await desactivarUsuario(e.ctx(e.admin), { usuarioId: e.brian.usuarioId, reasignaciones: mapa });
    expect(r.reasignadas).toBe(2);
    expect(r.sesionesCerradas).toBeGreaterThanOrEqual(1);
    expect(await pendientesDeUsuario(e.db, e.admin, e.brian.usuarioId)).toHaveLength(0);
    expect(await pendientesDeUsuario(e.db, e.admin, e.brianB.usuarioId)).toHaveLength(2);
    expect(await listarSesionesDeUsuario(e.db, e.admin, e.brian.usuarioId)).toHaveLength(0);
    const viejas = await e.db.select().from(asignacion).where(and(eq(asignacion.aUsuarioId, e.brian.usuarioId), eq(asignacion.estado, 'reasignada')));
    expect(viejas).toHaveLength(2);

    // El nuevo responsable se entera: aviso en la campana + correo en el outbox, creados en la misma transaccion.
    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(and(eq(notificacion.usuarioId, e.brianB.usuarioId), eq(notificacion.tipo, 'asignacion')));
    expect(avisos).toHaveLength(2);
    expect(avisos.every((a) => a.asignacionId !== null && a.leidaEn === null)).toBe(true);
    expect(r.correoIds).toHaveLength(2);
    const correos = await e.db.select().from(entregaCorreo).where(inArray(entregaCorreo.id, r.correoIds));
    expect(correos).toHaveLength(2);
    expect(correos.every((c) => c.plantilla === 'pendiente' && c.estado === 'pendiente')).toBe(true);
    // La auditoria dice QUE referencias se movieron y A QUIEN (no solo cuantas).
    const [evento] = await auditoriasDe('desactivar', e.brian.usuarioId);
    const detalle = evento!.detalle as { reasignadas: number; movidas: Array<{ referenciaId: string; aUsuarioId: string }> };
    expect(detalle.reasignadas).toBe(2);
    const porRef = (a: { referenciaId: string }, b: { referenciaId: string }) => a.referenciaId.localeCompare(b.referenciaId);
    expect([...detalle.movidas].sort(porRef)).toEqual(
      pendientes.map((p) => ({ referenciaId: p.referenciaId, aUsuarioId: e.brianB.usuarioId })).sort(porRef),
    );
    // Quien dejo de ser responsable no recibe aviso por esto.
    expect(await e.db.select().from(notificacion).where(and(eq(notificacion.usuarioId, e.brian.usuarioId), eq(notificacion.tipo, 'asignacion')))).toHaveLength(0);
  });
});

describe('cambios sin efecto no ensucian la auditoria', () => {
  it('cambiar al mismo rol o a la misma organizacion no escribe nada', async () => {
    const antes = (await e.db.select().from(auditoria)).length;
    await cambiarRol(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, rol: 'solicitante' });
    await cambiarOrganizacion(e.ctx(e.admin), { usuarioId: e.edward.usuarioId, organizacionId: e.orgInterna });
    expect((await e.db.select().from(auditoria)).length).toBe(antes);
  });
});

describe('resumen del administrador', () => {
  it('cuenta personas sin ingresar, agencias sin gente activa y correos con fallo', async () => {
    const r = await resumenAdmin(e.db, e.admin);
    expect(r.usuarios.activos).toBeGreaterThan(0);
    expect(r.usuarios.inactivos).toBeGreaterThanOrEqual(2);
    expect(r.usuarios.sinIngreso).toBeGreaterThanOrEqual(1);
    expect(r.sinIngresoLista.length).toBeLessThanOrEqual(5);
    expect(r.organizaciones).toEqual({ internas: 1, agencias: 2 });
    expect(r.agenciasSinUsuarios.map((a) => a.nombre)).toEqual(['Agencia A']); // Brian, su unica persona, se desactivo
  });
});
