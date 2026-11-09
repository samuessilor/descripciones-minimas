/**
 * La migracion 0003 (sin preguntas ni plantillas, DESVIACIONES 2026-10-27) aplica sobre una base que YA tiene
 * 0000-0002 y datos del modelo anterior: preguntas con respuestas `dm:<id>`, plantillas enlazadas a partidas,
 * avisos `pregunta`, correos en cola y presencia de edicion. Se arma la base vieja con las migraciones viejas
 * (las de `drizzle/` hasta la 0002) y despues se aplica la carpeta completa, igual que `npm run db:migrate`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearConexion, type Conexion } from '@/db/conexion';
import { migrar } from '@/db/migrar';

const DRIZZLE = resolve(process.cwd(), 'drizzle');
let carpetaVieja: string;
let c: Conexion;

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

/** Copia de `drizzle/` con el journal recortado a 0000-0002: la base queda como la tenia el equipo antes. */
function carpetaHasta0002(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dm-mig-0002-'));
  cpSync(DRIZZLE, dir, { recursive: true });
  const ruta = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(ruta, 'utf8')) as Journal;
  journal.entries = journal.entries.filter((e) => e.idx <= 2);
  writeFileSync(ruta, JSON.stringify(journal, null, 2));
  return dir;
}

/** Las migraciones que hay hoy en `drizzle/` (las posteriores a 0003 tambien se aplican sobre esta base). */
function totalMigraciones(): number {
  return (JSON.parse(readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as Journal).entries.length;
}

async function filas<T>(consulta: ReturnType<typeof sql>): Promise<T[]> {
  const r = await c.db.execute(consulta);
  return (Array.isArray(r) ? r : ((r as unknown as { rows: T[] }).rows ?? [])) as T[];
}

beforeAll(async () => {
  carpetaVieja = carpetaHasta0002();
  c = crearConexion({ pgliteDir: 'memory://' });
  await migrar(c, carpetaVieja);

  // Datos del modelo anterior, escritos con SQL crudo porque el esquema de hoy ya no conoce esas tablas.
  await c.db.execute(sql`insert into organizacion (id, nombre, tipo) values ('00000000-0000-4000-8000-0000000000a1', 'Interna', 'interna')`);
  await c.db.execute(
    sql`insert into usuario (id, nombre, email, organizacion_id, organizacion_tipo, rol)
        values ('00000000-0000-4000-8000-0000000000b1', 'Ana', 'ana@prueba.invalid', '00000000-0000-4000-8000-0000000000a1', 'interna', 'admin')`,
  );
  await c.db.execute(sql`insert into dm_plantilla (id, codigo, nombre) values ('00000000-0000-4000-8000-0000000000c1', 'DM-MOTOR', 'Motores')`);
  await c.db.execute(
    sql`insert into dm_plantilla_campo (plantilla_id, orden, clave, etiqueta, obligatoriedad)
        values ('00000000-0000-4000-8000-0000000000c1', 1, 'producto', 'Producto', 'obligatorio')`,
  );
  await c.db.execute(
    sql`insert into partida_arancelaria (codigo, dm_plantilla_id, origen) values ('8501.31.20.00', '00000000-0000-4000-8000-0000000000c1', 'semilla')`,
  );
  const datos = {
    uso: { v: 'Mover el eje', n: 1, a: '00000000-0000-4000-8000-0000000000b1', o: '00000000-0000-4000-8000-0000000000a1', t: '2026-10-01T10:00:00.000Z' },
    'dm:00000000-0000-4000-8000-0000000000d1': { v: { texto: 'motor' }, n: 1, a: '00000000-0000-4000-8000-0000000000b1', o: '00000000-0000-4000-8000-0000000000a1', t: '2026-10-01T10:00:00.000Z' },
  };
  await c.db.execute(
    sql`insert into referencia (id, codigo, codigo_norm, nombre_producto, tipo_producto, partida, datos, creada_por)
        values ('00000000-0000-4000-8000-0000000000e1', 'TEST-0001', 'TEST0001', 'Motor', 'REPUESTO', '8501.31.20.00', ${JSON.stringify(datos)}::jsonb, '00000000-0000-4000-8000-0000000000b1')`,
  );
  await c.db.execute(
    sql`insert into pregunta (id, referencia_id, origen, etiqueta, obligatoriedad, pedida_por)
        values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000e1', 'plantilla', 'Producto', 'obligatorio', '00000000-0000-4000-8000-0000000000b1')`,
  );
  await c.db.execute(
    sql`insert into campo_historial (referencia_id, campo, version_campo, tipo_evento, valor, autor_id, rol, organizacion_id)
        values ('00000000-0000-4000-8000-0000000000e1', 'dm:00000000-0000-4000-8000-0000000000d1', 1, 'fijar', '{"texto":"motor"}'::jsonb,
                '00000000-0000-4000-8000-0000000000b1', 'admin', '00000000-0000-4000-8000-0000000000a1')`,
  );
  await c.db.execute(
    sql`insert into notificacion (id, usuario_id, tipo, referencia_id, titulo)
        values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000b1', 'pregunta', '00000000-0000-4000-8000-0000000000e1', 'Hay preguntas')`,
  );
  await c.db.execute(
    sql`insert into entrega_correo (notificacion_id, destinatario, plantilla, clave_idempotencia, asunto, cuerpo_texto, cuerpo_html)
        values ('00000000-0000-4000-8000-0000000000f1', 'ana@prueba.invalid', 'pregunta', 'pregunta:1', 'a', 'b', 'c')`,
  );
  await c.db.execute(
    sql`insert into edicion_activa (referencia_id, campo, usuario_id, hasta)
        values ('00000000-0000-4000-8000-0000000000e1', 'dm:00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000b1', now())`,
  );

  // La migracion nueva, sobre esa base.
  await migrar(c);
}, 120_000);

afterAll(async () => {
  await c?.cerrar();
  if (carpetaVieja) rmSync(carpetaVieja, { recursive: true, force: true });
});

describe('migracion 0003 sobre una base con 0000-0002 y datos de preguntas', () => {
  it('quedan aplicadas todas las migraciones de la carpeta', async () => {
    const [m] = await filas<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(m!.n).toBe(totalMigraciones());
  });

  it('borra las tablas de preguntas y plantillas y la columna de la partida, y conserva la restriccion', async () => {
    const tablas = (await filas<{ t: string }>(sql`select tablename as t from pg_tables where schemaname = 'public'`)).map((x) => x.t);
    expect(tablas).not.toEqual(expect.arrayContaining(['pregunta']));
    expect(tablas).not.toContain('dm_plantilla');
    expect(tablas).not.toContain('dm_plantilla_campo');
    expect(tablas).toContain('restriccion_plantilla');
    const columnas = (await filas<{ c: string }>(sql`select column_name as c from information_schema.columns where table_name = 'partida_arancelaria'`)).map((x) => x.c);
    expect(columnas).not.toContain('dm_plantilla_id');
    expect(columnas).toContain('restriccion_id');
    const [p] = await filas<{ codigo: string }>(sql`select codigo from partida_arancelaria`);
    expect(p!.codigo).toBe('8501.31.20.00');
  });

  it('la proyeccion `datos` pierde las respuestas dm: pero el historial inmutable las conserva', async () => {
    const [r] = await filas<{ datos: Record<string, unknown> }>(sql`select datos from referencia`);
    expect(Object.keys(r!.datos)).toEqual(['uso']);
    const [h] = await filas<{ n: number }>(sql`select count(*)::int as n from campo_historial where campo like 'dm:%'`);
    expect(h!.n).toBe(1);
  });

  it('retira avisos `pregunta` y limpia la presencia de edicion (la cola de correo se retiro despues, en la 0007)', async () => {
    expect(await filas(sql`select id from notificacion where tipo = 'pregunta'`)).toHaveLength(0);
    const [cola] = await filas<{ existe: string | null }>(sql`select to_regclass('public.entrega_correo')::text as existe`);
    expect(cola!.existe).toBeNull();
    expect(await filas(sql`select campo from edicion_activa`)).toHaveLength(0);
    // El tipo `pregunta` ya no es valido.
    await expect(
      c.db.execute(
        sql`insert into notificacion (usuario_id, tipo, referencia_id, titulo)
            values ('00000000-0000-4000-8000-0000000000b1', 'pregunta', '00000000-0000-4000-8000-0000000000e1', 'x')`,
      ),
    ).rejects.toThrow();
  });

  it('volver a migrar no hace nada y los permisos del rol app se siguen aplicando', async () => {
    await migrar(c);
    const [m] = await filas<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(m!.n).toBe(totalMigraciones());
  });
});
