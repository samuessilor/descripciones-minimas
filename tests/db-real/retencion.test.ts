/**
 * Retencion contra un Postgres REAL conectando COMO el rol `app` (no duenio, D-31): la migracion 0011 le otorga
 * DELETE sobre `notificacion` y la retencion completa corre con ese rol; las tablas inmutables siguen sin DELETE.
 * PGlite corre como superusuario y no puede demostrar nada de esto.
 */
import { count, eq, sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, edicionActiva, limiteTasa, notificacion, organizacion, referencia, session, usuario, verification } from '@/db/esquema';
import { ejecutarRetencion } from '@/server/retencion';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let usuarioId: string;
let fichaId: string;
const DIA = 86_400_000;

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  const [u] = await r.migrador.db
    .insert(usuario)
    .values({ nombre: 'Edward', email: 'edward@prueba.invalid', rol: 'solicitante', organizacionId: interna!.id, organizacionTipo: 'interna' })
    .returning({ id: usuario.id });
  usuarioId = u!.id;
  const [f] = await r.migrador.db
    .insert(referencia)
    .values({ codigo: 'RET-1', codigoNorm: 'RET-1', nombreProducto: 'Producto', tipoProducto: 'INSUMO', creadaPor: usuarioId, fechaSolicitud: '2026-11-02' })
    .returning({ id: referencia.id });
  fichaId = f!.id;
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

/** Ejecuta SQL con un cliente nuevo conectado como `url` y devuelve el SQLSTATE del error (o 'OK'). */
async function sqlComo(url: string, sentencia: string): Promise<string> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sentencia);
    return 'OK';
  } catch (e) {
    return (e as { code?: string }).code ?? 'SIN_CODIGO';
  } finally {
    await c.end();
  }
}

describe('permisos del rol app tras la migracion 0011', () => {
  it('puede borrar notificacion (y las otras tablas operativas con borrado)', async () => {
    const c = new pg.Client({ connectionString: r.urlApp });
    await c.connect();
    const q = await c.query(
      `select t, has_table_privilege('app', t, 'DELETE') as borrar, has_table_privilege('app', t, 'INSERT') as insertar
         from unnest(array['notificacion','session','verification','edicion_activa','limite_tasa']) as t`,
    );
    await c.end();
    for (const fila of q.rows as Array<{ t: string; borrar: boolean; insertar: boolean }>) {
      expect(fila.borrar, fila.t).toBe(true);
      expect(fila.insertar, fila.t).toBe(true);
    }
  });

  it('SIGUE sin poder borrar, actualizar ni truncar campo_historial, auditoria, comentario ni texto_descartado', async () => {
    for (const t of ['campo_historial', 'auditoria', 'comentario', 'texto_descartado']) {
      for (const s of [`delete from ${t}`, `update ${t} set id = id`, `truncate ${t}`]) {
        expect(await sqlComo(r.urlApp, s), s).toBe('42501');
      }
    }
  });

  it('en notificacion solo se libera DELETE y la renovacion de un aviso: no se truncan ni se cambia su id; el resto de creada_en/creado_en sigue protegido', async () => {
    expect(await sqlComo(r.urlApp, 'truncate notificacion')).toBe('42501');
    expect(await sqlComo(r.urlApp, 'update notificacion set id = id')).toBe('42501');
    // Renovar un aviso sin leer (titulo y hora) lo hace crear.ts al agrupar avisos repetidos
    expect(await sqlComo(r.urlApp, 'update notificacion set titulo = titulo, creada_en = creada_en')).toBe('OK');
    // ... pero ninguna otra columna de creacion se libera
    expect(await sqlComo(r.urlApp, 'update asignacion set creada_en = creada_en')).toBe('42501');
    expect(await sqlComo(r.urlApp, 'update referencia set creada_por = creada_por')).toBe('42501');
  });

  it('la migracion es idempotente: volver a aplicar los permisos no cambia nada', async () => {
    await r.migrador.db.execute(sql`select public.aplicar_permisos_app()`);
    const c = new pg.Client({ connectionString: r.urlApp });
    await c.connect();
    const q = await c.query(`select has_table_privilege('app', 'notificacion', 'DELETE') as borrar, has_table_privilege('app', 'campo_historial', 'DELETE') as inmutable`);
    await c.end();
    expect(q.rows[0]).toEqual({ borrar: true, inmutable: false });
  });
});

describe('ejecutarRetencion corriendo como el rol app', () => {
  it('borra lo vencido en las seis reglas, respeta lo reciente y deja la fila de auditoria', async () => {
    const ahora = new Date();
    const hace = (ms: number) => new Date(ahora.getTime() - ms);
    await r.app.db.insert(notificacion).values([
      { usuarioId, tipo: 'comentario', referenciaId: fichaId, titulo: 'leido viejo', leidaEn: hace(40 * DIA), creadaEn: hace(41 * DIA) },
      { usuarioId, tipo: 'comentario', referenciaId: fichaId, titulo: 'sin leer viejo', creadaEn: hace(100 * DIA) },
      { usuarioId, tipo: 'comentario', referenciaId: fichaId, titulo: 'sin leer reciente', creadaEn: hace(DIA) },
      { usuarioId, tipo: 'comentario', referenciaId: fichaId, titulo: 'leido reciente', leidaEn: hace(DIA), creadaEn: hace(2 * DIA) },
    ]);
    await r.app.db.insert(limiteTasa).values([
      { clave: 'x', ventana: hace(3 * DIA), contador: 1 },
      { clave: 'x', ventana: hace(60_000), contador: 1 },
    ]);
    await r.app.db.insert(edicionActiva).values([
      { referenciaId: fichaId, campo: 'uso', usuarioId, hasta: hace(2 * 3_600_000) },
      { referenciaId: fichaId, campo: 'funciones', usuarioId, hasta: new Date(ahora.getTime() + 45_000) },
    ]);
    await r.app.db.insert(session).values([
      { expiresAt: hace(8 * DIA), token: 't1', userId: usuarioId },
      { expiresAt: new Date(ahora.getTime() + DIA), token: 't2', userId: usuarioId },
    ]);
    await r.app.db.insert(verification).values([
      { identifier: 'a', value: '1', expiresAt: hace(2 * DIA) },
      { identifier: 'b', value: '2', expiresAt: new Date(ahora.getTime() + 3_600_000) },
    ]);

    const res = await ejecutarRetencion(r.app.db, { ahora });
    expect(res).toMatchObject({
      avisosLeidos: 1,
      avisosSinLeer: 1,
      limiteTasa: 1,
      edicionesVencidas: 1,
      sesiones: 1,
      verificaciones: 1,
      total: 6,
      quedaPendiente: false,
    });

    const titulos = (await r.migrador.db.select({ t: notificacion.titulo }).from(notificacion)).map((x) => x.t).sort();
    expect(titulos).toEqual(['leido reciente', 'sin leer reciente']);
    const [filas] = await r.migrador.db.select({ c: count() }).from(auditoria).where(eq(auditoria.accion, 'retencion'));
    expect(filas!.c).toBe(1);

    // Idempotente: la segunda pasada no borra ni audita nada.
    expect((await ejecutarRetencion(r.app.db, { ahora })).total).toBe(0);
    const [despues] = await r.migrador.db.select({ c: count() }).from(auditoria).where(eq(auditoria.accion, 'retencion'));
    expect(despues!.c).toBe(1);
  });

  it('por lotes pequenos tambien termina (la subconsulta con LIMIT y la clave compuesta funcionan en Postgres real)', async () => {
    const ahora = new Date();
    const viejo = new Date(ahora.getTime() - 5 * DIA);
    await r.app.db.insert(limiteTasa).values(Array.from({ length: 9 }, (_, i) => ({ clave: `lote-${i}`, ventana: viejo, contador: 1 })));
    const res = await ejecutarRetencion(r.app.db, { ahora, lote: 4 });
    expect(res.limiteTasa).toBe(9);
    expect(res.quedaPendiente).toBe(false);
  });
});
