/** Organizaciones (H5): crear, renombrar, activar/desactivar y «Retirar acceso» de una agencia a una ficha. */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, auditoria, comentario, organizacion, usuario } from '@/db/esquema';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cambiarEstadoOrganizacion, crearAgencia, crearOrganizacion, editarOrganizacion, eliminarOrganizacion, retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { retirarAccesoAgencia as retirarDesdeAduana } from '@/server/acciones/aduana';
import { accesosDeAgencia, fichasConVariasAgencias, listarOrganizacionesAdmin, obtenerOrganizacionAdmin } from '@/server/politicas/administracion';
import { fichaVisibleParaTest } from './ayudas-visibilidad';
import { crearSupervisora, nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

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

const auditorias = (accion: string, entidadId: string) =>
  e.db.select().from(auditoria).where(and(eq(auditoria.accion, accion as never), eq(auditoria.entidadId, entidadId)));

async function enviarA(referenciaId: string, a: { usuarioId: string }, estado: 'pendiente' | 'hecha' = 'pendiente', accesoHasta?: Date) {
  await e.db.insert(asignacion).values({
    referenciaId,
    deUsuarioId: e.edward.usuarioId,
    aUsuarioId: a.usuarioId,
    pedido: 'clasificar',
    estado,
    ...(estado === 'hecha' ? { completadaEn: new Date() } : {}),
    ...(accesoHasta ? { accesoHasta } : {}),
  });
}

describe('permisos', () => {
  it('solo un admin crea, renombra, activa o retira acceso', async () => {
    const ficha = await nuevaFicha(e);
    for (const actor of [e.edward, e.brian, e.lector]) {
      const ctx = e.ctx(actor);
      expect(await codigoDe(crearOrganizacion(ctx, { nombre: 'Intrusa', tipo: 'interna' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(editarOrganizacion(ctx, { organizacionId: e.orgA, nombre: 'Otro nombre' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarEstadoOrganizacion(ctx, { organizacionId: e.orgA, activa: false })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(eliminarOrganizacion(ctx, { organizacionId: e.orgA })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(retirarAccesoAgencia(ctx, { referenciaId: ficha, organizacionId: e.orgA })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(listarOrganizacionesAdmin(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(accesosDeAgencia(e.db, actor, e.orgA)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(fichasConVariasAgencias(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
    }
    expect((await e.db.select().from(organizacion).where(eq(organizacion.nombre, 'Intrusa'))).length).toBe(0);
  });
});

describe('crear, renombrar y estado', () => {
  it('crea areas y agencias, rechaza nombres repetidos (sin importar mayusculas del texto igual) y audita', async () => {
    const a = await crearOrganizacion(e.ctx(e.admin), { nombre: ' Mantenimiento ', tipo: 'interna' });
    const g = await crearOrganizacion(e.ctx(e.admin), { nombre: 'Agencia Globalco', tipo: 'agencia' });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, a.id)))[0]).toMatchObject({ nombre: 'Mantenimiento', tipo: 'interna', activa: true });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, g.id)))[0]).toMatchObject({ tipo: 'agencia' });
    expect(await codigoDe(crearOrganizacion(e.ctx(e.admin), { nombre: 'Mantenimiento', tipo: 'agencia' }))).toBe('DUPLICADO');
    // Solo cambia en mayusculas: es la misma organizacion.
    expect(await codigoDe(crearOrganizacion(e.ctx(e.admin), { nombre: 'MANTENIMIENTO', tipo: 'interna' }))).toBe('DUPLICADO');
    expect(await auditorias('crear_organizacion', a.id)).toHaveLength(1);
  });

  it('valida nombre y tipo', async () => {
    expect(await codigoDe(crearOrganizacion(e.ctx(e.admin), { nombre: 'A', tipo: 'interna' }))).toBe('VALIDACION');
    expect(await codigoDe(crearOrganizacion(e.ctx(e.admin), { nombre: 'Valida', tipo: 'otra' }))).toBe('VALIDACION');
  });

  it('renombrar no cambia el tipo ni a quien pertenece la gente', async () => {
    await editarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgB, nombre: 'Agencia Beta' });
    const [o] = await e.db.select().from(organizacion).where(eq(organizacion.id, e.orgB));
    expect(o).toMatchObject({ nombre: 'Agencia Beta', tipo: 'agencia' });
    const [u] = await e.db.select().from(usuario).where(eq(usuario.id, e.brianB.usuarioId));
    expect(u!.organizacionId).toBe(e.orgB);
    expect(await codigoDe(editarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgB, nombre: 'Interna' }))).toBe('DUPLICADO');
    expect(await codigoDe(editarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgB, nombre: 'INTERNA' }))).toBe('DUPLICADO');
    expect((await auditorias('editar_organizacion', e.orgB))[0]!.detalle).toMatchObject({ de: 'Agencia B', a: 'Agencia Beta' });
    // Corregir la capitalizacion de la propia organizacion si se puede.
    await editarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgB, nombre: 'AGENCIA BETA' });
    await editarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgB, nombre: 'Agencia Beta' });
  });

  it('no desactiva una organizacion con personas activas, y dice cuantas; vacia si puede', async () => {
    let fallo: ErrorAccion | undefined;
    try {
      await cambiarEstadoOrganizacion(e.ctx(e.admin), { organizacionId: e.orgInterna, activa: false });
    } catch (err) {
      fallo = err as ErrorAccion;
    }
    expect(fallo?.codigo).toBe('VALIDACION');
    expect(fallo?.message).toMatch(/personas activas/);
    const vacia = await crearOrganizacion(e.ctx(e.admin), { nombre: 'Temporal', tipo: 'interna' });
    await cambiarEstadoOrganizacion(e.ctx(e.admin), { organizacionId: vacia.id, activa: false });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, vacia.id)))[0]!.activa).toBe(false);
    await cambiarEstadoOrganizacion(e.ctx(e.admin), { organizacionId: vacia.id, activa: true });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, vacia.id)))[0]!.activa).toBe(true);
    expect(await auditorias('cambiar_estado_organizacion', vacia.id)).toHaveLength(2);
  });

  it('borra una organizacion sin cuentas ni historial (administrador y supervisora), la audita con su nombre y no deja rastro en las listas', async () => {
    const angie = await crearSupervisora(e);
    const creadaPorAdmin = await crearOrganizacion(e.ctx(e.admin), { nombre: 'Prueba xx admin', tipo: 'interna' });
    expect(await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: creadaPorAdmin.id })).toEqual({ ok: true, nombre: 'Prueba xx admin', cuentasEliminadas: 0 });
    const creadaPorSup = await crearOrganizacion(e.ctx(angie), { nombre: 'Agencia xx sup', tipo: 'agencia' });
    await cambiarEstadoOrganizacion(e.ctx(angie), { organizacionId: creadaPorSup.id, activa: false });
    await eliminarOrganizacion(e.ctx(angie), { organizacionId: creadaPorSup.id });
    for (const id of [creadaPorAdmin.id, creadaPorSup.id]) {
      expect(await e.db.select().from(organizacion).where(eq(organizacion.id, id))).toHaveLength(0);
      expect(await auditorias('eliminar_organizacion', id)).toHaveLength(1);
    }
    expect((await auditorias('eliminar_organizacion', creadaPorSup.id))[0]!.detalle).toMatchObject({ nombre: 'Agencia xx sup', tipo: 'agencia', activa: false });
    const nombres = (await listarOrganizacionesAdmin(e.db, e.admin)).map((o) => o.nombre);
    expect(nombres).not.toContain('Prueba xx admin');
    // El nombre queda libre para volver a crearla.
    await crearOrganizacion(e.ctx(e.admin), { nombre: 'Prueba xx admin', tipo: 'interna' });
  });

  it('no borra una organizacion con cuentas (activas o no) ni con cambios registrados, y no existe -> no encontrada', async () => {
    expect(await codigoDe(eliminarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgInterna }))).toBe('VALIDACION');
    // Una AGENCIA con una cuenta que ya trabajo en una referencia tampoco: borrarla perderia quien hizo ese cambio.
    const conTrabajo = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia con trabajo', usuario: 'agencia.trabajo' });
    await e.db.insert(comentario).values({ referenciaId: await nuevaFicha(e), autorId: conTrabajo.cuentaId, texto: 'Ya trabajé aquí', visibilidad: 'todos' });
    let sinPermiso: ErrorAccion | undefined;
    try {
      await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: conTrabajo.organizacionId });
    } catch (err) {
      sinPermiso = err as ErrorAccion;
    }
    expect(sinPermiso?.codigo).toBe('VALIDACION');
    expect(sinPermiso?.message).toMatch(/ya trabajó/);
    expect(await e.db.select().from(organizacion).where(eq(organizacion.id, conTrabajo.organizacionId))).toHaveLength(1);
    expect(await e.db.select().from(usuario).where(eq(usuario.id, conTrabajo.cuentaId))).toHaveLength(1);
    const conInactiva = await crearOrganizacion(e.ctx(e.admin), { nombre: 'Con cuenta inactiva', tipo: 'interna' });
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Fantasma', email: 'fantasma-org@prueba.invalid', rol: 'solicitante', organizacionId: conInactiva.id, organizacionTipo: 'interna', activo: false })
      .returning({ id: usuario.id });
    let fallo: ErrorAccion | undefined;
    try {
      await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: conInactiva.id });
    } catch (err) {
      fallo = err as ErrorAccion;
    }
    expect(fallo?.codigo).toBe('VALIDACION');
    expect(fallo?.message).toMatch(/1 cuenta/);
    expect(await e.db.select().from(organizacion).where(eq(organizacion.id, conInactiva.id))).toHaveLength(1);
    expect(await auditorias('eliminar_organizacion', conInactiva.id)).toHaveLength(0);
    expect(u!.id).toBeTruthy();
    expect(await codigoDe(eliminarOrganizacion(e.ctx(e.admin), { organizacionId: '00000000-0000-4000-8000-000000000000' }))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(eliminarOrganizacion(e.ctx(e.admin), { organizacionId: 'no-es-uuid' }))).toBe('VALIDACION');
  });

  it('las lecturas traen conteos de personas y de referencias con acceso', async () => {
    const lista = await listarOrganizacionesAdmin(e.db, e.admin);
    const interna = lista.find((o) => o.id === e.orgInterna)!;
    expect(interna.usuariosActivos).toBeGreaterThanOrEqual(4);
    const a = await obtenerOrganizacionAdmin(e.db, e.admin, e.orgA);
    expect(a).toMatchObject({ tipo: 'agencia', usuariosActivos: 1, fichasConAcceso: 0 });
    expect(await obtenerOrganizacionAdmin(e.db, e.admin, 'no-uuid')).toBeNull();
  });
});

describe('retirar acceso de una agencia a una ficha (8.3 regla 10)', () => {
  it('el stub de la aduana ahora es la implementacion real', () => {
    expect(retirarDesdeAduana).toBe(retirarAccesoAgencia);
  });

  it('cancela lo abierto, cierra el acceso temporal, audita y deja la ficha invisible para la agencia', async () => {
    const f = await nuevaFicha(e);
    await enviarA(f, e.brian);
    const ahora = new Date();
    expect(await fichaVisibleParaTest(e, f, e.brian, ahora)).toBe(true);
    expect((await accesosDeAgencia(e.db, e.admin, e.orgA)).map((a) => a.referenciaId)).toContain(f);

    const r = await retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgA });
    expect(r).toMatchObject({ ok: true, canceladas: 1, accesosCerrados: 0 });
    expect(await fichaVisibleParaTest(e, f, e.brian, new Date())).toBe(false);
    const filas = await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, f));
    expect(filas[0]).toMatchObject({ estado: 'cancelada' });
    expect(filas[0]!.accesoHasta).not.toBeNull();
    const a = await auditorias('retirar_acceso_agencia', f);
    expect(a).toHaveLength(1);
    expect(a[0]!.detalle).toMatchObject({ organizacionId: e.orgA, canceladas: 1 });
    expect((await accesosDeAgencia(e.db, e.admin, e.orgA)).map((x) => x.referenciaId)).not.toContain(f);
  });

  it('corta tambien el acceso temporal de una asignacion ya terminada', async () => {
    const f = await nuevaFicha(e);
    await enviarA(f, e.brian, 'hecha', new Date(Date.now() + 20 * 86_400_000));
    const lista = await accesosDeAgencia(e.db, e.admin, e.orgA);
    expect(lista.find((x) => x.referenciaId === f)).toMatchObject({ tipo: 'temporal' });
    expect(await fichaVisibleParaTest(e, f, e.brian, new Date())).toBe(true);
    const r = await retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgA });
    expect(r).toMatchObject({ canceladas: 0, accesosCerrados: 1 });
    expect(await fichaVisibleParaTest(e, f, e.brian, new Date(Date.now() + 1000))).toBe(false);
  });

  it('no toca a otra agencia ni a las asignaciones de personas internas', async () => {
    const f = await nuevaFicha(e);
    await enviarA(f, e.brian);
    await enviarA(f, e.brianB);
    await enviarA(f, e.charles);
    await retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgA });
    const estados = await e.db
      .select({ a: asignacion.aUsuarioId, estado: asignacion.estado })
      .from(asignacion)
      .where(eq(asignacion.referenciaId, f));
    const de = (id: string) => estados.find((x) => x.a === id)?.estado;
    expect(de(e.brian.usuarioId)).toBe('cancelada');
    expect(de(e.brianB.usuarioId)).toBe('pendiente');
    expect(de(e.charles.usuarioId)).toBe('pendiente');
    expect(await fichaVisibleParaTest(e, f, e.brianB, new Date())).toBe(true);
  });

  it('avisa cuando no hay nada que retirar y rechaza organizaciones internas o fichas inexistentes', async () => {
    const f = await nuevaFicha(e);
    expect(await codigoDe(retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgA }))).toBe('VALIDACION');
    expect(await codigoDe(retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgInterna }))).toBe('VALIDACION');
    expect(await codigoDe(retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: '00000000-0000-4000-8000-000000000000', organizacionId: e.orgA }))).toBe('NO_ENCONTRADO');
    expect(await auditorias('retirar_acceso_agencia', f)).toHaveLength(0);
  });

  it('regla «una agencia a la vez»: lista las fichas abiertas a mas de una agencia', async () => {
    const f = await nuevaFicha(e);
    await enviarA(f, e.brian);
    expect((await fichasConVariasAgencias(e.db, e.admin)).map((x) => x.referenciaId)).not.toContain(f);
    await enviarA(f, e.brianB);
    const varias = await fichasConVariasAgencias(e.db, e.admin);
    const esta = varias.find((x) => x.referenciaId === f);
    expect(esta?.agencias.sort()).toEqual(['Agencia A', 'Agencia Beta']);
    await retirarAccesoAgencia(e.ctx(e.admin), { referenciaId: f, organizacionId: e.orgB });
    expect((await fichasConVariasAgencias(e.db, e.admin)).map((x) => x.referenciaId)).not.toContain(f);
  });
});
