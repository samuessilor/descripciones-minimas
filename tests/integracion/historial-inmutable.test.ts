/**
 * P-01 (en PGlite: el TRIGGER) y prueba de deriva (SPEC 9.4, CA-13).
 * Los permisos del rol `app` se prueban en tests/db-real (PGlite corre como superusuario).
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, campoHistorial, comentario, referencia, textoDescartado } from '@/db/esquema';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { resolverConflicto } from '@/server/acciones/resolver-conflicto';
import { auditar } from '@/server/auditoria';
import { nuevoEscenario, nuevaFicha, rechazaCon, versionDe, type Escenario } from './ayudas';

let e: Escenario;
let ficha: string;

beforeAll(async () => {
  e = await nuevoEscenario();
  ficha = await nuevaFicha(e);
});
afterAll(async () => {
  await e.c.cerrar();
});

const TABLAS = ['campo_historial', 'auditoria', 'comentario', 'texto_descartado'] as const;

describe('P-01: tablas append-only con trigger por sentencia (D-31, CA-13)', () => {
  beforeAll(async () => {
    await guardarCampo(e.ctx(e.edward), {
      referenciaId: ficha,
      campo: 'uso',
      valor: 'Uso inicial',
      versionEsperada: 0,
    });
    await auditar(e.db, { usuarioId: e.admin.usuarioId, accion: 'login', entidad: 'usuario', entidadId: e.admin.usuarioId });
    await e.db.insert(comentario).values({
      referenciaId: ficha,
      autorId: e.edward.usuarioId,
      texto: 'Comentario inmutable',
      visibilidad: 'todos',
    });
    await e.db.insert(textoDescartado).values({
      referenciaId: ficha,
      campo: 'uso',
      usuarioId: e.edward.usuarioId,
      texto: 'Texto que no llego a ser valor',
      motivoDescarte: 'conflicto_dejar_el_otro',
    });
  });

  for (const tabla of TABLAS) {
    it(`${tabla}: UPDATE falla`, async () => {
      await rechazaCon(e.db.execute(sql.raw(`update ${tabla} set id = id`)), /solo escritura/);
    });
    it(`${tabla}: DELETE falla`, async () => {
      await rechazaCon(e.db.execute(sql.raw(`delete from ${tabla}`)), /solo escritura/);
    });
    it(`${tabla}: TRUNCATE falla`, async () => {
      await rechazaCon(e.db.execute(sql.raw(`truncate ${tabla}`)), /solo escritura/);
    });
    it(`${tabla}: ni siquiera un UPDATE/DELETE que no toca filas (trigger por sentencia)`, async () => {
      await rechazaCon(e.db.execute(sql.raw(`delete from ${tabla} where false`)), /solo escritura/);
    });
    it(`${tabla}: TRUNCATE ... CASCADE desde otra tabla tampoco lo vacia`, async () => {
      await rechazaCon(e.db.execute(sql.raw('truncate referencia cascade')), /solo escritura/);
    });
    it(`${tabla}: INSERT sigue funcionando y el contenido sobrevive a los intentos`, async () => {
      const r = (await e.db.execute(sql.raw(`select count(*)::int as n from ${tabla}`))) as unknown as { rows: Array<{ n: number }> };
      expect(r.rows[0]!.n).toBeGreaterThan(0);
    });
  }

  it('el mensaje del error es claro y menciona la tabla y la operacion', async () => {
    await rechazaCon(
      e.db.update(campoHistorial).set({ motivo: 'x' }).where(eq(campoHistorial.referenciaId, ficha)),
      /campo_historial no admite UPDATE/,
    );
  });

  it('un UPDATE dentro de una transaccion tambien se rechaza y la transaccion no deja efectos', async () => {
    await rechazaCon(
      e.db.transaction(async (tx) => {
        await tx.insert(auditoria).values({ accion: 'login', entidad: 'x', entidadId: 'tx' });
        await tx.update(auditoria).set({ accion: 'login_fallido' });
      }),
      /solo escritura/,
    );
    const filas = await e.db.select().from(auditoria).where(eq(auditoria.entidadId, 'tx'));
    expect(filas).toHaveLength(0);
  });

  it('referencia.datos SI es mutable (proyeccion), pero nunca queda en desacuerdo con el historial', async () => {
    await expect(e.db.update(referencia).set({ version: 99 }).where(eq(referencia.id, ficha))).resolves.toBeDefined();
    await e.db.update(referencia).set({ version: 3 }).where(eq(referencia.id, ficha));
  });
});

/** Reconstruye `datos` desde el historial: ultimo hecho por campo. */
async function reconstruir(referenciaId: string) {
  const filas = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, referenciaId));
  const ultimo = new Map<string, (typeof filas)[number]>();
  for (const f of filas) {
    const previo = ultimo.get(f.campo);
    if (!previo || f.versionCampo > previo.versionCampo) ultimo.set(f.campo, f);
  }
  return ultimo;
}

describe('prueba de deriva (9.4): reconstruir referencia.datos desde campo_historial', () => {
  it('coincide tras una secuencia de creacion, ediciones ajenas con motivo, restauracion y conflictos', async () => {
    const f = await nuevaFicha(e, { tipo: 'REPUESTO' });
    const g = (campo: string, valor: unknown, quien = e.edward, motivo?: string) =>
      versionDe(e.db, f, campo).then((v) =>
        guardarCampo(e.ctx(quien), { referenciaId: f, campo, valor, versionEsperada: v, motivo }),
      );

    await g('uso', 'A');
    await g('uso', 'B', e.charles, 'Lo corrijo');
    await g('marca', { texto: 'ACME' });
    await g('tipo_empaque', 'Bidón');
    await g('cantidad_empaque', '20 litros');
    await g('requiere_rim', 'SI', e.admin); // lo responde la aduana (o el admin)
    await g('pais_origen', 'FR');
    await g('uso', '', e.admin, 'Lo dejo para revisar');
    const hist = await e.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, f));
    const uso1 = hist.find((h) => h.campo === 'uso' && h.versionCampo === 1)!;
    await restaurarCampo(e.ctx(e.edward), { referenciaId: f, campo: 'uso', historialId: uso1.id, motivo: 'Vuelvo al original' });
    // conflicto resuelto con "dejar": no cambia versiones pero guarda el texto
    await resolverConflicto(e.ctx(e.charles), { referenciaId: f, campo: 'uso', opcion: 'dejar', valor: 'mi texto' });

    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    const ultimo = await reconstruir(f);
    expect(Object.keys(fila!.datos).sort()).toEqual([...ultimo.keys()].sort());
    for (const [campo, h] of ultimo) {
      const e1 = fila!.datos[campo]!;
      expect(e1.n, campo).toBe(h.versionCampo);
      expect(e1.a, campo).toBe(h.autorId);
      expect(e1.o, campo).toBe(h.organizacionId);
      expect(e1.v, campo).toEqual(h.valor);
      expect(new Date(e1.t).getTime(), campo).toBe(h.creadoEn.getTime());
    }
    // Columnas promovidas consistentes con la proyeccion.
    expect(fila!.codigo).toBe(fila!.datos.codigo!.v);
    expect(fila!.nombreProducto).toBe(fila!.datos.nombre_producto!.v);
    expect(fila!.tipoProducto).toBe(fila!.datos.tipo_producto!.v);
    expect(fila!.fechaSolicitud).toBe(fila!.datos.fecha_solicitud!.v);
  });
});
