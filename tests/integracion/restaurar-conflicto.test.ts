/**
 * `restaurarCampo` y `resolverConflicto` (9.5, 9.6, RV-06, CA-12, CA-14, P-07): los tres caminos que
 * cambian el valor vigente respetan la misma regla de motivo y aviso.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, campoHistorial, notificacion, textoDescartado } from '@/db/esquema';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { resolverConflicto } from '@/server/acciones/resolver-conflicto';
import { ErrorAccion } from '@/server/acciones/resultado';
import { nuevoEscenario, nuevaFicha, rechazaCon, versionDe, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

const guardar = async (f: string, campo: string, valor: unknown, quien = e.edward, motivo?: string) =>
  guardarCampo(e.ctx(quien), {
    referenciaId: f,
    campo,
    valor,
    versionEsperada: await versionDe(e.db, f, campo),
    ...(motivo ? { motivo } : {}),
  });

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return err instanceof ErrorAccion ? err.codigo : `otro:${String(err)}`;
  }
  return 'OK';
}

async function hechos(f: string, campo: string) {
  return e.db
    .select()
    .from(campoHistorial)
    .where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, campo)))
    .orderBy(campoHistorial.versionCampo);
}

describe('restaurarCampo (9.6)', () => {
  it('repone una version anterior creando un hecho NUEVO "restaurar" (no reescribe nada)', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Primero');
    await guardar(f, 'uso', 'Segundo');
    const h = await hechos(f, 'uso');
    const r = await restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: h[0]!.id });
    expect(r).toMatchObject({ escrito: true, version: 3, valor: 'Primero' });

    const despues = await hechos(f, 'uso');
    expect(despues).toHaveLength(3);
    expect(despues[2]).toMatchObject({ tipoEvento: 'restaurar', valor: 'Primero', restauraId: h[0]!.id });
    expect(despues[0]!.valor).toBe('Primero'); // lo anterior sigue intacto
    expect(despues[1]!.valor).toBe('Segundo');
  });

  it('si el valor vigente es de otra persona exige motivo y le avisa a su autor', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Original de Edward');
    await guardar(f, 'uso', 'Cambio de Charles', e.charles, 'Lo ajusto');
    const h = await hechos(f, 'uso');

    // Edward restaura lo suyo sobre el valor de Charles: el vigente es ajeno => motivo.
    expect(await codigoDe(restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: h[0]!.id }))).toBe('FALTA_MOTIVO');
    const r = await restaurarCampo(e.ctx(e.edward), {
      referenciaId: f,
      campo: 'uso',
      historialId: h[0]!.id,
      motivo: 'Mi redaccion era la correcta',
    });
    expect(r.escrito).toBe(true);
    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(
        and(eq(notificacion.usuarioId, e.charles.usuarioId), eq(notificacion.tipo, 'cambio_en_mi_campo'), eq(notificacion.referenciaId, f)),
      );
    expect(avisos).toHaveLength(1);
    const ultimo = (await hechos(f, 'uso')).at(-1)!;
    expect(ultimo.motivo).toBe('Mi redaccion era la correcta');
  });

  it('no puede reponer una version vacia sobre un valor ajeno (RV-06); un admin si, con motivo', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Algo'); // v1 de Edward
    await guardar(f, 'uso', ''); // v2 vaciado por Edward
    await guardar(f, 'uso', 'Valor de Charles', e.charles); // v3 de Charles (el vigente estaba vacio: no hay valor ajeno que proteger)
    const h = await hechos(f, 'uso');
    const vacia = h.find((x) => x.tipoEvento === 'vaciar')!;

    expect(await codigoDe(restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: vacia.id, motivo: 'quiero vaciarlo' }))).toBe('SIN_PERMISO');
    expect(await codigoDe(restaurarCampo(e.ctx(e.admin), { referenciaId: f, campo: 'uso', historialId: vacia.id }))).toBe('FALTA_MOTIVO');
    const ok = await restaurarCampo(e.ctx(e.admin), { referenciaId: f, campo: 'uso', historialId: vacia.id, motivo: 'Duplicado' });
    expect(ok).toMatchObject({ escrito: true, valor: null });
  });

  it('restaurar la version que ya es la vigente no escribe nada', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Unico');
    const h = await hechos(f, 'uso');
    const r = await restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: h[0]!.id });
    expect(r.escrito).toBe(false);
    expect(await hechos(f, 'uso')).toHaveLength(1);
  });

  it('deja registro en la auditoria', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'A');
    await guardar(f, 'uso', 'B');
    const h = await hechos(f, 'uso');
    await restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: h[0]!.id, motivo: 'vuelvo' });
    const filas = await e.db.select().from(auditoria).where(and(eq(auditoria.accion, 'restaurar'), eq(auditoria.entidadId, f)));
    expect(filas).toHaveLength(1);
    expect(filas[0]!.detalle).toMatchObject({ campo: 'uso', versionRestaurada: 1, versionNueva: 3, motivo: 'vuelvo' });
  });

  it('permisos: la aduana no restaura campos del cliente; una version de otra ficha o campo no existe', async () => {
    const f = await nuevaFicha(e);
    const g = await nuevaFicha(e);
    await guardar(f, 'uso', 'A');
    await guardar(g, 'uso', 'B');
    const hf = await hechos(f, 'uso');
    const hg = await hechos(g, 'uso');
    expect(await codigoDe(restaurarCampo(e.ctx(e.lector), { referenciaId: f, campo: 'uso', historialId: hf[0]!.id }))).toBe('SIN_PERMISO');
    expect(await codigoDe(restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: hg[0]!.id }))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'funciones', historialId: hf[0]!.id }))).toBe('NO_ENCONTRADO');
  });
});

describe('resolverConflicto (9.5, CA-14)', () => {
  it('"Dejar el de ella": el texto propio queda en texto_descartado y el campo no cambia', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Texto de Edward');
    const r = await resolverConflicto(e.ctx(e.charles), { referenciaId: f, campo: 'uso', opcion: 'dejar', valor: 'Mi texto largo que no quiero perder' });
    expect(r).toMatchObject({ opcion: 'dejar', textoConservado: true, version: 1 });
    expect(await hechos(f, 'uso')).toHaveLength(1);
    const guardados = await e.db.select().from(textoDescartado).where(eq(textoDescartado.referenciaId, f));
    expect(guardados).toHaveLength(1);
    expect(guardados[0]).toMatchObject({
      campo: 'uso',
      usuarioId: e.charles.usuarioId,
      texto: 'Mi texto largo que no quiero perder',
      motivoDescarte: 'conflicto_dejar_el_otro',
    });
    // Es append-only: no se puede editar ni borrar.
    await rechazaCon(e.db.delete(textoDescartado).where(eq(textoDescartado.referenciaId, f)), /solo escritura/);
  });

  it('"Usar el mio" exige motivo (el valor vigente es ajeno) y avisa al autor', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Texto de Edward');
    expect(await codigoDe(resolverConflicto(e.ctx(e.charles), { referenciaId: f, campo: 'uso', opcion: 'usar_mio', valor: 'Texto de Charles' }))).toBe('FALTA_MOTIVO');
    const r = await resolverConflicto(e.ctx(e.charles), {
      referenciaId: f,
      campo: 'uso',
      opcion: 'usar_mio',
      valor: 'Texto de Charles',
      motivo: 'Es mas preciso',
    });
    expect(r).toMatchObject({ opcion: 'usar_mio', version: 2, textoConservado: false });
    expect((await hechos(f, 'uso')).map((x) => x.valor)).toEqual(['Texto de Edward', 'Texto de Charles']);
    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(
        and(eq(notificacion.usuarioId, e.edward.usuarioId), eq(notificacion.tipo, 'cambio_en_mi_campo'), eq(notificacion.referenciaId, f)),
      );
    expect(avisos).toHaveLength(1);
  });

  it('"Combinar" solo para campos de texto y tambien exige motivo', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'materia_constitutiva', 'Agua');
    await guardar(f, 'pais_origen', 'FR');
    const combinado = await resolverConflicto(e.ctx(e.charles), {
      referenciaId: f,
      campo: 'materia_constitutiva',
      opcion: 'combinar',
      valor: 'Agua\nAlcohol',
      motivo: 'Sumo mi componente',
    });
    expect(combinado.version).toBe(2);
    expect(await codigoDe(resolverConflicto(e.ctx(e.charles), { referenciaId: f, campo: 'pais_origen', opcion: 'combinar', valor: 'CN', motivo: 'x' }))).toBe('VALIDACION');
    expect(await codigoDe(resolverConflicto(e.ctx(e.edward), { referenciaId: f, campo: 'materia_constitutiva', opcion: 'combinar', valor: 'Agua\nAlcohol\nSal' }))).toBe('FALTA_MOTIVO');
  });

  it('usar el mio sobre un valor propio no pide motivo', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Mio');
    const r = await resolverConflicto(e.ctx(e.edward), { referenciaId: f, campo: 'uso', opcion: 'usar_mio', valor: 'Mio ajustado' });
    expect(r.version).toBe(2);
  });

  it('una ficha ajena o un campo fuera de grupo siguen protegidos', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'x');
    expect(await codigoDe(resolverConflicto(e.ctx(e.brian), { referenciaId: f, campo: 'uso', opcion: 'dejar', valor: 'texto' }))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(resolverConflicto(e.ctx(e.lector), { referenciaId: f, campo: 'uso', opcion: 'dejar', valor: 'texto' }))).toBe('SIN_PERMISO');
    expect(await codigoDe(resolverConflicto(e.ctx(e.charles), { referenciaId: f, campo: 'uso', opcion: 'dejar', valor: '   ' }))).toBe('VALIDACION');
  });
});
