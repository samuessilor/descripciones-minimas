/** Visor de auditoria y «Mi cuenta» (H5). */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, session, usuario } from '@/db/esquema';
import { ErrorAccion } from '@/server/acciones/resultado';
import { actualizarPreferencias, cerrarOtrasSesiones, cerrarSesionPropia } from '@/server/acciones/cuenta';
import { auditar } from '@/server/auditoria';
import { aCsv } from '@/server/csv';
import {
  auditoriaParaCsv,
  listarAuditoriaAdmin,
  obtenerEventoAuditoria,
  opcionesFiltroAuditoria,
  POR_PAGINA_AUDITORIA,
} from '@/server/politicas/administracion-auditoria';
import { misPreferencias, misSesiones } from '@/server/politicas/cuenta';
import { crearOrganizacion } from '@/server/acciones/organizaciones';
import { nuevaFicha, nuevoEscenario, type Escenario } from './ayudas';

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

describe('visor de auditoria (solo lectura, solo admin)', () => {
  it('los demas roles no la ven ni la exportan', async () => {
    for (const actor of [e.edward, e.brian, e.lector]) {
      expect(await codigoDe(listarAuditoriaAdmin(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(auditoriaParaCsv(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(opcionesFiltroAuditoria(e.db, actor)), actor.rol).toBe('SIN_PERMISO');
      expect(await codigoDe(obtenerEventoAuditoria(e.db, actor, 1)), actor.rol).toBe('SIN_PERMISO');
    }
  });

  it('filtra por fecha (hora de Bogota), persona, accion y referencia (por codigo, sin guiones)', async () => {
    const ficha = await nuevaFicha(e, { codigo: 'AUD-0001' });
    await auditar(e.db, { usuarioId: e.edward.usuarioId, accion: 'login', entidad: 'usuario', entidadId: e.edward.usuarioId, creadoEn: new Date('2026-03-10T04:30:00Z') }); // 9 de marzo en Bogota
    await auditar(e.db, { usuarioId: e.edward.usuarioId, accion: 'login', entidad: 'usuario', entidadId: e.edward.usuarioId, creadoEn: new Date('2026-03-10T05:30:00Z') }); // 10 de marzo
    await auditar(e.db, { usuarioId: e.charles.usuarioId, accion: 'exportar', entidad: 'referencia', entidadId: ficha, detalle: { filas: 3 }, creadoEn: new Date('2026-03-11T15:00:00Z') });

    const dia10 = await listarAuditoriaAdmin(e.db, e.admin, { desde: '2026-03-10', hasta: '2026-03-10' });
    expect(dia10.filas.map((f) => f.creadoEn)).toEqual(['2026-03-10T05:30:00.000Z']);
    expect((await listarAuditoriaAdmin(e.db, e.admin, { desde: '2026-03-09', hasta: '2026-03-10' })).total).toBe(2);
    expect((await listarAuditoriaAdmin(e.db, e.admin, { usuarioId: e.charles.usuarioId, accion: 'exportar' })).filas).toHaveLength(1);
    const porFicha = await listarAuditoriaAdmin(e.db, e.admin, { ficha: 'aud 0001' });
    expect(porFicha.filas.map((f) => f.accion)).toEqual(expect.arrayContaining(['exportar', 'crear_referencia']));
    expect(porFicha.filas.every((f) => f.entidadId === ficha)).toBe(true);
    expect(porFicha.filas[0]!.entidadEtiqueta).toBe('AUD-0001');
    expect((await listarAuditoriaAdmin(e.db, e.admin, { ficha: 'NO-EXISTE' })).fichaNoExiste).toBe(true);
    expect((await listarAuditoriaAdmin(e.db, e.admin, { ficha })).total).toBe(porFicha.total); // tambien por id
    expect((await listarAuditoriaAdmin(e.db, e.admin, { desde: 'ayer', hasta: '31/12' })).total).toBeGreaterThan(0); // fechas invalidas se ignoran

    const evento = porFicha.filas.find((f) => f.accion === 'exportar')!;
    expect((await obtenerEventoAuditoria(e.db, e.admin, evento.id))?.detalle).toEqual({ filas: 3 });
    expect(await obtenerEventoAuditoria(e.db, e.admin, -5)).toBeNull();
  });

  it('el filtro por referencia trae tambien los envios (auditados sobre la asignacion) y muestra el codigo', async () => {
    const ficha = await nuevaFicha(e, { codigo: 'AUD-0002' });
    const detalle = { referenciaId: ficha, codigo: 'AUD-0002' };
    await auditar(e.db, { usuarioId: e.edward.usuarioId, accion: 'enviar_a', entidad: 'asignacion', entidadId: crypto.randomUUID(), detalle });
    const porFicha = await listarAuditoriaAdmin(e.db, e.admin, { ficha: 'AUD-0002' });
    const envio = porFicha.filas.find((f) => f.accion === 'enviar_a');
    expect(envio?.entidadEtiqueta).toBe('AUD-0002');
    expect(porFicha.filas.map((f) => f.accion)).toEqual(expect.arrayContaining(['crear_referencia', 'enviar_a']));
  });

  it('pagina de a 50, del mas reciente al mas antiguo, sin repetir', async () => {
    for (let i = 0; i < 120; i++) await auditar(e.db, { usuarioId: null, accion: 'login_fallido', entidad: 'usuario', entidadId: 'desconocido', detalle: { i } });
    const p1 = await listarAuditoriaAdmin(e.db, e.admin, { accion: 'login_fallido', pagina: 1 });
    const p2 = await listarAuditoriaAdmin(e.db, e.admin, { accion: 'login_fallido', pagina: 2 });
    const p3 = await listarAuditoriaAdmin(e.db, e.admin, { accion: 'login_fallido', pagina: 3 });
    expect(p1.total).toBe(120);
    expect([p1.filas.length, p2.filas.length, p3.filas.length]).toEqual([POR_PAGINA_AUDITORIA, POR_PAGINA_AUDITORIA, 20]);
    const ids = [...p1.filas, ...p2.filas, ...p3.filas].map((f) => f.id);
    expect(new Set(ids).size).toBe(120);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
  });

  it('el CSV neutraliza formulas (13.4) y respeta los filtros', async () => {
    const [u] = await e.db.insert(usuario).values({ nombre: '=HYPERLINK("http://malo")', email: 'formula@prueba.invalid', organizacionId: e.orgInterna, organizacionTipo: 'interna', rol: 'lector' }).returning();
    await auditar(e.db, { usuarioId: u!.id, accion: 'login_fallido', entidad: 'usuario', entidadId: u!.id, detalle: { nota: '=1+1' } });
    const { filas, truncado } = await auditoriaParaCsv(e.db, e.admin, { usuarioId: u!.id });
    expect(truncado).toBe(false);
    expect(filas).toHaveLength(1);
    const csv = aCsv(['persona', 'detalle'], filas.map((f) => [f.usuarioNombre, f.detalle]));
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toMatch(/\r\n=HYPERLINK/);
    // el detalle va como JSON (su celda empieza por «{»): el texto «=1+1» queda dentro, sin ser formula
    expect(csv.split('\r\n').every((l) => !/^[=+@]/.test(l.replace('\uFEFF', '')))).toBe(true);
  });

  it('las opciones de filtro traen solo lo que existe', async () => {
    const o = await opcionesFiltroAuditoria(e.db, e.admin);
    expect(o.acciones).toEqual(expect.arrayContaining(['login', 'exportar', 'login_fallido']));
    expect(o.usuarios.map((x) => x.id)).toContain(e.edward.usuarioId);
  });

  it('la tabla sigue siendo de solo escritura: ninguna accion de H5 modifica ni borra eventos', async () => {
    await crearOrganizacion(e.ctx(e.admin), { nombre: 'Para auditar', tipo: 'interna' });
    const antes = (await e.db.select().from(auditoria)).length;
    await expect(e.db.update(auditoria).set({ accion: 'login' }).where(eq(auditoria.accion, 'login_fallido'))).rejects.toThrow();
    await expect(e.db.delete(auditoria).where(eq(auditoria.accion, 'login_fallido'))).rejects.toThrow();
    expect((await e.db.select().from(auditoria)).length).toBe(antes);
  });
});

describe('mi cuenta', () => {
  async function sesion(userId: string, token: string, agente = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120') {
    const [s] = await e.db.insert(session).values({ userId, token, expiresAt: new Date(Date.now() + 3_600_000), userAgent: agente }).returning();
    return s!.id;
  }

  it('cada quien cambia SUS preferencias, con auditoria; sin cambio no audita', async () => {
    await actualizarPreferencias(e.ctx(e.lector), { atajosTeclado: false });
    expect(await misPreferencias(e.db, e.lector)).toMatchObject({ atajosTeclado: false });
    const a = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'actualizar_preferencias'), eq(auditoria.entidadId, e.lector.usuarioId)));
    expect(a).toHaveLength(1);
    await actualizarPreferencias(e.ctx(e.lector), { atajosTeclado: false });
    expect(await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'actualizar_preferencias'), eq(auditoria.entidadId, e.lector.usuarioId)))).toHaveLength(1);
    // la preferencia de otra persona no cambio
    expect(await misPreferencias(e.db, e.edward)).toMatchObject({ atajosTeclado: true });
    expect(await codigoDe(actualizarPreferencias(e.ctx(e.lector), {}))).toBe('VALIDACION');
  });

  it('lista mis sesiones marcando la actual y cierra las otras sin tocar la actual ni las de nadie mas', async () => {
    const actual = await sesion(e.edward.usuarioId, 't-actual');
    const otra = await sesion(e.edward.usuarioId, 't-otra');
    const ajena = await sesion(e.charles.usuarioId, 't-ajena');
    const yo = { ...e.edward, sesionId: actual };

    const mias = await misSesiones(e.db, yo);
    expect(mias.map((s) => [s.id, s.esActual]).sort()).toEqual([[actual, true], [otra, false]].sort());

    expect(await codigoDe(cerrarSesionPropia(e.ctx(yo), { sesionId: actual }))).toBe('VALIDACION'); // la actual se cierra saliendo
    expect(await codigoDe(cerrarSesionPropia(e.ctx(yo), { sesionId: ajena }))).toBe('NO_ENCONTRADO'); // no se cierra la de otra persona
    await cerrarSesionPropia(e.ctx(yo), { sesionId: otra });
    expect((await misSesiones(e.db, yo)).map((s) => s.id)).toEqual([actual]);

    await sesion(e.edward.usuarioId, 't-otra-2');
    await sesion(e.edward.usuarioId, 't-otra-3');
    expect(await cerrarOtrasSesiones(e.ctx(yo))).toEqual({ cerradas: 2 });
    expect((await misSesiones(e.db, yo)).map((s) => s.id)).toEqual([actual]);
    expect((await misSesiones(e.db, { ...e.charles, sesionId: ajena })).map((s) => s.id)).toEqual([ajena]);
    expect(await cerrarOtrasSesiones(e.ctx(yo))).toEqual({ cerradas: 0 });
    expect(await codigoDe(cerrarOtrasSesiones(e.ctx(e.edward)))).toBe('VALIDACION'); // sin sesion identificada no se arriesga a cerrar la propia
  });
});
