/**
 * P-03: aislamiento entre agencias, 404 (no 403), acceso temporal de la aduana, y ocultamiento de
 * identidades y motivos (A5, RV-28, RV-29, PA-38, CA-19, CA-20).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import { fichaVisiblePara, type AccesoAgencia } from '@/dominio/permisos';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { historialDeCampo, listarReferencias, vistaFicha } from '@/server/politicas/referencias';
import { asignarAAduana, nuevoEscenario, nuevaFicha, rechazaCon, versionDe, type Escenario } from './ayudas';

let e: Escenario;
const ahora = new Date();

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

describe('listado y ficha por rol', () => {
  let f1: string;
  let f2: string;
  let f3: string;

  beforeAll(async () => {
    f1 = await nuevaFicha(e, { codigo: 'VIS-1' });
    f2 = await nuevaFicha(e, { codigo: 'VIS-2' });
    f3 = await nuevaFicha(e, { codigo: 'VIS-3' });
    await asignarAAduana(e, f1, e.brian);
    await asignarAAduana(e, f2, e.brianB);
  });

  it('los roles internos ven todas las fichas', async () => {
    for (const actor of [e.admin, e.edward, e.charles, e.lector]) {
      const lista = await listarReferencias(e.db, actor, { ahora });
      const codigos = lista.map((x) => x.codigo);
      expect(codigos, actor.nombre).toEqual(expect.arrayContaining(['VIS-1', 'VIS-2', 'VIS-3']));
    }
  });

  it('la agencia A ve solo la ficha enviada a ella; la B solo la suya', async () => {
    const a = (await listarReferencias(e.db, e.brian, { ahora })).map((x) => x.codigo);
    const b = (await listarReferencias(e.db, e.brianB, { ahora })).map((x) => x.codigo);
    expect(a).toEqual(['VIS-1']);
    expect(b).toEqual(['VIS-2']);
  });

  it('una ficha de otra agencia, una sin enviar y una inexistente responden igual: NO_ENCONTRADO (404, no 403)', async () => {
    for (const id of [f2, f3, '00000000-0000-4000-8000-000000000000']) {
      try {
        await vistaFicha(e.db, e.brian, id, ahora);
        throw new Error('no debio verla');
      } catch (err) {
        expect(err).toBeInstanceOf(ErrorAccion);
        expect((err as ErrorAccion).codigo).toBe('NO_ENCONTRADO');
        expect((err as ErrorAccion).message).toBe('Esta referencia no está asignada a tu cuenta. Pide acceso a quien te la envió.');
      }
    }
    // Para un interno el mensaje es el neutro: no distingue "no existe" de "sin acceso".
    try {
      await vistaFicha(e.db, e.edward, '00000000-0000-4000-8000-000000000000', ahora);
    } catch (err) {
      expect((err as ErrorAccion).message).toBe('No encontramos esa referencia. Revisa el enlace o búscala por código.');
    }
  });

  it('la agencia B no puede leer ni escribir sobre la ficha de la A (IDOR)', async () => {
    expect(await codigoDe(vistaFicha(e.db, e.brianB, f1, ahora))).toBe('NO_ENCONTRADO');
    expect(
      await codigoDe(
        guardarCampo(e.ctx(e.brianB), { referenciaId: f1, campo: 'observaciones_aduana', valor: 'intruso', versionEsperada: 0 }),
      ),
    ).toBe('NO_ENCONTRADO');
    expect(await codigoDe(historialDeCampo(e.db, e.brianB, f1, 'uso', ahora))).toBe('NO_ENCONTRADO');
  });

  it('la vista de la ficha incluye el semaforo y nunca un tercer color', async () => {
    const v = await vistaFicha(e.db, e.brian, f1, ahora);
    expect(['verde', 'amarillo']).toContain(v.color);
    expect(v.color).toBe('amarillo');
    expect(v.completitud.secciones.producto.estado).toBe('amarillo');
  });
});

describe('acceso temporal de la aduana (8.3 regla 10, S-22)', () => {
  const dia = 86_400_000;

  async function conAsignacion(estado: string, accesoHasta: Date | null) {
    const f = await nuevaFicha(e);
    await e.db.insert(asignacion).values({
      referenciaId: f,
      deUsuarioId: e.edward.usuarioId,
      aUsuarioId: e.brian.usuarioId,
      estado,
      ...(['hecha', 'reasignada', 'cancelada'].includes(estado) ? { completadaEn: new Date() } : {}),
      accesoHasta,
    });
    return f;
  }

  it('SQL y regla pura coinciden en cada caso', async () => {
    const casos: Array<{ estado: AccesoAgencia['estado']; hasta: Date | null; visible: boolean }> = [
      { estado: 'pendiente', hasta: null, visible: true },
      { estado: 'en_curso', hasta: null, visible: true },
      { estado: 'hecha', hasta: new Date(ahora.getTime() + 10 * dia), visible: true },
      { estado: 'hecha', hasta: new Date(ahora.getTime() - dia), visible: false },
      { estado: 'hecha', hasta: null, visible: false },
      { estado: 'reasignada', hasta: new Date(ahora.getTime() + dia), visible: true },
      { estado: 'cancelada', hasta: new Date(ahora.getTime() + 10 * dia), visible: false },
    ];
    for (const c of casos) {
      const f = await conAsignacion(c.estado, c.hasta);
      const pura = fichaVisiblePara(
        { usuarioId: e.brian.usuarioId, rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'agencia' },
        { archivada: false },
        [{ organizacionId: e.orgA, estado: c.estado, accesoHasta: c.hasta }],
        ahora,
      );
      const sql = (await codigoDe(vistaFicha(e.db, e.brian, f, ahora))) === 'OK';
      expect(pura, `${c.estado}`).toBe(c.visible);
      expect(sql, `${c.estado} (SQL)`).toBe(c.visible);
      const enLista = (await listarReferencias(e.db, e.brian, { ahora, limite: 100 })).some((x) => x.id === f);
      expect(enLista, `${c.estado} (listado)`).toBe(c.visible);
    }
  });

  it('el acceso se extiende a toda la organizacion del destinatario, no solo a la persona', async () => {
    const otraDeLaA = await e.db
      .insert(usuario)
      .values({ nombre: 'Colega de A', email: 'colega-a@prueba.invalid', rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'agencia' })
      .returning({ id: usuario.id });
    const { cargarActorPorId } = await import('@/server/politicas/actor');
    const colega = (await cargarActorPorId(e.db, otraDeLaA[0]!.id))!;
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    expect(await codigoDe(vistaFicha(e.db, colega, f, ahora))).toBe('OK');
    expect(await codigoDe(vistaFicha(e.db, e.brianB, f, ahora))).toBe('NO_ENCONTRADO');
  });

  it('una ficha archivada deja de ser visible para la aduana', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    expect(await codigoDe(vistaFicha(e.db, e.brian, f, ahora))).toBe('OK');
    await e.db.update(referencia).set({ archivadaEn: new Date(), archivadaPor: e.admin.usuarioId, motivoArchivo: 'p', estadoPrevioArchivo: 'BORRADOR' }).where(eq(referencia.id, f));
    expect(await codigoDe(vistaFicha(e.db, e.brian, f, ahora))).toBe('NO_ENCONTRADO');
    expect(await codigoDe(vistaFicha(e.db, e.edward, f, ahora))).toBe('OK'); // los internos si la ven
  });
});

describe('identidades y motivos ocultos (A5, RV-29, PA-38)', () => {
  it('"Otra agencia" en historial y vista; los internos ven nombres; el motivo interno no llega a la aduana', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await asignarAAduana(e, f, e.brianB); // un admin compartio la ficha con una segunda agencia (D-29)

    // Edward (interno) escribe, Charles (interno) lo reemplaza con motivo.
    await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', valor: 'De Edward', versionEsperada: 0 });
    await guardarCampo(e.ctx(e.charles), { referenciaId: f, campo: 'uso', valor: 'De Charles', versionEsperada: 1, motivo: 'Motivo interno confidencial' });
    // Brian (A) y Brenda (B) escriben en un campo de la aduana.
    await guardarCampo(e.ctx(e.brian), { referenciaId: f, campo: 'observaciones_aduana', valor: 'Nota de A', versionEsperada: 0 });
    await guardarCampo(e.ctx(e.brianB), { referenciaId: f, campo: 'observaciones_aduana', valor: 'Nota de B', versionEsperada: 1, motivo: 'Motivo de la agencia B' });

    // Historial del campo de la aduana visto por A: Brenda aparece como "Otra agencia" y su motivo no se ve.
    const hA = await historialDeCampo(e.db, e.brian, f, 'observaciones_aduana', ahora);
    expect(hA.map((x) => x.autor)).toEqual(['Otra agencia', 'Brian']);
    expect(hA[0]!.motivo).toBeNull();
    expect(hA[0]!.hayMotivoOculto).toBe(true);
    // Visto por B: Brian es "Otra agencia".
    const hB = await historialDeCampo(e.db, e.brianB, f, 'observaciones_aduana', ahora);
    expect(hB.map((x) => x.autor)).toEqual(['Brenda', 'Otra agencia']);
    expect(hB[0]!.motivo).toBe('Motivo de la agencia B');
    // Un interno ve los nombres y los motivos de ambas.
    const hI = await historialDeCampo(e.db, e.admin, f, 'observaciones_aduana', ahora);
    expect(hI.map((x) => x.autor)).toEqual(['Brenda', 'Brian']);
    expect(hI[0]!.motivo).toBe('Motivo de la agencia B');

    // El motivo de un reemplazo INTERNO no llega a la aduana (PA-38), pero el nombre del interno si.
    const usoA = await historialDeCampo(e.db, e.brian, f, 'uso', ahora);
    expect(usoA[0]).toMatchObject({ autor: 'Charles', motivo: null, hayMotivoOculto: true });
    const usoI = await historialDeCampo(e.db, e.admin, f, 'uso', ahora);
    expect(usoI[0]).toMatchObject({ autor: 'Charles', motivo: 'Motivo interno confidencial' });

    // La vista de la ficha tambien enmascara.
    const vA = await vistaFicha(e.db, e.brian, f, ahora);
    expect(vA.campos.observaciones_aduana!.autor).toBe('Otra agencia');
    expect(vA.campos.uso!.autor).toBe('Charles');
    const vB = await vistaFicha(e.db, e.brianB, f, ahora);
    expect(vB.campos.observaciones_aduana!.autor).toBe('Brenda');
  });
});

describe('regla rol x tipo de organizacion en la base (D-28, CA-19)', () => {
  it('la base rechaza un usuario de agencia con rol interno (CHECK)', async () => {
    for (const rol of ['admin', 'solicitante', 'lector']) {
      await rechazaCon(
        e.db.insert(usuario).values({ nombre: 'X', email: `x-${rol}@prueba.invalid`, rol, organizacionId: e.orgA, organizacionTipo: 'agencia' }),
        /usuario_agencia_solo_aduana/,
      );
    }
  });

  it('la base rechaza un tipo de organizacion que no coincide con la organizacion (clave foranea compuesta)', async () => {
    await rechazaCon(
      e.db.insert(usuario).values({ nombre: 'X', email: 'desfase@prueba.invalid', rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'interna' }),
      /usuario_organizacion_fk/,
    );
    // Y no se puede "cambiar" la organizacion de un usuario sin cambiar su tipo.
    await rechazaCon(
      e.db.update(usuario).set({ organizacionId: e.orgInterna }).where(eq(usuario.id, e.brian.usuarioId)),
      /usuario_organizacion_fk/,
    );
    const o = await e.db.select().from(organizacion).where(eq(organizacion.id, e.orgA));
    expect(o[0]!.tipo).toBe('agencia');
  });

  it('un correo se guarda en minusculas y es unico sin importar mayusculas', async () => {
    await rechazaCon(
      e.db.insert(usuario).values({ nombre: 'X', email: 'Brian@Prueba.invalid', rol: 'aduana', organizacionId: e.orgA, organizacionTipo: 'agencia' }),
      /usuario_email_minusculas/,
    );
  });
});

describe('versiones y proyeccion visibles solo a quien corresponde', () => {
  it('versionDe coincide con la vista', async () => {
    const f = await nuevaFicha(e);
    await guardarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', valor: 'x', versionEsperada: 0 });
    const v = await vistaFicha(e.db, e.edward, f, ahora);
    expect(v.campos.uso!.version).toBe(await versionDe(e.db, f, 'uso'));
  });
});
