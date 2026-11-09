/**
 * Job `db-real` (SPEC 17.1, 17.2, RV-24): P-01 y P-02 contra un Postgres REAL, con DOS conexiones
 * reales y conectando como el rol `app` (no duenio). PGlite no puede demostrar nada de esto:
 * corre como superusuario y es de una sola conexion.
 *
 * Pendiente de este job para H3: P-04 (outbox, doble despacho con FOR UPDATE SKIP LOCKED y fila
 * `enviando` vencida) -- el despachador se construye en H3.
 */
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, campoHistorial, organizacion, referencia, usuario } from '@/db/esquema';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import type { ErrorAccion } from '@/server/acciones/resultado';
import { restaurarCampo } from '@/server/acciones/restaurar-campo';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let edward: Actor;
let charles: Actor;
let admin: Actor;

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  const mk = async (nombre: string, email: string, rol: string) => {
    const [u] = await r.migrador.db
      .insert(usuario)
      .values({ nombre, email, rol, organizacionId: interna!.id, organizacionTipo: 'interna' })
      .returning({ id: usuario.id });
    return (await cargarActorPorId(r.app.db, u!.id))!;
  };
  admin = await mk('Ana Admin', 'ana@prueba.invalid', 'admin');
  edward = await mk('Edward', 'edward@prueba.invalid', 'solicitante');
  charles = await mk('Charles', 'charles@prueba.invalid', 'solicitante');
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

const ctx = (actor: Actor) => ({ db: r.app.db, actor });

let n = 0;
async function ficha(tipo: 'INSUMO' | 'REPUESTO' = 'INSUMO'): Promise<string> {
  n += 1;
  const x = await crearReferencia(ctx(edward), { codigo: `REAL-${n}`, nombreProducto: `Producto real ${n}`, tipoProducto: tipo });
  return x.id;
}

/** Ejecuta SQL con un cliente nuevo conectado COMO el rol indicado y devuelve el codigo SQLSTATE del error (o 'OK'). */
async function sqlComo(url: string, sentencia: string): Promise<{ codigo: string; mensaje: string }> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(sentencia);
    return { codigo: 'OK', mensaje: '' };
  } catch (e) {
    const x = e as { code?: string; message?: string };
    return { codigo: x.code ?? 'SIN_CODIGO', mensaje: x.message ?? '' };
  } finally {
    await c.end();
  }
}

describe('el entorno es Postgres real con dos roles', () => {
  it('es Postgres (no PGlite), la conexion de la app usa el rol app y no es duenio', async () => {
    expect(r.version).toMatch(/^\d+/);
    const c = new pg.Client({ connectionString: r.urlApp });
    await c.connect();
    const q = await c.query(`select current_user as quien, (select rolsuper from pg_roles where rolname = current_user) as su,
        (select tableowner from pg_tables where tablename = 'campo_historial') as duenio`);
    await c.end();
    expect(q.rows[0]).toMatchObject({ quien: 'app', su: false, duenio: 'migrador' });
  });
});

const INMUTABLES = ['campo_historial', 'auditoria', 'comentario', 'texto_descartado'] as const;

describe('P-01 en Postgres real: rol app (CA-13, D-31)', () => {
  beforeAll(async () => {
    const f = await ficha();
    await guardarCampo(ctx(edward), { referenciaId: f, campo: 'uso', valor: 'Uso', versionEsperada: 0 });
  });

  for (const t of INMUTABLES) {
    it(`${t}: como app, UPDATE / DELETE / TRUNCATE fallan por permisos (42501)`, async () => {
      for (const s of [`update ${t} set id = id`, `delete from ${t}`, `truncate ${t}`]) {
        const e = await sqlComo(r.urlApp, s);
        expect(e.codigo, s).toBe('42501');
      }
    });
  }

  it('como app NO se pueden quitar ni desactivar los triggers, ni cambiar duenio, ni reemplazar la funcion', async () => {
    for (const s of [
      'drop trigger campo_historial_solo_escritura on campo_historial',
      'alter table campo_historial disable trigger campo_historial_solo_escritura',
      'alter table campo_historial disable trigger all',
      'alter table campo_historial owner to app',
      'drop table campo_historial cascade',
      'drop function rechazar_cambio() cascade',
      "create or replace function rechazar_cambio() returns trigger language plpgsql as $$ begin return new; end $$",
      'create trigger intruso before insert on campo_historial for each statement execute function rechazar_cambio()',
      'set role migrador',
    ]) {
      const e = await sqlComo(r.urlApp, s);
      expect(e.codigo, s).toBe('42501');
    }
  });

  it('como app no puede re-otorgarse permisos (GRANT sin opcion de otorgar no concede nada)', async () => {
    await sqlComo(r.urlApp, 'grant update, delete, truncate on campo_historial to app');
    await sqlComo(r.urlApp, 'grant migrador to app');
    const e = await sqlComo(r.urlApp, 'update campo_historial set motivo = motivo');
    expect(e.codigo).toBe('42501');
    const priv = new pg.Client({ connectionString: r.urlApp });
    await priv.connect();
    const q = await priv.query(`select has_table_privilege('app', 'campo_historial', 'UPDATE') as upd,
        has_table_privilege('app', 'campo_historial', 'DELETE') as del,
        has_table_privilege('app', 'campo_historial', 'TRUNCATE') as trunc,
        has_table_privilege('app', 'campo_historial', 'INSERT') as ins,
        has_table_privilege('app', 'campo_historial', 'SELECT') as sel`);
    await priv.end();
    expect(q.rows[0]).toEqual({ upd: false, del: false, trunc: false, ins: true, sel: true });
  });

  it('incluso el duenio (migrador) choca con el trigger: segunda capa de defensa', async () => {
    for (const t of INMUTABLES) {
      for (const s of [`update ${t} set id = id`, `delete from ${t}`, `truncate ${t}`]) {
        const e = await sqlComo(r.urlMigrador, s);
        expect(e.codigo, s).toBe('P0001');
        expect(e.mensaje, s).toMatch(/solo escritura/);
      }
    }
  });

  it('permisos de columna: app no toca claves ni datos de creacion, ni borra datos de negocio', async () => {
    for (const s of [
      'update referencia set creada_por = creada_por',
      'update referencia set id = id',
      'update referencia set creada_en = creada_en',
      'update usuario set id = id',
      'delete from referencia',
      'delete from usuario',
      'delete from asignacion',
      'truncate referencia cascade',
      'truncate usuario cascade',
    ]) {
      const e = await sqlComo(r.urlApp, s);
      expect(e.codigo, s).toBe('42501');
    }
    // Lo que SI puede hacer la app.
    expect((await sqlComo(r.urlApp, "update referencia set version = version where false")).codigo).toBe('OK');
    expect((await sqlComo(r.urlApp, 'delete from session')).codigo).toBe('OK');
    expect((await sqlComo(r.urlApp, 'delete from limite_tasa')).codigo).toBe('OK');
    expect((await sqlComo(r.urlApp, 'delete from edicion_activa')).codigo).toBe('OK');
    expect((await sqlComo(r.urlApp, 'delete from notificacion')).codigo).toBe('OK'); // retencion diaria (migracion 0011)
  });

  it('la aplicacion funciona completa como app (los permisos alcanzan para el nucleo)', async () => {
    const f = await ficha('REPUESTO');
    await guardarCampo(ctx(edward), { referenciaId: f, campo: 'maquina_destino', valor: 'Biseladora', versionEsperada: 0 });
    await guardarCampo(ctx(charles), { referenciaId: f, campo: 'maquina_destino', valor: 'Prensa', versionEsperada: 1, motivo: 'Es la prensa' });
    const h = await r.app.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'maquina_destino')));
    await restaurarCampo(ctx(edward), { referenciaId: f, campo: 'maquina_destino', historialId: h[0]!.id, motivo: 'Vuelvo' });
    const a = await r.app.db.select().from(auditoria).where(eq(auditoria.entidadId, f));
    expect(a.some((x) => x.accion === 'restaurar')).toBe(true);
  });

  it('el valor del historial conserva su tipo JSON con el controlador pg (cadena "12.5" sigue siendo cadena)', async () => {
    const f = await ficha();
    // «Valor unitario» se retiro (E1): se usa un campo de texto vigente cuyo valor parece un numero.
    await guardarCampo(ctx(edward), { referenciaId: f, campo: 'uso', valor: '12.5', versionEsperada: 0 });
    const [h] = await r.app.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'uso')));
    expect(h!.valor).toBe('12.5');
    expect(typeof h!.valor).toBe('string');
  });
});

describe('P-02 en Postgres real: concurrencia por campo (CA-14, 9.5)', () => {
  it('dos guardarCampo simultaneos con la misma versionEsperada: UNA gana y la otra recibe CONFLICTO, sin perdida (30 rondas)', async () => {
    let conflictos = 0;
    for (let ronda = 0; ronda < 30; ronda++) {
      const f = await ficha();
      const resultados = await Promise.allSettled([
        guardarCampo(ctx(edward), { referenciaId: f, campo: 'funciones', valor: `Edward ${ronda}`, versionEsperada: 0 }),
        guardarCampo(ctx(charles), { referenciaId: f, campo: 'funciones', valor: `Charles ${ronda}`, versionEsperada: 0 }),
      ]);
      const ok = resultados.filter((x) => x.status === 'fulfilled');
      const mal = resultados.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
      expect(ok, `ronda ${ronda}`).toHaveLength(1);
      expect(mal, `ronda ${ronda}`).toHaveLength(1);
      expect((mal[0]!.reason as ErrorAccion).codigo, `ronda ${ronda}`).toBe('CONFLICTO');
      conflictos++;
      const h = await r.app.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'funciones')));
      expect(h, `ronda ${ronda}`).toHaveLength(1);
      const vigente = (mal[0]!.reason as ErrorAccion).detalle as { vigente: { valor: string; version: number } };
      expect(vigente.vigente.valor).toBe(h[0]!.valor);
      expect(vigente.vigente.version).toBe(1);
    }
    expect(conflictos).toBe(30);
  });

  it('diez escrituras simultaneas con la misma version: exactamente una entra y nueve reciben CONFLICTO', async () => {
    const f = await ficha();
    const resultados = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        guardarCampo(ctx(i % 2 === 0 ? edward : charles), { referenciaId: f, campo: 'uso', valor: `Intento ${i}`, versionEsperada: 0 }),
      ),
    );
    expect(resultados.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rechazos = resultados.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(rechazos).toHaveLength(9);
    expect(rechazos.every((x) => (x.reason as ErrorAccion).codigo === 'CONFLICTO')).toBe(true);
    const h = await r.app.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'uso')));
    expect(h).toHaveLength(1);
  });

  it('campos DISTINTOS de la misma ficha en paralelo: se conservan todos (el bloqueo de fila serializa la proyeccion)', async () => {
    const f = await ficha();
    const campos: Array<[string, unknown]> = [
      ['uso', 'U'],
      ['funciones', 'F'],
      ['proveedor', 'P'],
      ['fabricante', 'Fab'],
      ['tipo_empaque', 'Unidad'],
      ['informacion_adicional', 'I'],
      ['materia_constitutiva', 'M'],
      ['descripcion_factura', 'D'],
    ];
    const res = await Promise.allSettled(
      campos.map(([campo, valor], i) =>
        guardarCampo(ctx(i % 2 === 0 ? edward : charles), { referenciaId: f, campo, valor, versionEsperada: 0 }),
      ),
    );
    expect(res.every((x) => x.status === 'fulfilled')).toBe(true);
    const [fila] = await r.app.db.select().from(referencia).where(eq(referencia.id, f));
    for (const [campo, valor] of campos) expect(fila!.datos[campo]?.v, campo).toBe(valor);
    // La version de la ficha subio una vez por escritura (4 hechos iniciales + 8): ninguna se perdio.
    expect(fila!.version).toBe(1 + 4 + campos.length);
  });

  it('el mismo campo, escrituras SECUENCIALES validas en paralelo con version correcta no se pisan', async () => {
    const f = await ficha();
    await guardarCampo(ctx(edward), { referenciaId: f, campo: 'uso', valor: 'v1', versionEsperada: 0 });
    const res = await Promise.allSettled([
      guardarCampo(ctx(edward), { referenciaId: f, campo: 'uso', valor: 'v2-edward', versionEsperada: 1 }),
      guardarCampo(ctx(charles), { referenciaId: f, campo: 'uso', valor: 'v2-charles', versionEsperada: 1, motivo: 'por si acaso' }),
    ]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const [fila] = await r.app.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.datos.uso!.n).toBe(2);
  });

  it('dos creaciones simultaneas del mismo codigo (indice unico real): una ficha y un DUPLICADO', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await Promise.allSettled([
        crearReferencia(ctx(edward), { codigo: `CARRERA ${i}`, nombreProducto: 'x', tipoProducto: 'INSUMO' }),
        crearReferencia(ctx(charles), { codigo: `carrera-${i}`, nombreProducto: 'y', tipoProducto: 'INSUMO' }),
      ]);
      expect(res.filter((x) => x.status === 'fulfilled'), `ronda ${i}`).toHaveLength(1);
      const mal = res.find((x) => x.status === 'rejected') as PromiseRejectedResult;
      expect((mal.reason as ErrorAccion).codigo).toBe('DUPLICADO');
      const filas = await r.app.db.select().from(referencia).where(eq(referencia.codigoNorm, `CARRERA${i}`));
      expect(filas).toHaveLength(1);
    }
  });

  it('prueba de deriva en Postgres real: referencia.datos coincide con el historial', async () => {
    const f = await ficha();
    await guardarCampo(ctx(edward), { referenciaId: f, campo: 'uso', valor: 'A', versionEsperada: 0 });
    await guardarCampo(ctx(charles), { referenciaId: f, campo: 'uso', valor: 'B', versionEsperada: 1, motivo: 'm' });
    await guardarCampo(ctx(admin), { referenciaId: f, campo: 'uso', valor: '', versionEsperada: 2, motivo: 'vacio' });
    const [fila] = await r.app.db.select().from(referencia).where(eq(referencia.id, f));
    const hechos = await r.app.db.select().from(campoHistorial).where(eq(campoHistorial.referenciaId, f));
    const ultimo = new Map<string, (typeof hechos)[number]>();
    for (const h of hechos) {
      const p = ultimo.get(h.campo);
      if (!p || h.versionCampo > p.versionCampo) ultimo.set(h.campo, h);
    }
    expect(Object.keys(fila!.datos).sort()).toEqual([...ultimo.keys()].sort());
    for (const [campo, h] of ultimo) {
      expect(fila!.datos[campo]!.n, campo).toBe(h.versionCampo);
      expect(fila!.datos[campo]!.v, campo).toEqual(h.valor);
      expect(fila!.datos[campo]!.a, campo).toBe(h.autorId);
    }
  });
});
