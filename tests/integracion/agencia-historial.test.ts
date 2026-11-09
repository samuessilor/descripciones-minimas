/**
 * Vista limitada del agente aduanero: una cuenta de agencia solo ve el historial de los campos del grupo aduana hechos
 * por SU organizacion. Del historial de lo que llena el area (producto, detalle, especificaciones), de los textos y
 * motivos de otros y de lo de otra agencia no llega nada: responde como si no existiera. Admin, solicitante y lector
 * siguen viendo todo. Cubre la lista global, el historial de un campo, el resumen «quien lo puso», el contexto del
 * panel, la hoja Historial del Excel y el cruce entre la regla pura (dominio) y la condicion SQL.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campoHistorial, limiteTasa } from '@/db/esquema';
import { CAMPOS } from '@/dominio/campos';
import { campoConHistorialVisible, CLAVES_HISTORIAL_ADUANA, eventoDeHistorialVisible, historialLimitado } from '@/dominio/permisos';
import { finalizar } from '@/server/acciones/aduana';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { fijarPartida } from '@/server/acciones/partida';
import { ErrorAccion } from '@/server/acciones/resultado';
import { COLUMNAS_HISTORIAL } from '@/server/exportar/columnas';
import { exportarBase } from '@/server/exportar';
import { contextoEnvioDe, historialDeFichaDe, resumenCamposDe } from '@/server/politicas/colaboracion';
import { historialDeCampo, vistaFicha } from '@/server/politicas/referencias';
import { asignarAAduana, nuevoEscenario, type Escenario } from './ayudas';
import { abrirLibro, escribir, fichaEnAduana } from './ayudas-aduana';

let e: Escenario;
let ficha: string;
let soloDeA: string;
const T0 = new Date('2026-10-21T15:00:00.000Z');

const GRUPO_A = new Set(CAMPOS.filter((c) => c.grupo === 'A').map((c) => c.clave));

async function codigo(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ErrorAccion) return err.codigo;
    throw err;
  }
  return 'NINGUNO';
}

beforeAll(async () => {
  e = await nuevoEscenario();

  // Una ficha con el area llena (Edward), un reemplazo interno con motivo (Charles), notas de aduana del admin y de
  // Brian, y una segunda agencia (Brenda) a la que un admin la comparte (D-29).
  ficha = await fichaEnAduana(e, { llena: true, codigo: 'AGH-0001', nombre: 'Ficha con historial mixto' });
  await escribir(e, e.edward, ficha, 'informacion_adicional', 'Primera version del area');
  await escribir(e, e.charles, ficha, 'informacion_adicional', 'Version corregida del area', 'Motivo interno confidencial');
  await escribir(e, e.admin, ficha, 'observaciones_aduana', 'Nota del admin');
  await escribir(e, e.brian, ficha, 'observaciones_aduana', 'Nota de Brian', 'Motivo de Brian');
  await escribir(e, e.brian, ficha, 'descripciones_minimas', 'Producto: limpiador\nUso: superficies');
  await fijarPartida(e.ctx(e.brian), { referenciaId: ficha, partida: '8479.90.00.00', versionEsperada: 0 });
  await asignarAAduana(e, ficha, e.brianB, e.admin);
  await escribir(e, e.brianB, ficha, 'restricciones', 'Restriccion de Brenda', 'Motivo de Brenda');

  // Una ficha solo de la agencia A: la B no debe ver nada.
  soloDeA = await fichaEnAduana(e, { llena: true, codigo: 'AGH-0002' });
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('la agencia recibe el historial global limitado a su zona y a su organizacion', () => {
  it('solo campos del grupo aduana hechos por Brian: ni el area, ni lo del admin, ni lo de otra agencia', async () => {
    const h = await historialDeFichaDe(e.db, e.brian, ficha, T0, { limite: 100 });
    expect(h.items.length).toBeGreaterThan(0);
    for (const i of h.items) {
      expect(GRUPO_A.has(i.campo), i.campo).toBe(true);
      expect(i.autor, `${i.campo} v${i.version}`).toBe('Brian');
    }
    const campos = new Set(h.items.map((i) => i.campo));
    expect(campos).toContain('descripciones_minimas');
    expect(campos).toContain('observaciones_aduana');
    expect(campos).toContain('requiere_rim');
    expect(campos).not.toContain('uso');
    expect(campos).not.toContain('informacion_adicional');

    // La lista de campos para filtrar tampoco delata campos del area ni de otra organizacion.
    expect(h.campos.every((c) => GRUPO_A.has(c.clave))).toBe(true);
    expect(h.campos.map((c) => c.clave)).not.toContain('informacion_adicional');

    // Nada de lo oculto se cuela en ningun texto: valores, motivos, nombres.
    const todo = JSON.stringify(h);
    for (const oculto of ['Primera version del area', 'Version corregida del area', 'Motivo interno confidencial', 'Nota del admin', 'Restriccion de Brenda', 'Brenda', 'Otra agencia', 'Charles', 'Edward']) {
      expect(todo, oculto).not.toContain(oculto);
    }
  });

  it('la paginacion cuenta solo lo visible: ninguna pagina trae huecos ni delata lo oculto', async () => {
    const todo = await historialDeFichaDe(e.db, e.brian, ficha, T0, { limite: 100 });
    const ids: number[] = [];
    let antes: number | null = null;
    for (let vueltas = 0; vueltas < 20; vueltas++) {
      const p = await historialDeFichaDe(e.db, e.brian, ficha, T0, { limite: 2, antes });
      expect(p.items.length).toBeLessThanOrEqual(2);
      ids.push(...p.items.map((i) => i.id));
      if (p.siguiente === null) break;
      expect(p.items).toHaveLength(2); // si hay mas, la pagina esta llena de eventos visibles
      antes = p.siguiente;
    }
    expect(ids).toEqual(todo.items.map((i) => i.id));
  });

  it('el historial de UN campo propio funciona; el de un campo del area o inexistente responde como si no existiera', async () => {
    const dm = await historialDeFichaDe(e.db, e.brian, ficha, T0, { campo: 'descripciones_minimas' });
    expect(dm.items).toHaveLength(1);
    expect(dm.items[0]).toMatchObject({ autor: 'Brian', valor: 'Producto: limpiador\nUso: superficies' });
    const obs = await historialDeFichaDe(e.db, e.brian, ficha, T0, { campo: 'observaciones_aduana' });
    expect(obs.items.map((i) => i.valor)).toEqual(['Nota de Brian']); // la nota previa del admin no llega
    expect(obs.items[0]!.motivo).toBe('Motivo de Brian'); // su propio motivo si

    for (const campo of ['uso', 'informacion_adicional', 'marca', 'respuesta_area', 'nombre_producto', 'campo_que_no_existe']) {
      expect(await codigo(historialDeFichaDe(e.db, e.brian, ficha, T0, { campo })), campo).toBe('NO_ENCONTRADO');
      expect(await codigo(historialDeCampo(e.db, e.brian, ficha, campo, T0)), campo).toBe('NO_ENCONTRADO');
    }
    // Un campo de la aduana donde tambien escribio otra agencia: solo salen las versiones de la organizacion de Brian.
    const rest = await historialDeFichaDe(e.db, e.brian, ficha, T0, { campo: 'restricciones' });
    expect(rest.items.length).toBeGreaterThan(0);
    expect(rest.items.every((i) => i.autor === 'Brian' && !i.valor.includes('Brenda'))).toBe(true);
    expect((await historialDeCampo(e.db, e.brian, ficha, 'restricciones', T0)).map((i) => i.autor)).toEqual(
      rest.items.map(() => 'Brian'),
    );
  });

  it('puede restaurar sus propias versiones pero el historial de otros no le ofrece nada', async () => {
    const obs = await historialDeFichaDe(e.db, e.brian, ficha, T0, { campo: 'observaciones_aduana' });
    expect(obs.items.every((i) => !i.restaurable || i.autor === 'Brian')).toBe(true);
  });
});

describe('«quien lo puso» y contexto del panel', () => {
  it('el resumen de campos de la agencia solo trae campos de su zona donde dejo huella, y avisa que es parcial', async () => {
    const r = await resumenCamposDe(e.db, e.brian, ficha, T0);
    expect(r.historialLimitado).toBe(true);
    const claves = r.campos.map((c) => c.clave);
    expect(claves).toContain('descripciones_minimas');
    expect(claves).toContain('observaciones_aduana');
    for (const c of claves) expect(GRUPO_A.has(c), c).toBe(true);
    expect(claves).not.toContain('uso');

    const interno = await resumenCamposDe(e.db, e.edward, ficha, T0);
    expect(interno.historialLimitado).toBe(false);
    expect(interno.campos.map((c) => c.clave)).toEqual(expect.arrayContaining(['uso', 'informacion_adicional', 'restricciones', 'observaciones_aduana']));
  });

  it('el contexto del panel dice que el historial de la agencia es limitado y el de los internos no', async () => {
    expect((await contextoEnvioDe(e.db, e.brian, ficha, T0)).historialLimitado).toBe(true);
    for (const actor of [e.admin, e.edward, e.lector]) expect((await contextoEnvioDe(e.db, actor, ficha, T0)).historialLimitado).toBe(false);
  });
});

describe('otra agencia, y roles que no cambian', () => {
  it('otra agencia sin acceso no recibe nada: ni historial global, ni de un campo, ni resumen', async () => {
    expect(await codigo(historialDeFichaDe(e.db, e.brianB, soloDeA, T0))).toBe('NO_ENCONTRADO');
    expect(await codigo(historialDeFichaDe(e.db, e.brianB, soloDeA, T0, { campo: 'requiere_rim' }))).toBe('NO_ENCONTRADO');
    expect(await codigo(historialDeCampo(e.db, e.brianB, soloDeA, 'requiere_rim', T0))).toBe('NO_ENCONTRADO');
    expect(await codigo(resumenCamposDe(e.db, e.brianB, soloDeA, T0))).toBe('NO_ENCONTRADO');
  });

  it('con la ficha compartida, cada agencia ve solo lo suyo (Brenda no ve lo de Brian)', async () => {
    const b = await historialDeFichaDe(e.db, e.brianB, ficha, T0, { limite: 100 });
    expect(b.items.map((i) => [i.campo, i.autor, i.valor])).toEqual([['restricciones', 'Brenda', 'Restriccion de Brenda']]);
    expect(JSON.stringify(b)).not.toMatch(/Brian|Nota de Brian|Motivo de Brian|limpiador/);
  });

  it('admin, solicitante y lector ven todo el historial, sin cambios', async () => {
    const total = (await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, ficha))).length;
    expect(total).toBeGreaterThan(20);
    for (const actor of [e.admin, e.edward, e.lector]) {
      const h = await historialDeFichaDe(e.db, actor, ficha, T0, { limite: 100 });
      expect(h.items, actor.rol).toHaveLength(total);
      expect(h.campos.map((c) => c.clave)).toEqual(expect.arrayContaining(['uso', 'informacion_adicional', 'restricciones']));
    }
    const interno = await historialDeFichaDe(e.db, e.admin, ficha, T0, { campo: 'informacion_adicional' });
    expect(interno.items[0]).toMatchObject({ motivo: 'Motivo interno confidencial', autor: 'Charles' });
    expect((await historialDeCampo(e.db, e.edward, ficha, 'uso', T0)).length).toBeGreaterThan(0);
  });

  it('el historial limitado no quita los VALORES de la ficha: la agencia ve todo lo vigente, escribe su grupo y marca clasificada', async () => {
    const v = await vistaFicha(e.db, e.brian, ficha, T0);
    expect(v.campos.uso!.valor).toBe('Preparar la superficie antes del recubrimiento (ejemplo).');
    expect(v.campos.informacion_adicional!.valor).toBe('Version corregida del area');
    expect(v.campos.observaciones_aduana!.valor).toBe('Nota de Brian');

    await escribir(e, e.brian, ficha, 'observaciones_aduana', 'Nota final de Brian');
    expect((await historialDeFichaDe(e.db, e.brian, ficha, T0, { campo: 'observaciones_aduana' })).items.map((i) => i.valor)).toEqual([
      'Nota final de Brian',
      'Nota de Brian',
    ]);

    const otra = await fichaEnAduana(e, { llena: true, codigo: 'AGH-0003' });
    await fijarPartida(e.ctx(e.brian), { referenciaId: otra, partida: '8421.39.90.00', versionEsperada: 0 });
    await finalizar(e.ctx(e.brian), { referenciaId: otra, motivoCerrarDeTodosModos: 'Prueba.' });
    const cierre = await historialDeFichaDe(e.db, e.brian, otra, T0, { campo: 'clasificacion_finalizada' });
    expect(cierre.items.map((i) => i.valor)).toContain('SI');
  });
});

describe('la regla pura (dominio) y la condicion SQL dicen lo mismo', () => {
  it('para cada actor, los eventos que devuelve el servidor son exactamente los que eventoDeHistorialVisible permite', async () => {
    const filas = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, ficha));
    for (const actor of [e.brian, e.brianB, e.admin, e.edward, e.lector]) {
      const esperados = filas.filter((f) => eventoDeHistorialVisible(actor, f)).map((f) => f.id).sort((a, b) => a - b);
      const h = await historialDeFichaDe(e.db, actor, ficha, T0, { limite: 100 });
      expect(h.items.map((i) => i.id).sort((a, b) => a - b), `${actor.rol} ${actor.usuarioId}`).toEqual(esperados);
    }
  });

  it('helpers puros: solo el rol aduana tiene historial limitado, y solo ve el grupo A', () => {
    expect(historialLimitado(e.brian)).toBe(true);
    for (const actor of [e.admin, e.edward, e.lector]) expect(historialLimitado(actor)).toBe(false);
    expect(campoConHistorialVisible(e.brian, 'uso')).toBe(false);
    expect(campoConHistorialVisible(e.brian, 'partida_arancelaria')).toBe(true);
    expect(campoConHistorialVisible(e.edward, 'uso')).toBe(true);
    // El catalogo manda: las claves visibles son exactamente las del grupo aduana.
    expect(new Set(CLAVES_HISTORIAL_ADUANA)).toEqual(GRUPO_A);
    // Un evento de otra organizacion en un campo propio del grupo A tampoco se ve.
    expect(eventoDeHistorialVisible(e.brian, { campo: 'restricciones', organizacionId: e.orgB })).toBe(false);
    expect(eventoDeHistorialVisible(e.brian, { campo: 'restricciones', organizacionId: e.orgA })).toBe(true);
    expect(eventoDeHistorialVisible(e.brian, { campo: 'uso', organizacionId: e.orgA })).toBe(false);
  });
});

describe('hoja «Historial» del Excel de la agencia', () => {
  async function historialExcel(actor: Escenario['brian']) {
    await e.db.delete(limiteTasa);
    const r = await exportarBase(e.ctx(actor, T0), { alcance: 'toda' });
    const libro = await abrirLibro(r.flujo);
    const hoja = libro.getWorksheet('Historial')!;
    const col = (clave: string) => COLUMNAS_HISTORIAL.findIndex((c) => c.clave === clave) + 1;
    const filas: Array<Record<string, string>> = [];
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      filas.push(Object.fromEntries(COLUMNAS_HISTORIAL.map((c) => [c.clave, fila.getCell(col(c.clave)).text])));
    });
    return { filas, libro, texto: JSON.stringify(hoja.getSheetValues()) };
  }

  it('solo trae los campos de aduana de su organizacion, no revela el valor anterior de otros y lo dice en la Leyenda', async () => {
    const a = await historialExcel(e.brian);
    expect(a.filas.length).toBeGreaterThan(0);
    const etiquetasGrupoA = new Set(CAMPOS.filter((c) => c.grupo === 'A').map((c) => c.etiqueta));
    for (const f of a.filas) {
      expect(etiquetasGrupoA.has(f.campo ?? ''), f.campo).toBe(true);
      expect(f.quien, f.campo).toBe('Brian');
    }
    for (const oculto of ['Primera version del area', 'Version corregida del area', 'Motivo interno confidencial', 'Nota del admin', 'Restriccion de Brenda']) {
      expect(a.texto, oculto).not.toContain(oculto);
    }
    // La nota de Brian reemplazo a la del admin: es un «Cambio», pero el valor anterior (del admin) no se muestra.
    const nota = a.filas.find((f) => f.campo === 'Observaciones de la aduana' && f.nuevo === 'Nota de Brian')!;
    expect(nota.evento).toBe('Cambio');
    expect(nota.anterior).toBe('No visible para tu rol');
    expect(nota.motivo).toBe('Motivo de Brian'); // su propio motivo si
    // Un cambio suyo sobre un valor suyo si trae el anterior.
    const final = a.filas.find((f) => f.nuevo === 'Nota final de Brian');
    // Si la fila no existe (prueba aislada o reordenada) debe fallar con ruido, no pasar en vacio.
    expect(final, 'la nota final de Brian la escribe una prueba anterior de este archivo').toBeDefined();
    expect(final!.anterior).toBe('Nota de Brian');

    const leyenda = a.libro.getWorksheet('Leyenda')!.getSheetValues().flat().join('|');
    expect(leyenda).toContain('Historial limitado a la zona de aduana');
  });

  it('la otra agencia (Brenda) solo ve lo suyo; el admin sigue recibiendo todo sin la nota de limitacion', async () => {
    const b = await historialExcel(e.brianB);
    expect(b.filas.map((f) => [f.campo, f.quien])).toEqual([['Restricciones', 'Brenda']]);
    expect(b.texto).not.toContain('Nota de Brian');

    const admin = await historialExcel(e.admin);
    expect(admin.filas.some((f) => f.campo === 'Uso')).toBe(true);
    expect(admin.filas.some((f) => f.quien === 'Charles' && f.motivo === 'Motivo interno confidencial')).toBe(true);
    expect(admin.libro.getWorksheet('Leyenda')!.getSheetValues().flat().join('|')).not.toContain('Historial limitado');
  });
});

describe('restaurar un valor no filtra el historial que la agencia no ve', () => {
  it('un id adivinado de un evento ajeno responde NO_ENCONTRADO y no cambia el valor vigente', async () => {
    const [delAdmin] = await e.db.select().from(campoHistorial).where(eq(campoHistorial.campo, 'observaciones_aduana'));
    const todos = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, ficha));
    const ajeno = todos.find((f) => f.campo === 'observaciones_aduana' && f.valor === 'Nota del admin');
    expect(delAdmin).toBeDefined();
    expect(ajeno, 'evento del admin en observaciones_aduana').toBeDefined();
    const antes = await vistaFicha(e.db, e.brian, ficha, T0);
    const err = await codigo(restaurarCampo(e.ctx(e.brian, T0), { referenciaId: ficha, campo: 'observaciones_aduana', historialId: ajeno!.id, motivo: 'x' }));
    expect(err).toBe('NO_ENCONTRADO');
    const despues = await vistaFicha(e.db, e.brian, ficha, T0);
    expect(JSON.stringify(despues)).toBe(JSON.stringify(antes));
  });

  it('un evento propio si se puede restaurar (el comportamiento normal no cambia)', async () => {
    const todos = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, ficha));
    const propio = todos.find((f) => f.campo === 'observaciones_aduana' && f.valor === 'Nota de Brian');
    expect(propio, 'evento propio de Brian').toBeDefined();
    const r = await restaurarCampo(e.ctx(e.brian, T0), { referenciaId: ficha, campo: 'observaciones_aduana', historialId: propio!.id, motivo: 'vuelvo a mi nota' });
    expect(r.valor).toBe('Nota de Brian');
  });
});
