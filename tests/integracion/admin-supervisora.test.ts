/**
 * Supervisora general: que puede y que NO puede, por las acciones de servidor y por las paginas de /admin.
 * Es igual al administrador en la administracion (resumen, usuarios, organizaciones, catalogos, auditoria), con DOS excepciones:
 * no tiene Parametros y no administra claves. Puede: crear cuentas (nacen con su clave, que solo ve el administrador, y le avisan), editar, cambiar rol u organizacion, desactivar y reactivar, y todo lo operativo
 * de las fichas. NO puede: restablecer claves, parametros, crear o promover administradores o supervisoras, ni tocar una
 * cuenta de administrador o de supervisora. El candado de «ultimo administrador» solo cuenta el rol `admin`.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { account, asignacion, auditoria, notificacion, organizacion, session, usuario } from '@/db/esquema';
import type { Contexto } from '@/server/politicas/actor';

// Las paginas piden la sesion al servidor: se les entrega el contexto de la prueba.
const sesion = vi.hoisted(() => ({ ctx: undefined as unknown }));
vi.mock('@/server/sesion', () => ({
  exigirContexto: async () => sesion.ctx,
  exigirActor: async () => (sesion.ctx as Contexto).actor,
  contextoDeAccion: async () => sesion.ctx,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { crearCuentaAccion } from '@/app/acciones/admin';
import { FormularioCrearCuenta } from '@/componentes/admin/FormularioCrearCuenta';
import { SubNavAdmin } from '@/componentes/admin/SubNavAdmin';
import { destinosPara } from '@/componentes/navegacion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { PanelCambiarOrganizacion, PanelDesactivar } from '@/componentes/admin/ReasignacionUsuario';
import { RestablecerClave } from '@/componentes/admin/RestablecerClave';
import { FormularioAccion } from '@/componentes/admin/acciones';
import { Aviso } from '@/componentes/ui/aviso';
import { archivar, desarchivar, finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { enviarA } from '@/server/acciones/asignaciones';
import { gestoresActivos } from '@/server/acciones/aduana-comun';
import { activarItemCatalogo, guardarItemCatalogo, guardarPartida, guardarRestriccion, moverItemCatalogo } from '@/server/acciones/catalogos-admin';
import { corregirCodigo } from '@/server/acciones/corregir-codigo';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { cambiarEstadoOrganizacion, crearOrganizacion, editarOrganizacion, retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cambiarOrganizacion, cambiarRol, crearCuenta, desactivarUsuario, reactivarUsuario, restablecerClave, verClaveEntrega } from '@/server/acciones/usuarios';
import { editarUsuario } from '@/server/acciones/usuarios-admin';
import {
  accesosDeAgencia,
  candidatosReasignacion,
  contarAdminsActivos,
  fichasConVariasAgencias,
  listarOrganizacionesAdmin,
  listarUsuariosAdmin,
  obtenerUsuarioAdmin,
  pendientesDeUsuario,
  resumenAdmin,
} from '@/server/politicas/administracion';
import { auditoriaParaCsv, listarAuditoriaAdmin, opcionesFiltroAuditoria } from '@/server/politicas/administracion-auditoria';
import { listarItemsCatalogo, listarPaisesAdmin, listarPartidas, listarRestricciones, opcionesParaPartida } from '@/server/politicas/administracion-catalogos';
import { avisosDe, estadoDe, fichaEnAduana } from './ayudas-aduana';
import { crearSupervisora, nuevaFicha, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import type { Actor } from '@/server/politicas/actor';

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

/** Sesiones abiertas de una persona, leidas directo (la pantalla que las listaba se quito el 2026-11-10). */
async function sesionesAbiertasDe(usuarioId: string) {
  return e.db.select().from(session).where(eq(session.userId, usuarioId));
}

async function codigoDe(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof ErrorAccion ? err.codigo : `otro:${String(err)}`;
  }
  return 'OK';
}

const filaUsuario = async (id: string) => (await e.db.select().from(usuario).where(eq(usuario.id, id)))[0]!;

describe('la supervisora puede: administracion compartida', () => {
  it('lee el resumen, las listas de personas y de organizaciones, y los accesos de las agencias', async () => {
    expect(await codigoDe(resumenAdmin(e.db, angie))).toBe('OK');
    expect(await codigoDe(listarUsuariosAdmin(e.db, angie))).toBe('OK');
    expect(await codigoDe(obtenerUsuarioAdmin(e.db, angie, e.edward.usuarioId))).toBe('OK');
    expect(await codigoDe(listarOrganizacionesAdmin(e.db, angie))).toBe('OK');
    expect(await codigoDe(accesosDeAgencia(e.db, angie, e.orgA))).toBe('OK');
    expect(await codigoDe(fichasConVariasAgencias(e.db, angie))).toBe('OK');
  });

  it('gestiona catalogos: agrega, desactiva, reordena, restricciones y partidas', async () => {
    const r = await guardarItemCatalogo(ctxAngie, { catalogo: 'unidad_medida', valor: 'Rollos de prueba' });
    expect(r.creado).toBe(true);
    expect(await codigoDe(activarItemCatalogo(ctxAngie, { id: r.id, activo: false }))).toBe('OK');
    expect(await codigoDe(moverItemCatalogo(ctxAngie, { id: r.id, direccion: 'arriba' }))).toBe('OK');
    expect(await codigoDe(guardarRestriccion(ctxAngie, { codigo: 'RES-SUP', texto: 'Texto normativo de prueba' }))).toBe('OK');
    expect(await codigoDe(guardarPartida(ctxAngie, { modo: 'crear', codigo: '1111.11.11.11' }))).toBe('OK');
    expect(await codigoDe(listarItemsCatalogo(e.db, angie, 'unidad_medida'))).toBe('OK');
    expect(await codigoDe(listarPaisesAdmin(e.db, angie))).toBe('OK');
    expect(await codigoDe(listarRestricciones(e.db, angie))).toBe('OK');
    expect(await codigoDe(listarPartidas(e.db, angie))).toBe('OK');
    expect(await codigoDe(opcionesParaPartida(e.db, angie))).toBe('OK');
  });

  it('ve toda la auditoria y arma el CSV', async () => {
    expect(await codigoDe(listarAuditoriaAdmin(e.db, angie))).toBe('OK');
    expect(await codigoDe(auditoriaParaCsv(e.db, angie))).toBe('OK');
    expect(await codigoDe(opcionesFiltroAuditoria(e.db, angie))).toBe('OK');
  });

  it('crea y renombra organizaciones y retira el acceso de una agencia a una referencia', async () => {
    const { id } = await crearOrganizacion(ctxAngie, { nombre: 'Agencia de la supervisora', tipo: 'agencia' });
    expect(await codigoDe(editarOrganizacion(ctxAngie, { organizacionId: id, nombre: 'Agencia Supervisada' }))).toBe('OK');
    const ficha = await nuevaFicha(e);
    await e.db.insert(asignacion).values({ referenciaId: ficha, deUsuarioId: e.edward.usuarioId, aUsuarioId: e.brian.usuarioId, pedido: 'clasificar', estado: 'pendiente' });
    const r = await retirarAccesoAgencia(ctxAngie, { referenciaId: ficha, organizacionId: e.orgA });
    expect(r).toMatchObject({ ok: true, canceladas: 1 });
  });
});

const FORMATO_CLAVE = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;

async function abrirSesion(userId: string): Promise<string> {
  const [s] = await e.db
    .insert(session)
    .values({ userId, token: `t-${Math.random().toString(36).slice(2)}-${Date.now()}`, expiresAt: new Date(Date.now() + 3_600_000), userAgent: 'Mozilla/5.0 Chrome/120', ipAddress: '10.0.0.7' })
    .returning({ id: session.id });
  return (s as { id: string }).id;
}

const avisosDeCuenta = (cuentaId: string) =>
  e.db.select().from(notificacion).where(and(eq(notificacion.tipo, 'cuenta_creada'), eq(notificacion.cuentaId, cuentaId)));

describe('la supervisora puede: gestionar personas como el administrador (menos las claves)', () => {
  it('crea una cuenta con su clave (que ella no ve): el administrador la ve, y cada administrador activo recibe el aviso', async () => {
    const r = await crearCuenta(ctxAngie, { nombre: 'Cuenta de Angie', usuario: 'cuenta.angie', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' });
    expect(r).toMatchObject({ usuario: 'cuenta.angie', rol: 'solicitante', claveTemporal: null });
    // Ningun valor de la respuesta tiene la forma de una clave.
    expect(Object.values(r).filter((v) => typeof v === 'string' && FORMATO_CLAVE.test(v))).toEqual([]);
    expect(await e.db.select().from(account).where(eq(account.userId, r.id))).toHaveLength(1);
    expect(await filaUsuario(r.id)).toMatchObject({ creadoPor: angie.usuarioId, activo: true, rol: 'solicitante', area: 'Consumibles' });
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'crear_cuenta'), eq(auditoria.entidadId, r.id)));
    expect(aud).toMatchObject({ usuarioId: angie.usuarioId });
    expect(aud?.detalle).toMatchObject({ conClave: true });

    const avisos = await avisosDeCuenta(r.id);
    expect(avisos.map((a) => a.usuarioId)).toEqual([e.admin.usuarioId]);
    expect(avisos[0]!.titulo).toContain('revisa su clave y entrégala');
    expect((await listarUsuariosAdmin(e.db, angie, { q: 'cuenta.angie' }))[0]).toMatchObject({ id: r.id, sinClave: false });

    // Solo el administrador la ve; al verla el aviso queda atendido.
    expect(await codigoDe(verClaveEntrega(ctxAngie, { usuarioId: r.id }))).toBe('SIN_PERMISO');
    const vista = await verClaveEntrega(e.ctx(e.admin), { usuarioId: r.id });
    expect(vista.clave).toMatch(FORMATO_CLAVE);
    expect((await avisosDeCuenta(r.id)).every((a) => a.leidaEn !== null)).toBe(true);
  });

  it('crea cuentas con los roles lector y aduana (en una agencia); la regla rol x organizacion sigue vigente', async () => {
    const lector = await crearCuenta(ctxAngie, { nombre: 'Lectora Nueva', usuario: 'lectora.nueva', organizacionId: e.orgInterna, rol: 'lector' });
    const aduana = await crearCuenta(ctxAngie, { nombre: 'Aduana Nueva', usuario: 'aduana.nueva', organizacionId: e.orgA, rol: 'aduana' });
    expect(lector).toMatchObject({ rol: 'lector', claveTemporal: null });
    expect(aduana).toMatchObject({ rol: 'aduana', organizacionTipo: 'agencia', claveTemporal: null });
    expect(await codigoDe(crearCuenta(ctxAngie, { nombre: 'Mal puesta', usuario: 'mal.puesta.sup', organizacionId: e.orgA, rol: 'solicitante' }))).toBe('VALIDACION');
  });

  it('la Server Action no lleva clave al navegador: devuelve la cuenta como pendiente (con el administrador si la lleva)', async () => {
    const datos = (usuario: string) => {
      const d = new FormData();
      d.set('nombre', 'Por Accion');
      d.set('usuario', usuario);
      d.set('organizacionId', e.orgInterna);
      d.set('rol', 'lector');
      return d;
    };
    sesion.ctx = ctxAngie;
    const r = await crearCuentaAccion({ estado: 'inicial' }, datos('por.accion.sup'));
    expect(r.estado).toBe('ok');
    expect(r.secreto).toBeUndefined();
    expect(r.pendiente).toMatchObject({ nombre: 'Por Accion', usuario: 'por.accion.sup' });
    expect(JSON.stringify(r)).not.toMatch(/"clave"|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}"/);

    sesion.ctx = e.ctx(e.admin);
    const a = await crearCuentaAccion({ estado: 'inicial' }, datos('por.accion.admin'));
    expect(a.pendiente).toBeUndefined();
    expect(a.secreto).toMatchObject({ usuario: 'por.accion.admin', accion: 'creada' });
    expect(a.secreto?.clave).toMatch(FORMATO_CLAVE);
  });

  it('edita datos, cambia el rol entre solicitante, aduana y lector, y cambia de organizacion', async () => {
    const { id } = await crearCuenta(ctxAngie, { nombre: 'Maleable', usuario: 'maleable', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' });
    await editarUsuario(ctxAngie, { usuarioId: id, nombre: 'Maleable Editada', area: 'Instrumentos' });
    expect(await filaUsuario(id)).toMatchObject({ nombre: 'Maleable Editada', area: 'Instrumentos' });
    for (const rol of ['lector', 'aduana', 'solicitante'] as const) {
      await cambiarRol(ctxAngie, { usuarioId: id, rol });
      expect((await filaUsuario(id)).rol, rol).toBe(rol);
    }
    await cambiarRol(ctxAngie, { usuarioId: id, rol: 'aduana' });
    await cambiarOrganizacion(ctxAngie, { usuarioId: id, organizacionId: e.orgA });
    expect(await filaUsuario(id)).toMatchObject({ rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'agencia', area: null });
    // Todo queda en la auditoria con ella como autora.
    for (const accion of ['editar_usuario', 'cambiar_rol', 'cambiar_organizacion'] as const) {
      const filas = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, accion), eq(auditoria.entidadId, id)));
      expect(filas.length, accion).toBeGreaterThanOrEqual(1);
      expect(filas.every((f) => f.usuarioId === angie.usuarioId), accion).toBe(true);
    }
  });

  it('ve pendientes y candidatos, desactiva (cierra sus sesiones) y reactiva', async () => {
    const { id } = await crearCuenta(ctxAngie, { nombre: 'Con Sesiones', usuario: 'con.sesiones', organizacionId: e.orgInterna, rol: 'lector' });
    expect(await pendientesDeUsuario(e.db, angie, id)).toEqual([]);
    expect((await candidatosReasignacion(e.db, angie, id)).length).toBeGreaterThan(0);
    expect(await contarAdminsActivos(e.db, angie)).toBeGreaterThanOrEqual(1);

    await abrirSesion(id);
    expect(await desactivarUsuario(ctxAngie, { usuarioId: id })).toMatchObject({ sesionesCerradas: 1, reasignadas: 0 });
    expect((await filaUsuario(id)).activo).toBe(false);
    await reactivarUsuario(ctxAngie, { usuarioId: id });
    expect((await filaUsuario(id)).activo).toBe(true);
  });

  it('desactiva y reactiva una organizacion (sin personas activas)', async () => {
    const { id } = await crearOrganizacion(ctxAngie, { nombre: 'Area Efimera', tipo: 'interna' });
    await cambiarEstadoOrganizacion(ctxAngie, { organizacionId: id, activa: false });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, id)))[0]!.activa).toBe(false);
    await cambiarEstadoOrganizacion(ctxAngie, { organizacionId: id, activa: true });
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, id)))[0]!.activa).toBe(true);
  });
});

describe('la supervisora NO puede: claves, parametros, ni crear o tocar administradores y supervisoras (acciones de servidor)', () => {
  it('no restablece ninguna clave, ni la de una cuenta comun: no cambia ni la credencial ni las sesiones', async () => {
    const objetivo = e.charles.usuarioId;
    await abrirSesion(objetivo);
    const [credAntes] = await e.db.select().from(account).where(and(eq(account.userId, objetivo), eq(account.providerId, 'credential')));
    expect(await codigoDe(restablecerClave(ctxAngie, { usuarioId: objetivo }))).toBe('SIN_PERMISO');
    const [credDespues] = await e.db.select().from(account).where(and(eq(account.userId, objetivo), eq(account.providerId, 'credential')));
    expect(credDespues?.password).toBe(credAntes?.password);
    expect((await sesionesAbiertasDe(objetivo)).length).toBeGreaterThanOrEqual(1);
    expect(await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'restablecer_clave'), eq(auditoria.usuarioId, angie.usuarioId)))).toHaveLength(0);
  });

  it('no crea ni promueve administradores o supervisoras', async () => {
    const antes = (await e.db.select().from(usuario).where(eq(usuario.rol, 'supervisor'))).length;
    for (const rol of ['admin', 'supervisor'] as const) {
      expect(await codigoDe(crearCuenta(ctxAngie, { nombre: 'Intrusa', usuario: `intrusa-${rol}`, organizacionId: e.orgInterna, rol })), `crear ${rol}`).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol })), `promover a ${rol}`).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: angie.usuarioId, rol })), `ascenderse a ${rol}`).toBe('SIN_PERMISO');
    }
    expect((await filaUsuario(e.charles.usuarioId)).rol).toBe('solicitante');
    expect((await e.db.select().from(usuario).where(eq(usuario.username, 'intrusa-admin'))).length).toBe(0);
    expect((await e.db.select().from(usuario).where(eq(usuario.rol, 'supervisor'))).length).toBe(antes);
  });

  it('no toca la cuenta del administrador ni la de otra supervisora (ni la suya): nada cambia', async () => {
    const otra = await crearSupervisora(e, 'Otra Supervisora', 'otra.sup@prueba.invalid');
    await abrirSesion(e.admin.usuarioId);
    await abrirSesion(otra.usuarioId);
    for (const objetivo of [e.admin, otra, angie]) {
      const antes = await filaUsuario(objetivo.usuarioId);
      const [credAntes] = await e.db.select().from(account).where(and(eq(account.userId, objetivo.usuarioId), eq(account.providerId, 'credential')));
      const intentos: Array<[string, () => PromiseLike<unknown>]> = [
        ['editar', () => editarUsuario(ctxAngie, { usuarioId: objetivo.usuarioId, nombre: 'Cambiado' })],
        ['cambiar rol', () => cambiarRol(ctxAngie, { usuarioId: objetivo.usuarioId, rol: 'lector' })],
        ['cambiar organizacion', () => cambiarOrganizacion(ctxAngie, { usuarioId: objetivo.usuarioId, organizacionId: e.orgInterna })],
        ['desactivar', () => desactivarUsuario(ctxAngie, { usuarioId: objetivo.usuarioId })],
        ['reactivar', () => reactivarUsuario(ctxAngie, { usuarioId: objetivo.usuarioId })],
        ['restablecer clave', () => restablecerClave(ctxAngie, { usuarioId: objetivo.usuarioId })],
      ];
      for (const [nombre, p] of intentos) expect(await codigoDe(p()), `${objetivo.rol}: ${nombre}`).toBe('SIN_PERMISO');
      const despues = await filaUsuario(objetivo.usuarioId);
      expect(despues).toMatchObject({ nombre: antes.nombre, rol: antes.rol, activo: true, organizacionId: antes.organizacionId, area: antes.area });
      const [credDespues] = await e.db.select().from(account).where(and(eq(account.userId, objetivo.usuarioId), eq(account.providerId, 'credential')));
      expect(credDespues?.password).toBe(credAntes?.password);
    }
    // Las sesiones del administrador y de la otra supervisora siguen abiertas.
    expect((await sesionesAbiertasDe(e.admin.usuarioId)).length).toBeGreaterThanOrEqual(1);
    expect((await sesionesAbiertasDe(otra.usuarioId)).length).toBeGreaterThanOrEqual(1);
    expect(await filaUsuario(e.admin.usuarioId)).toMatchObject({ rol: 'admin', activo: true, nombre: 'Ana Admin' });
  });

  it('no deja la plataforma sin administrador: no desactiva ni degrada al unico administrador activo', async () => {
    expect(await contarAdminsActivos(e.db, angie)).toBe(1);
    expect(await codigoDe(desactivarUsuario(ctxAngie, { usuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: e.admin.usuarioId, rol: 'solicitante' }))).toBe('SIN_PERMISO');
    expect(await filaUsuario(e.admin.usuarioId)).toMatchObject({ rol: 'admin', activo: true });
  });

  it('solicitante, aduana y lector siguen sin ninguna de estas acciones ni lecturas', async () => {
    for (const actor of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(crearCuenta(e.ctx(actor), { nombre: 'X', usuario: 'xx-sup', organizacionId: e.orgInterna, rol: 'lector' })), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarEstadoOrganizacion(e.ctx(actor), { organizacionId: e.orgB, activa: false })), actor.rol).toBe('SIN_PERMISO');
    }
  });
});

describe('el administrador sigue pudiendo, y el candado de ultimo administrador solo cuenta `admin`', () => {
  it('crea una supervisora y no se desactiva ni se degrada al unico administrador aunque haya supervisoras activas', async () => {
    const nueva = await crearCuenta(e.ctx(e.admin), { nombre: 'Segunda Supervisora', usuario: 'segunda.supervisora', organizacionId: e.orgInterna, rol: 'supervisor' });
    expect(nueva.rol).toBe('supervisor');
    expect(await contarAdminsActivos(e.db, e.admin)).toBe(1);

    expect(await codigoDe(desactivarUsuario(e.ctx(e.admin), { usuarioId: e.admin.usuarioId }))).toBe('VALIDACION');
    expect(await codigoDe(cambiarRol(e.ctx(e.admin), { usuarioId: e.admin.usuarioId, rol: 'supervisor' }))).toBe('VALIDACION');
    expect(await filaUsuario(e.admin.usuarioId)).toMatchObject({ rol: 'admin', activo: true });
  });

  it('una supervisora no puede ir a una agencia (solo aduana)', async () => {
    expect(await codigoDe(crearCuenta(e.ctx(e.admin), { nombre: 'Mal puesta', usuario: 'mal.puesta', organizacionId: e.orgA, rol: 'supervisor' }))).toBe('VALIDACION');
  });
});

describe('la supervisora hereda lo operativo del administrador', () => {
  it('crea y llena una referencia en ambos grupos de campos y corrige su codigo', async () => {
    const id = await nuevaFicha(e, { actor: angie });
    expect(await codigoDe(guardarCampo(ctxAngie, { referenciaId: id, campo: 'uso', valor: 'Limpieza de lentes', versionEsperada: await versionDe(e.db, id, 'uso') }))).toBe('OK');
    expect(await codigoDe(guardarCampo(ctxAngie, { referenciaId: id, campo: 'observaciones_aduana', valor: 'Revisado', versionEsperada: await versionDe(e.db, id, 'observaciones_aduana') }))).toBe('OK');
    expect(await codigoDe(corregirCodigo(ctxAngie, { referenciaId: id, codigoNuevo: 'SUP-NUEVO-1', motivo: 'Estaba mal escrito.' }))).toBe('OK');
  });

  it('puede recibir asignaciones con los cuatro pedidos', async () => {
    const id = await nuevaFicha(e);
    for (const pedido of ['completar', 'clasificar', 'responder', 'revisar'] as const) {
      const r = await enviarA(e.ctx(e.edward), { referenciaId: id, destinatarios: [{ usuarioId: angie.usuarioId, pedido }], mensaje: `Para ti: ${pedido}` });
      expect(r.creadas + r.actualizadas, pedido).toBe(1);
    }
    expect((await e.db.select().from(asignacion).where(and(eq(asignacion.referenciaId, id), eq(asignacion.aUsuarioId, angie.usuarioId)))).length).toBeGreaterThanOrEqual(1);
  });

  it('cierra, reabre, archiva y desarchiva; recibe las solicitudes de reapertura', async () => {
    const id = await fichaEnAduana(e, { llena: true, codigo: 'SUP-CIERRE-1' });
    await fijarPartida(e.ctx(e.brian), { referenciaId: id, partida: '8421.39.90.00', versionEsperada: await versionDe(e.db, id, 'partida_arancelaria') });
    await finalizar(ctxAngie, { referenciaId: id, motivoCerrarDeTodosModos: 'cierre de la supervisora' });
    expect((await estadoDe(e, id)).estado).toBe('CLASIFICADA');

    await solicitarReapertura(e.ctx(e.edward), { referenciaId: id, motivo: 'Cambio el proveedor.' });
    expect(await avisosDe(e, angie.usuarioId, 'reapertura_solicitada', id)).toHaveLength(1);
    expect(await avisosDe(e, e.admin.usuarioId, 'reapertura_solicitada', id)).toHaveLength(1);
    expect((await gestoresActivos(e.db)).map((g) => g.id)).toEqual(expect.arrayContaining([e.admin.usuarioId, angie.usuarioId]));
    expect((await gestoresActivos(e.db, angie.usuarioId)).map((g) => g.id)).not.toContain(angie.usuarioId);

    await reabrir(ctxAngie, { referenciaId: id, motivo: 'Atendiendo la solicitud.' });
    expect((await estadoDe(e, id)).estado).toBe('EN_GESTION');
    await archivar(ctxAngie, { referenciaId: id, motivo: 'Duplicada por error.' });
    expect((await estadoDe(e, id)).archivadaEn).not.toBeNull();
    await desarchivar(ctxAngie, { referenciaId: id, motivo: 'Se archivó por error.' });
    expect((await estadoDe(e, id)).archivadaEn).toBeNull();
    const [sinLeer] = await e.db.select().from(notificacion).where(eq(notificacion.usuarioId, angie.usuarioId)).limit(1);
    expect(sinLeer).toBeDefined();
  });
});

// ---- Paginas ----------------------------------------------------------------------------------------------------

type Elemento = { type?: unknown; props?: { children?: unknown; [clave: string]: unknown } };

function buscar(nodo: unknown, tipo: unknown): Elemento | null {
  if (Array.isArray(nodo)) {
    for (const n of nodo) {
      const r = buscar(n, tipo);
      if (r) return r;
    }
    return null;
  }
  if (!nodo || typeof nodo !== 'object') return null;
  const el = nodo as Elemento;
  if (el.type === tipo) return el;
  return buscar(el.props?.children, tipo);
}

const veSinPermiso = (pagina: unknown) => buscar(pagina, SinPermiso) !== null || (pagina as Elemento | null)?.type === SinPermiso;

async function comoSesion<T>(actor: Actor, correr: () => Promise<T>): Promise<T> {
  sesion.ctx = e.ctx(actor);
  return correr();
}

describe('las paginas de /admin respetan los dos niveles (nunca en blanco)', () => {
  const sp = Promise.resolve({});

  it('la supervisora ve el aviso de permiso en parametros; el administrador los ve', async () => {
    const { default: Parametros } = await import('@/app/(app)/admin/parametros/page');
    const p = await comoSesion(angie, () => Parametros());
    expect(p).not.toBeNull();
    expect(veSinPermiso(p)).toBe(true);
    expect(veSinPermiso(await comoSesion(e.admin, () => Parametros()))).toBe(false);
  });

  it('crear cuenta: la supervisora y el administrador ven el formulario; solicitante, aduana y lector el aviso', async () => {
    const { default: Nueva } = await import('@/app/(app)/admin/usuarios/nueva/page');
    for (const actor of [angie, e.admin]) {
      const n = await comoSesion(actor, () => Nueva({ searchParams: sp }));
      expect(veSinPermiso(n), actor.rol).toBe(false);
      expect((buscar(n, FormularioCrearCuenta)?.props as { actorRol?: string }).actorRol).toBe(actor.rol);
    }
    for (const actor of [e.edward, e.brian, e.lector]) expect(veSinPermiso(await comoSesion(actor, () => Nueva({ searchParams: sp }))), actor.rol).toBe(true);
  });

  it('el administrador ve crear cuenta; solicitante, aduana y lector ven el aviso en todas las paginas', async () => {
    const { default: Nueva } = await import('@/app/(app)/admin/usuarios/nueva/page');
    expect(veSinPermiso(await comoSesion(e.admin, () => Nueva({ searchParams: sp })))).toBe(false);

    const { default: Resumen } = await import('@/app/(app)/admin/page');
    const { default: Usuarios } = await import('@/app/(app)/admin/usuarios/page');
    const { default: Organizaciones } = await import('@/app/(app)/admin/organizaciones/page');
    const { default: Catalogos } = await import('@/app/(app)/admin/catalogos/page');
    const { default: Auditoria } = await import('@/app/(app)/admin/auditoria/page');
    for (const actor of [e.edward, e.brian, e.lector]) {
      for (const [nombre, pagina] of [
        ['resumen', () => Resumen()],
        ['usuarios', () => Usuarios({ searchParams: sp })],
        ['organizaciones', () => Organizaciones()],
        ['catalogos', () => Catalogos({ searchParams: sp })],
        ['auditoria', () => Auditoria({ searchParams: sp })],
      ] as const) {
        const r = await comoSesion(actor, pagina);
        expect(veSinPermiso(r), `${actor.rol}: ${nombre}`).toBe(true);
      }
    }
  });

  it('la supervisora entra a resumen, usuarios, organizaciones, catalogos y auditoria', async () => {
    const { default: Resumen } = await import('@/app/(app)/admin/page');
    const { default: Usuarios } = await import('@/app/(app)/admin/usuarios/page');
    const { default: Organizaciones } = await import('@/app/(app)/admin/organizaciones/page');
    const { default: Catalogos } = await import('@/app/(app)/admin/catalogos/page');
    const { default: Auditoria } = await import('@/app/(app)/admin/auditoria/page');
    const { default: Organizacion } = await import('@/app/(app)/admin/organizaciones/[id]/page');
    for (const [nombre, pagina] of [
      ['resumen', () => Resumen()],
      ['usuarios', () => Usuarios({ searchParams: sp })],
      ['organizaciones', () => Organizaciones()],
      ['una organizacion', () => Organizacion({ params: Promise.resolve({ id: e.orgA }) })],
      ['catalogos', () => Catalogos({ searchParams: sp })],
      ['auditoria', () => Auditoria({ searchParams: sp })],
    ] as const) {
      const r = await comoSesion(angie, pagina);
      expect(r, nombre).not.toBeNull();
      expect(veSinPermiso(r), nombre).toBe(false);
    }
  });

  it('la ficha de una persona trae todos los controles para la supervisora salvo Restablecer contraseña', async () => {
    const { default: Persona } = await import('@/app/(app)/admin/usuarios/[id]/page');
    const params = Promise.resolve({ id: e.charles.usuarioId });
    const suya = await comoSesion(angie, () => Persona({ params }));
    expect(veSinPermiso(suya)).toBe(false);
    for (const presente of [FormularioAccion, PanelDesactivar, PanelCambiarOrganizacion]) expect(buscar(suya, presente)).not.toBeNull();
    expect(buscar(suya, RestablecerClave)).toBeNull();

    const completa = await comoSesion(e.admin, () => Persona({ params }));
    for (const presente of [FormularioAccion, PanelDesactivar, PanelCambiarOrganizacion, RestablecerClave]) expect(buscar(completa, presente)).not.toBeNull();
  });

  it('la ficha de una cuenta de administrador o de supervisora es de solo lectura para la supervisora; el administrador la gestiona', async () => {
    const { default: Persona } = await import('@/app/(app)/admin/usuarios/[id]/page');
    const otra = await crearSupervisora(e, 'Supervisora de Lectura', 'lectura.sup@prueba.invalid');
    for (const objetivo of [e.admin, otra, angie]) {
      const lectura = await comoSesion(angie, () => Persona({ params: Promise.resolve({ id: objetivo.usuarioId }) }));
      expect(veSinPermiso(lectura), objetivo.rol).toBe(false);
      expect(buscar(lectura, Aviso), objetivo.rol).not.toBeNull();
      for (const prohibido of [FormularioAccion, RestablecerClave, PanelDesactivar, PanelCambiarOrganizacion]) expect(buscar(lectura, prohibido), objetivo.rol).toBeNull();
    }
    const completa = await comoSesion(e.admin, () => Persona({ params: Promise.resolve({ id: otra.usuarioId }) }));
    expect(buscar(completa, FormularioAccion)).not.toBeNull();
    expect(buscar(completa, RestablecerClave)).not.toBeNull();
  });

  it('el layout muestra a la supervisora la barra sin «Parametros» y al administrador con ella; los demas ven el aviso', async () => {
    const { default: Layout } = await import('@/app/(app)/admin/layout');
    const hijos = 'contenido';
    const barra = async (actor: Actor) => buscar(await comoSesion(actor, () => Layout({ children: hijos })), SubNavAdmin);
    expect(((await barra(angie))?.props as { administrador?: boolean }).administrador).toBe(false);
    expect(((await barra(e.admin))?.props as { administrador?: boolean }).administrador).toBe(true);
    for (const actor of [e.edward, e.brian, e.lector]) {
      const r = await comoSesion(actor, () => Layout({ children: hijos }));
      expect(veSinPermiso(r), actor.rol).toBe(true);
      expect(buscar(r, SubNavAdmin), actor.rol).toBeNull();
    }
  });

  it('el menu lateral ofrece a la supervisora Administracion sin Parametros', () => {
    const hijos = (rol: Actor['rol']) => destinosPara(rol).find((d) => d.href === '/admin')?.hijos?.map((h) => h.href) ?? null;
    expect(hijos('supervisor')).toEqual(['/admin/usuarios', '/admin/organizaciones', '/admin/catalogos', '/admin/auditoria']);
    expect(hijos('admin')).toContain('/admin/parametros');
    expect(hijos('solicitante')).toBeNull();
  });
});

describe('la descarga de auditoria (CSV)', () => {
  it('la supervisora la descarga; solicitante, aduana y lector reciben 403', async () => {
    const { GET } = await import('@/app/api/admin/auditoria/exportar/route');
    const pedir = async (actor: Actor) => {
      sesion.ctx = e.ctx(actor);
      return GET(new Request('http://localhost/api/admin/auditoria/exportar'));
    };
    const ok = await pedir(angie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/csv');
    for (const actor of [e.edward, e.brian, e.lector]) expect((await pedir(actor)).status, actor.rol).toBe(403);
  });
});
