/**
 * Agencia de aduana en UN solo paso (organizacion + su unica cuenta, rol aduana) y entrega de la clave:
 *  - la clave la ve solo el administrador; si crea la supervisora no se genera ni se devuelve ninguna y la cuenta queda
 *    pendiente de entrega (sin credencial, no entra) hasta que el administrador la restablece;
 *  - el aviso `cuenta_creada` llega a todos los administradores activos (no al actor si es administrador) y lleva a la cuenta;
 *  - los avisos de los demas tipos siguen exigiendo ficha.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { account, auditoria, limiteTasa, notificacion, organizacion, usuario } from '@/db/esquema';
import type { Contexto } from '@/server/politicas/actor';

// La Server Action pide la sesion al servidor y revalida rutas: se le entrega el contexto de la prueba.
const sesion = vi.hoisted(() => ({ ctx: undefined as unknown }));
vi.mock('@/server/sesion', () => ({ contextoDeAccion: async () => sesion.ctx }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));

import { crearAgenciaAccion } from '@/app/acciones/admin';
import { iniciarSesion, type DepsAcceso } from '@/server/acceso';
import { crearAgencia } from '@/server/acciones/organizaciones';
import { ErrorAccion } from '@/server/acciones/resultado';
import { restablecerClave } from '@/server/acciones/usuarios';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { crearNotificacion } from '@/server/notificaciones/crear';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { listarUsuariosAdmin } from '@/server/politicas/administracion';
import { notificacionesDe } from '@/server/politicas/colaboracion';
import { crearSupervisora, nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

let e: Escenario;
let angie: Actor;
let admin2: Actor;
let deps: DepsAcceso;

const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });

beforeAll(async () => {
  e = await nuevoEscenario();
  angie = await crearSupervisora(e);
  const [u] = await e.db
    .insert(usuario)
    .values({ nombre: 'Segundo Admin', email: 'admin2@prueba.invalid', rol: 'admin', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
    .returning({ id: usuario.id });
  admin2 = (await cargarActorPorId(e.db, u!.id))!;
  deps = { db: e.db, auth: crearAuth({ db: e.db, config }), config };
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

const cuentaDe = async (id: string) => (await e.db.select().from(usuario).where(eq(usuario.id, id)))[0]!;
const credencialesDe = (id: string) => e.db.select().from(account).where(and(eq(account.userId, id), eq(account.providerId, 'credential')));
const avisosCuenta = (usuarioId: string) =>
  e.db.select().from(notificacion).where(and(eq(notificacion.usuarioId, usuarioId), eq(notificacion.tipo, 'cuenta_creada')));
const totalOrganizaciones = async () => (await e.db.select().from(organizacion)).length;

describe('crear una agencia en un solo paso (administrador)', () => {
  it('crea la organizacion y su cuenta de rol aduana con el nombre de la empresa, el usuario sugerido y la clave', async () => {
    const r = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Magnum S.A.' });
    expect(r.usuario).toBe('agencia-magnum-s-a.aduana');
    expect(r.claveTemporal).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    const [org] = await e.db.select().from(organizacion).where(eq(organizacion.id, r.organizacionId));
    expect(org).toMatchObject({ nombre: 'Agencia Magnum S.A.', tipo: 'agencia', activa: true });
    const cuenta = await cuentaDe(r.cuentaId);
    expect(cuenta).toMatchObject({
      nombre: 'Agencia Magnum S.A.',
      username: 'agencia-magnum-s-a.aduana',
      rol: 'aduana',
      organizacionId: r.organizacionId,
      organizacionTipo: 'agencia',
      area: null,
      activo: true,
    });
    // Una agencia = una organizacion con UNA cuenta.
    expect(await e.db.select().from(usuario).where(eq(usuario.organizacionId, r.organizacionId))).toHaveLength(1);

    const acciones = (await e.db.select().from(auditoria).where(eq(auditoria.usuarioId, e.admin.usuarioId))).map((a) => a.accion);
    expect(acciones).toEqual(expect.arrayContaining(['crear_organizacion', 'crear_cuenta']));

    // La clave entregada sirve para entrar.
    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: r.usuario, clave: r.claveTemporal!, headers: new Headers() })).ok).toBe(true);
    // El admin que crea no recibe aviso, ni nadie mas.
    expect(await e.db.select().from(notificacion).where(eq(notificacion.tipo, 'cuenta_creada'))).toHaveLength(0);
  });

  it('acepta un usuario propio, normalizado, y rechaza uno invalido', async () => {
    const r = await crearAgencia(e.ctx(e.admin), { nombre: 'Aduanas del Pacífico', usuario: '  Pacifico.Aduana ' });
    expect(r.usuario).toBe('pacifico.aduana');
    expect(await codigoDe(crearAgencia(e.ctx(e.admin), { nombre: 'Otra Agencia', usuario: 'no valido!' }))).toBe('VALIDACION');
  });

  it('es atomica: si la cuenta falla (usuario repetido) no queda la organizacion', async () => {
    const antes = await totalOrganizaciones();
    expect(await codigoDe(crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Repetida', usuario: 'pacifico.aduana' }))).toBe('DUPLICADO');
    expect(await totalOrganizaciones()).toBe(antes);
    expect(await e.db.select().from(organizacion).where(eq(organizacion.nombre, 'Agencia Repetida'))).toHaveLength(0);
    // Un nombre de empresa repetido tampoco deja una cuenta suelta.
    const cuentas = (await e.db.select().from(usuario)).length;
    expect(await codigoDe(crearAgencia(e.ctx(e.admin), { nombre: 'agencia magnum s.a.', usuario: 'otro.usuario' }))).toBe('DUPLICADO');
    expect((await e.db.select().from(usuario)).length).toBe(cuentas);
    expect(await totalOrganizaciones()).toBe(antes);
  });

  it('solo quien supervisa puede crearla', async () => {
    for (const actor of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(crearAgencia(e.ctx(actor), { nombre: 'Intrusa Aduanas' })), actor.rol).toBe('SIN_PERMISO');
    }
  });
});

describe('crearla la supervisora: sin clave, pendiente de entrega y aviso al administrador', () => {
  let r: Awaited<ReturnType<typeof crearAgencia>>;

  beforeAll(async () => {
    r = await crearAgencia(e.ctx(angie), { nombre: 'Agencia de Angie' });
  });

  it('crea la organizacion y la cuenta pero no genera ni devuelve ninguna clave', async () => {
    expect(r.claveTemporal).toBeNull();
    expect(r.usuario).toBe('agencia-de-angie.aduana');
    // Ningun valor de la respuesta tiene la forma de una clave temporal (XXXX-XXXX-XXXX).
    expect(Object.values(r).filter((v) => typeof v === 'string' && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(v))).toEqual([]);
    expect(await cuentaDe(r.cuentaId)).toMatchObject({ rol: 'aduana', organizacionId: r.organizacionId, activo: true });
    // Sin credencial: ni siquiera existe el registro donde viviria el hash.
    expect(await credencialesDe(r.cuentaId)).toHaveLength(0);
    expect(await e.db.select().from(account).where(eq(account.userId, r.cuentaId))).toHaveLength(0);
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'crear_cuenta'), eq(auditoria.entidadId, r.cuentaId)));
    expect(aud?.detalle).toMatchObject({ conClave: false });
    expect(aud?.usuarioId).toBe(angie.usuarioId);
  });

  it('la cuenta se ve como pendiente de entrega en la lista de administracion', async () => {
    const filas = await listarUsuariosAdmin(e.db, angie, { organizacionId: r.organizacionId });
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ id: r.cuentaId, sinClave: true });
  });

  it('avisa a TODOS los administradores activos, con enlace a la cuenta, y no a la supervisora ni a nadie mas', async () => {
    for (const admin of [e.admin, admin2]) {
      const avisos = await avisosCuenta(admin.usuarioId);
      expect(avisos, admin.usuarioId).toHaveLength(1);
      expect(avisos[0]).toMatchObject({ referenciaId: null, asignacionId: null, cuentaId: r.cuentaId, leidaEn: null });
      expect(avisos[0]!.titulo).toBe('Angie Supervisora creó la cuenta agencia-de-angie.aduana de Agencia de Angie: genera y entrega su clave');
      const lista = await notificacionesDe(e.db, admin);
      expect(lista.items[0]).toMatchObject({ tipo: 'cuenta_creada', referenciaId: null, href: `/admin/usuarios/${r.cuentaId}` });
      expect(lista.noLeidas).toBeGreaterThanOrEqual(1);
    }
    for (const otro of [angie, e.edward, e.charles, e.lector, e.brian]) {
      expect(await avisosCuenta(otro.usuarioId), otro.usuarioId).toHaveLength(0);
    }
  });

  it('un administrador inactivo no recibe el aviso', async () => {
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, admin2.usuarioId));
    const r2 = await crearAgencia(e.ctx(angie), { nombre: 'Agencia Con Admin Inactivo' });
    expect((await avisosCuenta(admin2.usuarioId)).filter((a) => a.cuentaId === r2.cuentaId)).toHaveLength(0);
    expect((await avisosCuenta(e.admin.usuarioId)).filter((a) => a.cuentaId === r2.cuentaId)).toHaveLength(1);
    await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, admin2.usuarioId));
  });

  it('no puede ingresar hasta que el administrador la restablece; entonces entra con la clave nueva', async () => {
    await e.db.delete(limiteTasa);
    expect(await iniciarSesion(deps, { usuario: r.usuario, clave: 'cualquier-clave-123', headers: new Headers() })).toEqual({ ok: false, motivo: 'credenciales' });
    // La supervisora no puede entregarla.
    expect(await codigoDe(restablecerClave(e.ctx(angie), { usuarioId: r.cuentaId }))).toBe('SIN_PERMISO');
    expect(await credencialesDe(r.cuentaId)).toHaveLength(0);

    const entrega = await restablecerClave(e.ctx(e.admin), { usuarioId: r.cuentaId });
    expect(await credencialesDe(r.cuentaId)).toHaveLength(1);
    await e.db.delete(limiteTasa);
    expect((await iniciarSesion(deps, { usuario: r.usuario, clave: entrega.claveTemporal, headers: new Headers() })).ok).toBe(true);
    expect((await listarUsuariosAdmin(e.db, e.admin, { organizacionId: r.organizacionId }))[0]?.sinClave).toBe(false);
  });
});

describe('la Server Action de agencia (lo que viaja al navegador)', () => {
  const formulario = (nombre: string) => {
    const d = new FormData();
    d.set('nombre', nombre);
    d.set('usuario', '');
    return d;
  };

  it('con la supervisora no lleva clave: devuelve la cuenta como pendiente', async () => {
    sesion.ctx = e.ctx(angie) satisfies Contexto;
    const r = await crearAgenciaAccion({ estado: 'inicial' }, formulario('Agencia Por Accion'));
    expect(r.estado).toBe('ok');
    expect(r.secreto).toBeUndefined();
    expect(r.pendiente).toMatchObject({ nombre: 'Agencia Por Accion', usuario: 'agencia-por-accion.aduana' });
    expect(JSON.stringify(r)).not.toMatch(/"clave"|[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}"/);
  });

  it('con el administrador lleva la clave para mostrarla una vez', async () => {
    sesion.ctx = e.ctx(e.admin) satisfies Contexto;
    const r = await crearAgenciaAccion({ estado: 'inicial' }, formulario('Agencia Por Accion Admin'));
    expect(r.estado).toBe('ok');
    expect(r.pendiente).toBeUndefined();
    expect(r.secreto).toMatchObject({ usuario: 'agencia-por-accion-admin.aduana', accion: 'creada' });
    expect(r.secreto?.clave).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  it('un usuario repetido vuelve como error del campo usuario', async () => {
    sesion.ctx = e.ctx(e.admin) satisfies Contexto;
    const d = formulario('Otra Empresa Distinta');
    d.set('usuario', 'agencia-por-accion.aduana');
    const r = await crearAgenciaAccion({ estado: 'inicial' }, d);
    expect(r).toMatchObject({ estado: 'error', errores: { usuario: 'Ya existe una cuenta con ese usuario.' } });
  });
});

describe('los avisos de los demas tipos siguen exigiendo ficha', () => {
  it('crearNotificacion rechaza un aviso de ficha sin ficha, y cuenta_creada con ficha o sin cuenta', async () => {
    const ficha = await nuevaFicha(e);
    await expect(
      e.db.transaction((tx) => crearNotificacion(tx, { usuarioId: e.admin.usuarioId, tipo: 'comentario', referenciaId: null, titulo: 'sin ficha' })),
    ).rejects.toThrow();
    await expect(
      e.db.transaction((tx) =>
        crearNotificacion(tx, { usuarioId: e.admin.usuarioId, tipo: 'cuenta_creada', referenciaId: ficha, cuentaId: angie.usuarioId, titulo: 'con ficha' }),
      ),
    ).rejects.toThrow();
    await expect(
      e.db.transaction((tx) => crearNotificacion(tx, { usuarioId: e.admin.usuarioId, tipo: 'cuenta_creada', referenciaId: null, titulo: 'sin cuenta' })),
    ).rejects.toThrow();
  });

  it('la base lo exige aunque se salte la funcion (CHECK de coherencia y de tipos)', async () => {
    const ficha = await nuevaFicha(e);
    const base = { usuarioId: e.admin.usuarioId, titulo: 'prueba' };
    for (const tipo of ['asignacion', 'recordatorio', 'respuesta', 'clasificada', 'reabierta', 'reapertura_solicitada', 'cambio_en_mi_campo', 'comentario']) {
      await expect(e.db.insert(notificacion).values({ ...base, tipo, referenciaId: null }), `${tipo} sin ficha`).rejects.toThrow();
      await expect(e.db.insert(notificacion).values({ ...base, tipo, referenciaId: ficha }), `${tipo} con ficha`).resolves.toBeDefined();
    }
    await expect(e.db.insert(notificacion).values({ ...base, tipo: 'cuenta_creada', referenciaId: ficha, cuentaId: angie.usuarioId })).rejects.toThrow();
    await expect(e.db.insert(notificacion).values({ ...base, tipo: 'cuenta_creada', referenciaId: null, cuentaId: null })).rejects.toThrow();
    await expect(e.db.insert(notificacion).values({ ...base, tipo: 'inventado', referenciaId: ficha })).rejects.toThrow();
    await expect(e.db.insert(notificacion).values({ ...base, tipo: 'cuenta_creada', referenciaId: null, cuentaId: angie.usuarioId })).resolves.toBeDefined();
  });
});
