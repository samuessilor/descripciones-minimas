/**
 * Eliminar (reunion 2026-11-10), con PGlite:
 *  - una REFERENCIA, cerrada o pendiente, con todo lo suyo; el codigo queda libre; solo administrador y supervisora;
 *  - una CUENTA que no dejo trabajo propio (y su agencia, si era la unica); con trabajo se rechaza y se desactiva;
 *  - una AGENCIA con sus cuentas;
 *  - el historial, los comentarios y la auditoria siguen siendo de solo escritura para todo lo demas.
 * Y la clave de entrega cifrada: el administrador la ve, la supervisora no, y deja de verse cuando la persona la cambia.
 */
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  account,
  asignacion,
  auditoria,
  campoHistorial,
  claveEntrega,
  comentario,
  notificacion,
  organizacion,
  referencia,
  session,
  usuario,
} from '@/db/esquema';
import { enviarA } from '@/server/acciones/asignaciones';
import { cambiarMiClave } from '@/server/acciones/cuenta';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { eliminarReferencia } from '@/server/acciones/eliminar-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { crearAgencia, eliminarOrganizacion } from '@/server/acciones/organizaciones';
import { ErrorAccion } from '@/server/acciones/resultado';
import { crearCuenta, diagnosticoBorradoCuenta, eliminarCuenta, restablecerClave, verClaveEntrega } from '@/server/acciones/usuarios';
import { auditar } from '@/server/auditoria';
import { cifrarClave, descifrarClave } from '@/server/clave-entrega';
import { listarUsuariosAdmin, obtenerUsuarioAdmin } from '@/server/politicas/administracion';
import { cargarActorPorId } from '@/server/politicas/actor';
import { crearSupervisora, nuevaFicha, nuevoEscenario, rechazaCon, type Escenario } from './ayudas';
import { escribir, fichaEnAduana } from './ayudas-aduana';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
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

const cuentaDe = async (id: string) => (await e.db.select().from(usuario).where(eq(usuario.id, id)))[0];
const hay = async (tabla: typeof referencia | typeof usuario | typeof organizacion, id: string) =>
  (await e.db.select().from(tabla).where(eq(tabla.id, id))).length === 1;

describe('eliminar una referencia', () => {
  it('borra una referencia pendiente con TODO lo suyo y deja libre el codigo; queda una fila de auditoria que conserva quien era', async () => {
    const id = await fichaEnAduana(e, { llena: true, codigo: 'ELIM-0001', nombre: 'Para borrar' });
    await e.db.insert(comentario).values({ referenciaId: id, autorId: e.edward.usuarioId, texto: 'Una nota', visibilidad: 'todos' });
    await enviarA(e.ctx(e.admin), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId }] });
    expect((await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, id))).length).toBeGreaterThan(5);
    expect((await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, id))).length).toBeGreaterThan(0);
    expect((await e.db.select().from(notificacion).where(eq(notificacion.referenciaId, id))).length).toBeGreaterThan(0);

    const r = await eliminarReferencia(e.ctx(e.admin), { referenciaId: id });
    expect(r).toMatchObject({ ok: true, codigo: 'ELIM-0001', nombreProducto: 'Para borrar' });
    expect(r.historial).toBeGreaterThan(5);

    expect(await e.db.select().from(referencia).where(eq(referencia.id, id))).toHaveLength(0);
    for (const t of [campoHistorial, comentario, asignacion, notificacion]) {
      expect(await e.db.select().from(t).where(eq(t.referenciaId, id)), t.referenciaId.name).toHaveLength(0);
    }
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'eliminar_referencia'), eq(auditoria.entidadId, id)));
    expect(aud).toMatchObject({ usuarioId: e.admin.usuarioId });
    expect(aud?.detalle).toMatchObject({ codigo: 'ELIM-0001', nombreProducto: 'Para borrar', estado: 'EN_GESTION', comentarios: 1 });
    // El codigo se puede volver a usar.
    await crearReferencia(e.ctx(e.edward), { codigo: 'elim-0001', nombreProducto: 'De nuevo', tipoProducto: 'INSUMO' });
  });

  it('borra tambien una referencia CERRADA (clasificada); lo hace la supervisora igual que el administrador', async () => {
    const angie = await crearSupervisora(e);
    const id = await fichaEnAduana(e, { llena: true, codigo: 'ELIM-0002' });
    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: new Date(), clasificadaPor: e.brian.usuarioId }).where(eq(referencia.id, id));
    expect(await eliminarReferencia(e.ctx(angie), { referenciaId: id })).toMatchObject({ ok: true, codigo: 'ELIM-0002' });
    expect(await e.db.select().from(referencia).where(eq(referencia.id, id))).toHaveLength(0);
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'eliminar_referencia'), eq(auditoria.entidadId, id)));
    expect(aud).toMatchObject({ usuarioId: angie.usuarioId });
    expect(aud?.detalle).toMatchObject({ estado: 'CLASIFICADA' });
  });

  it('solicitante, aduana y lector no pueden; una referencia que no existe da no encontrada; no se toca nada ajeno', async () => {
    const id = await nuevaFicha(e);
    const otra = await nuevaFicha(e);
    for (const actor of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(eliminarReferencia(e.ctx(actor), { referenciaId: id })), actor.rol).toBe('SIN_PERMISO');
    }
    expect(await hay(referencia, id)).toBe(true);
    expect(await codigoDe(eliminarReferencia(e.ctx(e.admin), { referenciaId: '00000000-0000-4000-8000-000000000000' }))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(eliminarReferencia(e.ctx(e.admin), { referenciaId: 'no-es-uuid' }))).toBe('VALIDACION');
    await eliminarReferencia(e.ctx(e.admin), { referenciaId: id });
    expect(await hay(referencia, otra)).toBe(true);
  });

  it('la excepcion vale solo dentro de la funcion: despues, el historial, los comentarios y la auditoria siguen siendo de solo escritura', async () => {
    const id = await nuevaFicha(e);
    await guardarCampo(e.ctx(e.edward), { referenciaId: id, campo: 'uso', valor: 'Algo', versionEsperada: 0 });
    await eliminarReferencia(e.ctx(e.admin), { referenciaId: await nuevaFicha(e) });
    await rechazaCon(e.db.delete(campoHistorial).where(eq(campoHistorial.referenciaId, id)), /solo escritura/);
    await rechazaCon(e.db.delete(comentario), /solo escritura/);
    await rechazaCon(e.db.update(auditoria).set({ ip: 'x' }), /solo escritura/);
    await rechazaCon(e.db.delete(auditoria), /solo escritura/);
    await rechazaCon(e.db.execute(sql`truncate campo_historial cascade`), /solo escritura/);
  });
});

describe('clave de entrega cifrada', () => {
  it('se cifra y se descifra; un texto alterado o ajeno no se descifra', () => {
    const uid = '11111111-1111-4111-8111-111111111111';
    const c = cifrarClave('AbCd-1234-WxYz', uid);
    expect(c).not.toContain('AbCd');
    expect(c.startsWith('v2.')).toBe(true);
    expect(descifrarClave(c, uid)).toBe('AbCd-1234-WxYz');
    expect(descifrarClave(c, '22222222-2222-4222-8222-222222222222')).toBeNull(); // ligada a su cuenta
    expect(cifrarClave('AbCd-1234-WxYz', uid)).not.toBe(c); // cada cifrado lleva su propio vector
    const partes = c.split('.');
    expect(descifrarClave([partes[0], partes[1], partes[2], Buffer.from('otra cosa').toString('base64')].join('.'), uid)).toBeNull();
    expect(descifrarClave('basura', uid)).toBeNull();
  });

  it('el administrador la ve tal cual se entrego; no es la contrasena guardada (hash) ni queda en la auditoria', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Nueva Persona', usuario: 'nueva.persona', organizacionId: e.orgInterna, rol: 'lector' });
    const vista = await verClaveEntrega(e.ctx(e.admin), { usuarioId: r.id });
    expect(vista).toMatchObject({ usuario: 'nueva.persona', nombre: 'Nueva Persona', clave: r.claveTemporal });
    const [fila] = await e.db.select().from(claveEntrega).where(eq(claveEntrega.usuarioId, r.id));
    expect(fila?.cifrada).not.toContain(r.claveTemporal!);
    const [cred] = await e.db.select().from(account).where(eq(account.userId, r.id));
    expect(cred?.password).not.toBe(r.claveTemporal);
    const auds = await e.db.select().from(auditoria).where(eq(auditoria.entidadId, r.id));
    expect(JSON.stringify(auds)).not.toContain(r.claveTemporal!);
  });

  it('al restablecerla la nueva reemplaza a la anterior; cuando la persona cambia la suya deja de poder verse', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Cambia Clave', usuario: 'cambia.clave', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Marketing' });
    const entrega = await restablecerClave(e.ctx(e.admin), { usuarioId: r.id });
    expect(entrega.claveTemporal).not.toBe(r.claveTemporal);
    expect((await verClaveEntrega(e.ctx(e.admin), { usuarioId: r.id })).clave).toBe(entrega.claveTemporal);

    const actor = (await cargarActorPorId(e.db, r.id))!;
    await cambiarMiClave(e.ctx(actor), { actual: entrega.claveTemporal, nueva: 'mi-clave-propia-9', repetir: 'mi-clave-propia-9' });
    expect(await e.db.select().from(claveEntrega).where(eq(claveEntrega.usuarioId, r.id))).toHaveLength(0);
    expect(await verClaveEntrega(e.ctx(e.admin), { usuarioId: r.id })).toMatchObject({ clave: null, desde: null });
    const vistas = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'ver_clave'), eq(auditoria.entidadId, r.id)));
    expect(vistas.map((v) => (v.detalle as { disponible: boolean }).disponible)).toEqual([true, false]);
  });

  it('una cuenta creada fuera de la plataforma no tiene copia: se ve como no disponible hasta restablecerla', async () => {
    const [u] = await e.db
      .insert(usuario)
      .values({ nombre: 'Por script', email: 'por.script@prueba.invalid', rol: 'lector', organizacionId: e.orgInterna, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    expect((await verClaveEntrega(e.ctx(e.admin), { usuarioId: u!.id })).clave).toBeNull();
    const entrega = await restablecerClave(e.ctx(e.admin), { usuarioId: u!.id });
    expect((await verClaveEntrega(e.ctx(e.admin), { usuarioId: u!.id })).clave).toBe(entrega.claveTemporal);
  });

  it('solo el administrador: supervisora, solicitante, aduana y lector reciben sin permiso', async () => {
    const angie = await crearSupervisora(e, 'Otra Angie', 'otra.angie@prueba.invalid');
    for (const actor of [angie, e.edward, e.brian, e.lector]) {
      expect(await codigoDe(verClaveEntrega(e.ctx(actor), { usuarioId: e.charles.usuarioId })), actor.rol).toBe('SIN_PERMISO');
    }
    expect(await codigoDe(verClaveEntrega(e.ctx(e.admin), { usuarioId: '00000000-0000-4000-8000-000000000000' }))).toBe('NO_ENCONTRADO');
  });
});

describe('eliminar una cuenta', () => {
  it('la UNICA cuenta de una agencia se va con la agencia: pendientes, avisos, sesiones y clave tambien; la auditoria se conserva con el usuario anotado', async () => {
    const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Efimera' });
    const id = await fichaEnAduana(e, { codigo: 'ELIM-AG-1' });
    await enviarA(e.ctx(e.admin), { referenciaId: id, destinatarios: [{ usuarioId: ag.cuentaId }] });
    await e.db.insert(session).values({ userId: ag.cuentaId, token: 'tok-efimera', expiresAt: new Date(Date.now() + 3_600_000) });
    await auditar(e.db, { usuarioId: ag.cuentaId, accion: 'login', entidad: 'usuario', entidadId: ag.cuentaId });
    expect(await diagnosticoBorradoCuenta(e.db, ag.cuentaId)).toEqual({ conTrabajo: false, pendientes: 1, borraLaAgencia: true });

    const r = await eliminarCuenta(e.ctx(e.admin), { usuarioId: ag.cuentaId });
    expect(r).toMatchObject({ ok: true, usuario: ag.usuario, agenciaEliminada: true });

    expect(await hay(usuario, ag.cuentaId)).toBe(false);
    expect(await hay(organizacion, ag.organizacionId)).toBe(false);
    expect(await e.db.select().from(account).where(eq(account.userId, ag.cuentaId))).toHaveLength(0);
    expect(await e.db.select().from(session).where(eq(session.userId, ag.cuentaId))).toHaveLength(0);
    expect(await e.db.select().from(claveEntrega).where(eq(claveEntrega.usuarioId, ag.cuentaId))).toHaveLength(0);
    expect(await e.db.select().from(asignacion).where(eq(asignacion.aUsuarioId, ag.cuentaId))).toHaveLength(0);
    expect(await e.db.select().from(notificacion).where(eq(notificacion.usuarioId, ag.cuentaId))).toHaveLength(0);
    // La referencia sigue ahi, solo que sin esa agencia.
    expect(await hay(referencia, id)).toBe(true);
    // La fila de auditoria de su ingreso se conserva, sin el vinculo y con el usuario anotado.
    const [login] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'login'), eq(auditoria.entidadId, ag.cuentaId)));
    expect(login?.usuarioId).toBeNull();
    expect(login?.detalle).toMatchObject({ usuarioEliminado: ag.usuario });
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'eliminar_cuenta'), eq(auditoria.entidadId, ag.cuentaId)));
    expect(aud).toMatchObject({ usuarioId: e.admin.usuarioId });
    expect(aud?.detalle).toMatchObject({ usuario: ag.usuario, rol: 'aduana', organizacion: 'Agencia Efimera', agenciaEliminada: true, pendientesQuitados: 1 });
  });

  it('una cuenta que ya trabajo (comento, escribio un campo, creo una ficha) SI se elimina: se retira y el historial conserva su nombre', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Trabajadora', usuario: 'trabajadora', organizacionId: e.orgInterna, rol: 'solicitante', area: 'Consumibles' });
    const actor = (await cargarActorPorId(e.db, r.id))!;
    const ficha = await crearReferencia(e.ctx(actor), { codigo: 'ELIM-TRAB-1', nombreProducto: 'Con trabajo', tipoProducto: 'INSUMO' });
    expect(await diagnosticoBorradoCuenta(e.db, r.id)).toMatchObject({ conTrabajo: true });
    expect(await eliminarCuenta(e.ctx(e.admin), { usuarioId: r.id })).toMatchObject({ ok: true, agenciaEliminada: false });
    // La fila se conserva anonimizada: la referencia sigue siendo suya y no entra mas.
    const [fila] = await e.db.select().from(usuario).where(eq(usuario.id, r.id));
    expect(fila).toMatchObject({ activo: false, nombre: 'Trabajadora (cuenta eliminada)' });
    expect(fila?.eliminadoEn).not.toBeNull();
    expect(fila?.username).toMatch(/^eliminada-/);
    expect(fila?.email).toMatch(/@eliminada\.invalid$/);
    expect(await e.db.select().from(account).where(eq(account.userId, r.id))).toHaveLength(0);
    expect(await e.db.select().from(claveEntrega).where(eq(claveEntrega.usuarioId, r.id))).toHaveLength(0);
    const [ref] = await e.db.select().from(referencia).where(eq(referencia.id, ficha.id));
    expect(ref?.creadaPor).toBe(r.id);
    expect((await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'eliminar_cuenta'), eq(auditoria.entidadId, r.id))))[0]?.detalle).toMatchObject({ conservadaEnHistorial: true });
    // El usuario queda libre y la cuenta ya no sale en la lista ni se puede abrir.
    expect((await listarUsuariosAdmin(e.db, e.admin)).some((u) => u.id === r.id)).toBe(false);
    expect(await obtenerUsuarioAdmin(e.db, e.admin, r.id)).toBeNull();
    await crearCuenta(e.ctx(e.admin), { nombre: 'Otra', usuario: 'trabajadora', organizacionId: e.orgInterna, rol: 'lector' });
    // Una vez retirada no se puede volver a eliminar.
    expect(await codigoDe(eliminarCuenta(e.ctx(e.admin), { usuarioId: r.id }))).toBe('NO_ENCONTRADO');
  });

  it('una cuenta que ENVIO una ficha a otra persona se retira sin quitarle el acceso al destinatario', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Remitente', usuario: 'remitente', organizacionId: e.orgInterna, rol: 'supervisor' });
    const remitente = (await cargarActorPorId(e.db, r.id))!;
    const id = await fichaEnAduana(e, { llena: true, codigo: 'ELIM-REM-1', nombre: 'Enviada' });
    await enviarA(e.ctx(remitente), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId }] });
    expect(await diagnosticoBorradoCuenta(e.db, r.id)).toMatchObject({ conTrabajo: true });
    expect(await eliminarCuenta(e.ctx(e.admin), { usuarioId: r.id })).toMatchObject({ ok: true });
    expect(await hay(usuario, r.id)).toBe(true); // retirada, no borrada
    const asignaciones = await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, id));
    expect(asignaciones.some((a) => a.aUsuarioId === e.charles.usuarioId && a.deUsuarioId === r.id)).toBe(true); // el destinatario conserva su pendiente
  });

  it('una cuenta de area sin trabajo se elimina sola: la organizacion interna se queda', async () => {
    const r = await crearCuenta(e.ctx(e.admin), { nombre: 'Sin Uso', usuario: 'sin.uso', organizacionId: e.orgInterna, rol: 'lector' });
    expect(await eliminarCuenta(e.ctx(e.admin), { usuarioId: r.id })).toMatchObject({ ok: true, agenciaEliminada: false });
    expect(await hay(usuario, r.id)).toBe(false);
    expect(await hay(organizacion, e.orgInterna)).toBe(true);
  });

  it('una cuenta de una agencia con OTRA cuenta no borra la agencia', async () => {
    const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia De Dos' });
    const segunda = await crearCuenta(e.ctx(e.admin), { nombre: 'Segunda', usuario: 'segunda.agencia', organizacionId: ag.organizacionId, rol: 'aduana' });
    expect(await diagnosticoBorradoCuenta(e.db, segunda.id)).toMatchObject({ borraLaAgencia: false });
    expect(await eliminarCuenta(e.ctx(e.admin), { usuarioId: segunda.id })).toMatchObject({ agenciaEliminada: false });
    expect(await hay(organizacion, ag.organizacionId)).toBe(true);
    expect(await hay(usuario, ag.cuentaId)).toBe(true);
  });

  it('no puedes eliminarte a ti mismo ni a una cuenta de administracion siendo supervisora; solicitante, aduana y lector no pueden', async () => {
    const angie = await crearSupervisora(e, 'Angie Tres', 'angie.tres@prueba.invalid');
    expect(await codigoDe(eliminarCuenta(e.ctx(e.admin), { usuarioId: e.admin.usuarioId }))).toBe('VALIDACION');
    expect(await codigoDe(eliminarCuenta(e.ctx(angie), { usuarioId: e.admin.usuarioId }))).toBe('SIN_PERMISO');
    expect(await codigoDe(eliminarCuenta(e.ctx(angie), { usuarioId: angie.usuarioId }))).toBe('SIN_PERMISO');
    for (const actor of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(eliminarCuenta(e.ctx(actor), { usuarioId: e.charles.usuarioId })), actor.rol).toBe('SIN_PERMISO');
    }
    expect(await hay(usuario, e.admin.usuarioId)).toBe(true);
    expect(await cuentaDe(e.charles.usuarioId)).toBeTruthy();
  });

  it('no deja la plataforma sin administrador: ni el unico administrador activo, ni una cuenta inexistente', async () => {
    const segundo = await crearCuenta(e.ctx(e.admin), { nombre: 'Otro Admin', usuario: 'otro.admin', organizacionId: e.orgInterna, rol: 'admin' });
    // El segundo se elimina sin problema (queda el primero)...
    expect(await eliminarCuenta(e.ctx(e.admin), { usuarioId: segundo.id })).toMatchObject({ ok: true });
    // ...pero el primero no puede eliminarse a si mismo y un tercero no puede dejarlo sin administradores.
    expect(await codigoDe(eliminarCuenta(e.ctx(e.admin), { usuarioId: e.admin.usuarioId }))).toBe('VALIDACION');
    expect(await codigoDe(eliminarCuenta(e.ctx(e.admin), { usuarioId: '00000000-0000-4000-8000-000000000000' }))).toBe('NO_ENCONTRADO');
  });
});

describe('eliminar una agencia (organizacion)', () => {
  it('se va con todas sus cuentas libres de trabajo; deja la auditoria con el nombre y las cuentas', async () => {
    const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Con Dos Cuentas' });
    const segunda = await crearCuenta(e.ctx(e.admin), { nombre: 'Segunda Cuenta', usuario: 'segunda.cuenta', organizacionId: ag.organizacionId, rol: 'aduana' });
    const r = await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: ag.organizacionId });
    expect(r).toEqual({ ok: true, nombre: 'Agencia Con Dos Cuentas', cuentasEliminadas: 2 });
    expect(await hay(organizacion, ag.organizacionId)).toBe(false);
    expect(await hay(usuario, ag.cuentaId)).toBe(false);
    expect(await hay(usuario, segunda.id)).toBe(false);
    const [aud] = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'eliminar_organizacion'), eq(auditoria.entidadId, ag.organizacionId)));
    expect(aud?.detalle).toMatchObject({ nombre: 'Agencia Con Dos Cuentas', tipo: 'agencia', cuentas: expect.arrayContaining([ag.usuario, 'segunda.cuenta']) });
    // El nombre queda libre.
    await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Con Dos Cuentas' });
  });

  it('la agencia que ya trabajo se retira completa: la organizacion queda «(eliminada)», sus cuentas anonimizadas y el historial sigue firmado', async () => {
    const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Que Comento' });
    const ficha = await nuevaFicha(e);
    await e.db.insert(comentario).values({ referenciaId: ficha, autorId: ag.cuentaId, texto: 'Hola', visibilidad: 'todos' });
    const r = await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: ag.organizacionId });
    expect(r).toMatchObject({ ok: true, cuentasEliminadas: 1 });
    const [org] = await e.db.select().from(organizacion).where(eq(organizacion.id, ag.organizacionId));
    expect(org).toMatchObject({ nombre: 'Agencia Que Comento (eliminada)', activa: false });
    const [cuenta] = await e.db.select().from(usuario).where(eq(usuario.id, ag.cuentaId));
    expect(cuenta?.eliminadoEn).not.toBeNull();
    expect((await e.db.select().from(comentario).where(eq(comentario.referenciaId, ficha)))[0]?.autorId).toBe(ag.cuentaId);
    // La funcion de la base tampoco la vuelve a retirar y sigue sin darle a `app` permisos de borrado directo.
    await rechazaCon(e.db.execute(sql`select public.eliminar_organizacion(${ag.organizacionId}::uuid)`), /organizacion_no_existe/);
    await rechazaCon(e.db.execute(sql`select public.eliminar_usuario(${ag.cuentaId}::uuid)`), /usuario_no_existe/);
  });

  it('se puede borrar y volver a crear la misma agencia varias veces: los nombres retirados no chocan', async () => {
    for (let i = 0; i < 3; i++) {
      const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Repetida' });
      await e.db.insert(comentario).values({ referenciaId: await nuevaFicha(e), autorId: ag.cuentaId, texto: `Ronda ${i}`, visibilidad: 'todos' });
      await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: ag.organizacionId });
    }
    const nombres = (await e.db.select({ n: organizacion.nombre }).from(organizacion)).map((o) => o.n).filter((x) => x.startsWith('Agencia Repetida'));
    expect(nombres.sort()).toEqual(['Agencia Repetida (eliminada 2)', 'Agencia Repetida (eliminada 3)', 'Agencia Repetida (eliminada)']);
  });

  it('una organizacion interna con cuentas no se borra; el trabajo ajeno de otras cuentas no estorba', async () => {
    expect(await codigoDe(eliminarOrganizacion(e.ctx(e.admin), { organizacionId: e.orgInterna }))).toBe('VALIDACION');
    const ag = await crearAgencia(e.ctx(e.admin), { nombre: 'Agencia Con Pendiente' });
    const id = await fichaEnAduana(e, { llena: true, codigo: 'ELIM-AG-2' });
    await enviarA(e.ctx(e.admin), { referenciaId: id, destinatarios: [{ usuarioId: ag.cuentaId }] });
    await escribir(e, e.brian, id, 'partida_arancelaria', '8421.39.90.00');
    await eliminarOrganizacion(e.ctx(e.admin), { organizacionId: ag.organizacionId });
    // Brian (otra agencia) sigue trabajando en su ficha sin cambios.
    expect(await hay(referencia, id)).toBe(true);
    expect((await e.db.select().from(asignacion).where(eq(asignacion.referenciaId, id))).length).toBeGreaterThan(0);
  });
});
