/**
 * Supervisora general: que puede y que NO puede, por las acciones de servidor y por las paginas de /admin.
 * Puede: lo operativo de las fichas, resumen, catalogos, auditoria (ver y CSV), organizaciones (ver, crear, renombrar) y
 * usuarios en solo lectura. NO puede: parametros, crear cuentas, restablecer claves, cambiar rol u organizacion de una
 * persona, editar usuarios, desactivar o reactivar, cerrar sesiones; y nunca da el rol de administrador o supervisora
 * ni toca una cuenta de administrador. El candado de «ultimo administrador» solo cuenta el rol `admin`.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { account, asignacion, notificacion, organizacion, usuario } from '@/db/esquema';
import type { Contexto } from '@/server/politicas/actor';

// Las paginas piden la sesion al servidor: se les entrega el contexto de la prueba.
const sesion = vi.hoisted(() => ({ ctx: undefined as unknown }));
vi.mock('@/server/sesion', () => ({
  exigirContexto: async () => sesion.ctx,
  exigirActor: async () => (sesion.ctx as Contexto).actor,
  contextoDeAccion: async () => sesion.ctx,
}));

import { SubNavAdmin } from '@/componentes/admin/SubNavAdmin';
import { destinosPara } from '@/componentes/navegacion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { PanelDesactivar } from '@/componentes/admin/ReasignacionUsuario';
import { RestablecerClave } from '@/componentes/admin/RestablecerClave';
import { FormularioAccion } from '@/componentes/admin/acciones';
import { archivar, desarchivar, finalizar, reabrir, solicitarReapertura } from '@/server/acciones/aduana';
import { enviarA } from '@/server/acciones/asignaciones';
import { gestoresActivos } from '@/server/acciones/aduana-comun';
import { activarItemCatalogo, guardarItemCatalogo, guardarPartida, guardarRestriccion, moverItemCatalogo } from '@/server/acciones/catalogos-admin';
import { corregirCodigo } from '@/server/acciones/corregir-codigo';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { cambiarEstadoOrganizacion, crearOrganizacion, editarOrganizacion, retirarAccesoAgencia } from '@/server/acciones/organizaciones';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { cambiarOrganizacion, cambiarRol, crearCuenta, desactivarUsuario, reactivarUsuario, restablecerClave } from '@/server/acciones/usuarios';
import { cerrarSesionesDeUsuario, editarUsuario } from '@/server/acciones/usuarios-admin';
import {
  accesosDeAgencia,
  candidatosReasignacion,
  contarAdminsActivos,
  fichasConVariasAgencias,
  listarOrganizacionesAdmin,
  listarSesionesDeUsuario,
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

describe('la supervisora NO puede: seguridad, cuentas y parametros (acciones de servidor)', () => {
  it('niega lo reservado al administrador y no cambia nada', async () => {
    const objetivo = e.charles.usuarioId;
    const antes = await filaUsuario(objetivo);
    const [credAntes] = await e.db.select().from(account).where(and(eq(account.userId, e.admin.usuarioId), eq(account.providerId, 'credential')));
    const intentos: Array<[string, () => PromiseLike<unknown>]> = [
      ['crear cuenta', () => crearCuenta(ctxAngie, { nombre: 'Nueva', usuario: 'nueva-sup', organizacionId: e.orgInterna, rol: 'lector' })],
      ['restablecer clave', () => restablecerClave(ctxAngie, { usuarioId: objetivo })],
      ['cambiar rol', () => cambiarRol(ctxAngie, { usuarioId: objetivo, rol: 'lector' })],
      ['editar usuario', () => editarUsuario(ctxAngie, { usuarioId: objetivo, nombre: 'Otro nombre', area: 'Consumibles' })],
      ['cambiar organizacion', () => cambiarOrganizacion(ctxAngie, { usuarioId: objetivo, organizacionId: e.orgInterna })],
      ['desactivar', () => desactivarUsuario(ctxAngie, { usuarioId: objetivo })],
      ['reactivar', () => reactivarUsuario(ctxAngie, { usuarioId: objetivo })],
      ['cerrar sesiones', () => cerrarSesionesDeUsuario(ctxAngie, { usuarioId: objetivo })],
      ['desactivar organizacion', () => cambiarEstadoOrganizacion(ctxAngie, { organizacionId: e.orgB, activa: false })],
      ['pendientes de una persona', () => pendientesDeUsuario(e.db, angie, objetivo)],
      ['candidatos de reasignacion', () => candidatosReasignacion(e.db, angie, objetivo)],
      ['sesiones abiertas', () => listarSesionesDeUsuario(e.db, angie, objetivo)],
      ['contar administradores', () => contarAdminsActivos(e.db, angie)],
    ];
    for (const [nombre, p] of intentos) expect(await codigoDe(p()), nombre).toBe('SIN_PERMISO');

    const despues = await filaUsuario(objetivo);
    expect(despues).toMatchObject({ nombre: antes.nombre, rol: antes.rol, activo: antes.activo, organizacionId: antes.organizacionId, area: antes.area });
    const [credDespues] = await e.db.select().from(account).where(and(eq(account.userId, e.admin.usuarioId), eq(account.providerId, 'credential')));
    expect(credDespues?.password).toBe(credAntes?.password);
    expect((await e.db.select().from(usuario).where(eq(usuario.username, 'nueva-sup'))).length).toBe(0);
    expect((await e.db.select().from(organizacion).where(eq(organizacion.id, e.orgB)))[0]!.activa).toBe(true);
  });

  it('no crea ni promueve administradores o supervisoras, ni toca la cuenta del administrador', async () => {
    for (const rol of ['admin', 'supervisor'] as const) {
      expect(await codigoDe(crearCuenta(ctxAngie, { nombre: 'Intrusa', usuario: `intrusa-${rol}`, organizacionId: e.orgInterna, rol })), `crear ${rol}`).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: e.charles.usuarioId, rol })), `promover a ${rol}`).toBe('SIN_PERMISO');
      expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: angie.usuarioId, rol })), `ascenderse a ${rol}`).toBe('SIN_PERMISO');
    }
    expect(await codigoDe(restablecerClave(ctxAngie, { usuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    expect(await codigoDe(desactivarUsuario(ctxAngie, { usuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    expect(await codigoDe(cambiarRol(ctxAngie, { usuarioId: e.admin.usuarioId, rol: 'lector' }))).toBe('SIN_PERMISO');
    expect(await codigoDe(editarUsuario(ctxAngie, { usuarioId: e.admin.usuarioId, nombre: 'Cambiado' }))).toBe('SIN_PERMISO');
    expect((await filaUsuario(e.admin.usuarioId))).toMatchObject({ rol: 'admin', activo: true, nombre: 'Ana Admin' });
    expect((await filaUsuario(angie.usuarioId)).rol).toBe('supervisor');
    expect((await e.db.select().from(usuario).where(eq(usuario.rol, 'supervisor'))).length).toBe(1);
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

  it('la supervisora ve el aviso de permiso en parametros y en crear cuenta', async () => {
    const { default: Parametros } = await import('@/app/(app)/admin/parametros/page');
    const { default: Nueva } = await import('@/app/(app)/admin/usuarios/nueva/page');
    const p = await comoSesion(angie, () => Parametros());
    expect(p).not.toBeNull();
    expect(veSinPermiso(p)).toBe(true);
    const n = await comoSesion(angie, () => Nueva({ searchParams: sp }));
    expect(n).not.toBeNull();
    expect(veSinPermiso(n)).toBe(true);
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

  it('la ficha de una persona es de solo lectura para la supervisora y completa para el administrador', async () => {
    const { default: Persona } = await import('@/app/(app)/admin/usuarios/[id]/page');
    const params = Promise.resolve({ id: e.charles.usuarioId });
    const lectura = await comoSesion(angie, () => Persona({ params }));
    expect(veSinPermiso(lectura)).toBe(false);
    for (const prohibido of [FormularioAccion, RestablecerClave, PanelDesactivar]) expect(buscar(lectura, prohibido)).toBeNull();

    const completa = await comoSesion(e.admin, () => Persona({ params }));
    expect(buscar(completa, FormularioAccion)).not.toBeNull();
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
