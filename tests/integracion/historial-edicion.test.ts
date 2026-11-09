/**
 * Pruebas de historial por campo, restaurar valor anterior, conflicto de edicion (dejar el otro / usar el mio /
 * texto descartado), edicion en vivo (edicion_activa) y MEDIDA DE FILAS que deja cada operacion (para el limite gratuito).
 */
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { auditoria, campoHistorial, comentario, edicionActiva, notificacion, textoDescartado } from '@/db/esquema';
import { estadoFicha, latidoEdicion } from '@/server/acciones/estado-ficha';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { resolverConflicto } from '@/server/acciones/resolver-conflicto';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { archivar } from '@/server/acciones/aduana';
import { historialDeFichaDe } from '@/server/politicas/colaboracion';
import { nuevaFicha, nuevoEscenario, versionDe, type Escenario } from './ayudas';
import { DATOS_INSUMO, escribir } from './ayudas-aduana';

let e: Escenario;
/** Deja las medidas en la salida de la prueba cuando se pide detalle (VITEST_MEDIDAS=1); si no, no hace ruido. */
function medir(texto: string): void {
  if (process.env.VITEST_MEDIDAS === '1') console.info(texto);
}
const T0 = new Date('2026-11-02T15:00:00.000Z');

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

async function codigoError(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

async function filas() {
  const q = async (tabla: typeof campoHistorial | typeof auditoria | typeof notificacion | typeof comentario | typeof edicionActiva | typeof textoDescartado) =>
    (await e.db.select({ c: count() }).from(tabla))[0]!.c;
  return {
    historial: await q(campoHistorial),
    auditoria: await q(auditoria),
    notificacion: await q(notificacion),
    comentario: await q(comentario),
    edicion: await q(edicionActiva),
    descartado: await q(textoDescartado),
  };
}
const dif = (a: Awaited<ReturnType<typeof filas>>, b: Awaited<ReturnType<typeof filas>>) =>
  Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v - (a as Record<string, number>)[k]!]));

const escr = (actor: Escenario['edward'], id: string, campo: string, valor: unknown, motivo?: string, ahora = T0) =>
  versionDe(e.db, id, campo).then((v) => guardarCampo(e.ctx(actor, ahora), { referenciaId: id, campo, valor, versionEsperada: v, ...(motivo ? { motivo } : {}) }));

describe('MEDIDA: filas que deja cada operacion de edicion (evidencia para los limites gratuitos)', () => {
  it('guardar un campo propio = 1 fila de historial y NADA mas (sin auditoria, sin aviso, sin comentario)', async () => {
    const id = await nuevaFicha(e);
    const a = await filas();
    await escr(e.edward, id, 'uso', 'Primera version');
    await escr(e.edward, id, 'uso', 'Segunda version');
    await escr(e.edward, id, 'uso', 'Tercera version');
    expect(dif(a, await filas())).toEqual({ historial: 3, auditoria: 0, notificacion: 0, comentario: 0, edicion: 0, descartado: 0 });
  });

  it('un reintento con el mismo valor, o un intento con version vieja, no escribe NADA', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'Valor');
    const a = await filas();
    await escr(e.edward, id, 'uso', 'Valor'); // idempotente
    expect(await codigoError(guardarCampo(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', valor: 'Otro', versionEsperada: 0 }))).toBe('CONFLICTO');
    expect(dif(a, await filas())).toEqual({ historial: 0, auditoria: 0, notificacion: 0, comentario: 0, edicion: 0, descartado: 0 });
  });

  it('reemplazar el valor de otra persona = 1 historial + 1 aviso; restaurar = 1 historial + 1 auditoria (+1 aviso si el vigente es ajeno)', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'De Edward');
    const a = await filas();
    await escr(e.charles, id, 'uso', 'De Charles', 'La ficha tecnica corrige el uso');
    expect(dif(a, await filas())).toMatchObject({ historial: 1, notificacion: 1, auditoria: 0 });
    const b = await filas();
    const [v1] = await e.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, id), eq(campoHistorial.versionCampo, 1), eq(campoHistorial.campo, 'uso')));
    await restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'uso', historialId: v1!.id, motivo: 'Vuelvo al original' });
    expect(dif(b, await filas())).toMatchObject({ historial: 1, auditoria: 1, notificacion: 1 });
  });

  it('llenar una ficha de insumo completa (12 campos de ejemplo + 4 de la aduana) deja ~16 filas de historial y 0 de auditoria', async () => {
    const id = await nuevaFicha(e);
    const a = await filas();
    for (const [campo, valor] of DATOS_INSUMO) await escribir(e, e.edward, id, campo, valor);
    const d = dif(a, await filas());
    expect(d.historial).toBe(DATOS_INSUMO.length);
    expect(d.auditoria).toBe(0);
    medir(`[medida] ficha completa: +${d.historial} historial, +${d.auditoria} auditoria, +${d.notificacion} avisos`);
  });

  it('TAMANO en la base (PGlite = mismo formato que Postgres): bytes por fila de historial, aviso y auditoria, con 60 fichas x 16 campos', async () => {
    for (let i = 0; i < 60; i++) {
      const id = await nuevaFicha(e);
      for (const [campo, valor] of DATOS_INSUMO) await escribir(e, e.edward, id, campo, valor);
      for (const [campo, valor] of DATOS_INSUMO.slice(1, 4)) await escribir(e, e.charles, id, campo, `${String(valor)} (corregido)`, 'Correccion de prueba');
    }
    const q = async (tabla: string) => {
      const r = (await e.db.execute(sql.raw(`select pg_total_relation_size('${tabla}')::bigint as bytes, (select count(*) from ${tabla})::int as filas`))) as unknown as {
        rows: Array<{ bytes: string; filas: number }>;
      };
      const f = r.rows[0]!;
      return { tabla, filas: Number(f.filas), bytes: Number(f.bytes), porFila: Math.round(Number(f.bytes) / Math.max(1, Number(f.filas))) };
    };
    const medidas = [await q('campo_historial'), await q('notificacion'), await q('auditoria'), await q('referencia')];
    medir('[medida] tamano (incluye indices): ' + JSON.stringify(medidas));
    const hist = medidas[0]!;
    expect(hist.filas).toBeGreaterThan(60 * 16);
    expect(hist.porFila).toBeLessThan(2_000); // una fila de historial pesa menos de 2 KB con sus indices
  });
});

describe('historial por campo y restaurar el valor anterior', () => {
  it('cadena fijar -> vaciar -> restaurar: versiones 1..n sin huecos, solo la ultima es vigente, la restauracion apunta a su origen', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'A');
    await escr(e.edward, id, 'uso', 'B');
    await escr(e.edward, id, 'uso', null); // vaciar el propio
    const h0 = await e.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, id), eq(campoHistorial.campo, 'uso'))).orderBy(asc(campoHistorial.versionCampo));
    expect(h0.map((x) => [x.versionCampo, x.tipoEvento])).toEqual([
      [1, 'fijar'],
      [2, 'fijar'],
      [3, 'vaciar'],
    ]);
    await restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'uso', historialId: h0[0]!.id });
    const v = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'uso' });
    expect(v.items.map((x) => x.version)).toEqual([4, 3, 2, 1]); // del mas reciente al mas antiguo
    expect(v.items.filter((x) => x.vigente).map((x) => x.version)).toEqual([4]);
    expect(v.items[0]).toMatchObject({ tipoEvento: 'restaurar', restauraId: h0[0]!.id, valor: 'A', restaurable: false });
    expect(v.items.slice(1).every((x) => x.restaurable)).toBe(true);
    expect(v.campos.map((c) => c.clave)).toContain('uso');
    // restaurar la que ya es la vigente no escribe nada
    const antes = await filas();
    await restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'uso', historialId: h0[0]!.id });
    expect(dif(antes, await filas()).historial).toBe(0);
  });

  it('paginacion del historial: 45 cambios en una pagina de 40 + resto, sin repetir ni saltar ninguno', async () => {
    const id = await nuevaFicha(e);
    for (let i = 1; i <= 45; i++) await escr(e.edward, id, 'uso', `Version ${i}`);
    const p1 = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'uso', limite: 40 });
    expect(p1.items).toHaveLength(40);
    expect(p1.siguiente).not.toBeNull();
    const p2 = await historialDeFichaDe(e.db, e.edward, id, T0, { campo: 'uso', limite: 40, antes: p1.siguiente });
    expect(p2.items).toHaveLength(5);
    expect(p2.siguiente).toBeNull();
    const versiones = [...p1.items, ...p2.items].map((x) => x.version);
    expect(versiones).toEqual(Array.from({ length: 45 }, (_, i) => 45 - i));
  });

  it('una ficha archivada o clasificada no ofrece restaurar y el servidor tambien lo rechaza (FICHA_CERRADA)', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'X');
    await escr(e.edward, id, 'uso', 'Y');
    const [v1] = await e.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, id), eq(campoHistorial.versionCampo, 1), eq(campoHistorial.campo, 'uso')));
    await archivar(e.ctx(e.admin, T0), { referenciaId: id, motivo: 'Prueba' });
    expect(await codigoError(restaurarCampo(e.ctx(e.edward, T0), { referenciaId: id, campo: 'uso', historialId: v1!.id }))).toBe('FICHA_CERRADA');
    const h = await historialDeFichaDe(e.db, e.admin, id, T0, { campo: 'uso' });
    expect(h.items.every((x) => !x.restaurable)).toBe(true);
  });
});

describe('conflicto de edicion (9.5): dejar el otro / usar el mio / combinar, y el texto descartado', () => {
  it('guardar con version vieja = CONFLICTO sin escribir; «dejar el otro» conserva mi texto en texto_descartado SIN tocar el campo ni avisar', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'Lo que puso Edward');
    const a = await filas();
    expect(await codigoError(guardarCampo(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', valor: 'Lo que yo escribia', versionEsperada: 0 }))).toBe('CONFLICTO');
    const r = await resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'dejar', valor: 'Lo que yo escribia' });
    expect(r).toMatchObject({ opcion: 'dejar', version: 1, textoConservado: true });
    expect(dif(a, await filas())).toEqual({ historial: 0, auditoria: 0, notificacion: 0, comentario: 0, edicion: 0, descartado: 1 });
    const [t] = await e.db.select().from(textoDescartado).where(eq(textoDescartado.referenciaId, id));
    expect(t).toMatchObject({ campo: 'uso', usuarioId: e.charles.usuarioId, texto: 'Lo que yo escribia', motivoDescarte: 'conflicto_dejar_el_otro' });
    expect(await versionDe(e.db, id, 'uso')).toBe(1);
  });

  it('«usar el mio» sobre un valor ajeno exige motivo y avisa al autor; sobre uno propio no pide nada', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'Original de Edward');
    expect(await codigoError(resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'usar_mio', valor: 'Lo de Charles' }))).toBe('FALTA_MOTIVO');
    const a = await filas();
    const r = await resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'usar_mio', valor: 'Lo de Charles', motivo: 'Es lo que dice el catalogo' });
    expect(r.version).toBe(2);
    expect(dif(a, await filas())).toMatchObject({ historial: 1, notificacion: 1, descartado: 0 });
    const propio = await resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'usar_mio', valor: 'Lo de Charles, ajustado' });
    expect(propio.version).toBe(3);
  });

  it('«combinar» solo en campos de texto', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'unidad_medida', 'Kilogramos');
    expect(await codigoError(resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'unidad_medida', opcion: 'combinar', valor: 'Litros', motivo: 'x' }))).toBe('VALIDACION');
  });

  it('«dejar el otro» no duplica: 5 veces el mismo texto = 1 fila; un texto distinto o de otra persona si agrega la suya', async () => {
    const id = await nuevaFicha(e);
    await escr(e.edward, id, 'uso', 'Valor vigente');
    const a = await filas();
    for (let i = 0; i < 5; i++) await resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'dejar', valor: 'El mismo texto largo '.repeat(20) });
    expect(dif(a, await filas()).descartado).toBe(1);
    // otro texto de la misma persona, y el mismo texto de otra persona, son conservaciones distintas
    await resolverConflicto(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso', opcion: 'dejar', valor: 'Otro texto distinto' });
    await resolverConflicto(e.ctx(e.admin, T0), { referenciaId: id, campo: 'uso', opcion: 'dejar', valor: 'El mismo texto largo '.repeat(20) });
    expect(dif(a, await filas()).descartado).toBe(3);
  });
});

describe('edicion en vivo («X esta editando»)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('un latido vencido de una ficha abandonada se limpia cuando algun latido (de cualquier ficha) barre la tabla; mientras tanto no cuenta como «editando»', async () => {
    const f1 = await nuevaFicha(e);
    const f2 = await nuevaFicha(e);
    const base = (await filas()).edicion;
    await latidoEdicion(e.ctx(e.charles, T0), { referenciaId: f1, campo: 'uso' });
    // Charles se va a la ficha 2 una hora despues. La barrida es al azar (5 %): aqui se fuerza que no toque...
    const luego = new Date(T0.getTime() + 3_600_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await latidoEdicion(e.ctx(e.charles, luego), { referenciaId: f2, campo: 'uso' });
    expect((await filas()).edicion).toBe(base + 2);
    // ...y para los demas esa fila vencida ya no aparece como «editando»
    expect((await estadoFicha(e.ctx(e.edward, luego), { referenciaId: f1 })).editando).toEqual([]);
    // ...y cuando toca, el latido de OTRA ficha barre la vencida de la ficha abandonada.
    vi.spyOn(Math, 'random').mockReturnValue(0.01);
    await latidoEdicion(e.ctx(e.edward, luego), { referenciaId: f2, campo: 'funciones' });
    expect((await filas()).edicion).toBe(base + 2); // -1 (la vencida de f1) +1 (la nueva de Edward)
  });

  it('guardar el campo borra mi latido; la ficha clasificada o archivada no admite latido; una agencia sin acceso recibe 404', async () => {
    const id = await nuevaFicha(e);
    await latidoEdicion(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso' });
    expect((await estadoFicha(e.ctx(e.edward, T0), { referenciaId: id })).editando).toHaveLength(1);
    await escr(e.charles, id, 'uso', 'Guardado');
    expect((await estadoFicha(e.ctx(e.edward, T0), { referenciaId: id })).editando).toEqual([]);

    await archivar(e.ctx(e.admin, T0), { referenciaId: id, motivo: 'Prueba' });
    expect(await codigoError(latidoEdicion(e.ctx(e.charles, T0), { referenciaId: id, campo: 'uso' }))).toBe('FICHA_CERRADA');
    expect(await codigoError(estadoFicha(e.ctx(e.brian, T0), { referenciaId: id }))).toBe('NO_ENCONTRADO');
  });

  it('un latido de 15 personas sobre la misma ficha deja a lo sumo (personas x campos enfocados) filas y todas se ven entre si, nunca a si mismas', async () => {
    const id = await nuevaFicha(e);
    const personas = [e.edward, e.charles, e.admin];
    const campos = ['uso', 'funciones', 'marca'];
    for (const p of personas) for (const c of campos) await latidoEdicion(e.ctx(p, T0), { referenciaId: id, campo: c });
    const vistoPorEdward = await estadoFicha(e.ctx(e.edward, T0), { referenciaId: id });
    expect(vistoPorEdward.editando).toHaveLength(2 * campos.length);
    expect(vistoPorEdward.editando.every((x) => x.usuario !== 'Edward')).toBe(true);
  });
});
