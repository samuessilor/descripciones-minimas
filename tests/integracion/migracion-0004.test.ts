/**
 * La migracion 0004 (tipo de producto «Montura», reunion con el area 2026-10-29) aplica sobre una base que YA tiene
 * 0000-0003 y fichas del modelo anterior (con valor unitario, cantidad a radicar y primer clasificador en `datos`).
 * Se arma la base vieja con las migraciones hasta la 0003 y despues se aplica la carpeta completa, igual que
 * `npm run db:migrate`.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearConexion, type Conexion } from '@/db/conexion';
import { migrar } from '@/db/migrar';

const DRIZZLE = resolve(process.cwd(), 'drizzle');
const ORG = '00000000-0000-4000-8000-0000000000a1';
const ANA = '00000000-0000-4000-8000-0000000000b1';
let carpetaVieja: string;
let c: Conexion;

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

function carpetaHasta0003(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dm-mig-0003-'));
  cpSync(DRIZZLE, dir, { recursive: true });
  const ruta = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(ruta, 'utf8')) as Journal;
  journal.entries = journal.entries.filter((e) => e.idx <= 3);
  writeFileSync(ruta, JSON.stringify(journal, null, 2));
  return dir;
}

async function filas<T>(consulta: ReturnType<typeof sql>): Promise<T[]> {
  const r = await c.db.execute(consulta);
  return (Array.isArray(r) ? r : ((r as unknown as { rows: T[] }).rows ?? [])) as T[];
}

const insertarFicha = (id: string, codigo: string, tipo: string, datos: Record<string, unknown> = {}) =>
  c.db.execute(
    sql`insert into referencia (id, codigo, codigo_norm, nombre_producto, tipo_producto, datos, creada_por)
        values (${id}, ${codigo}, ${codigo.replace(/\W/g, '')}, 'Ficha', ${tipo}, ${JSON.stringify(datos)}::jsonb, ${ANA})`,
  );

beforeAll(async () => {
  carpetaVieja = carpetaHasta0003();
  c = crearConexion({ pgliteDir: 'memory://' });
  await migrar(c, carpetaVieja);
  await c.db.execute(sql`insert into organizacion (id, nombre, tipo) values (${ORG}, 'Interna', 'interna')`);
  await c.db.execute(
    sql`insert into usuario (id, nombre, email, organizacion_id, organizacion_tipo, rol) values (${ANA}, 'Ana', 'ana@prueba.invalid', ${ORG}, 'interna', 'admin')`,
  );
  const e = (v: unknown) => ({ v, n: 1, a: ANA, o: ORG, t: '2026-10-01T10:00:00.000Z' });
  await insertarFicha('00000000-0000-4000-8000-0000000000e1', 'VIEJA-1', 'REPUESTO', {
    valor_unitario: e('137.74'),
    cantidad_a_radicar: e({ valor: '156', expresion: '13x12' }),
    primer_clasificador: e({ usuario_id: ANA }),
  });
  // Antes de 0004 la montura no era un tipo valido.
  await expect(insertarFicha('00000000-0000-4000-8000-0000000000e2', 'MONT-0', 'MONTURA')).rejects.toThrow();

  await migrar(c);
}, 120_000);

afterAll(async () => {
  await c?.cerrar();
  if (carpetaVieja) rmSync(carpetaVieja, { recursive: true, force: true });
});

describe('migracion 0004 sobre una base con 0000-0003', () => {
  it('admite el tipo MONTURA y sigue rechazando un tipo inventado', async () => {
    await insertarFicha('00000000-0000-4000-8000-0000000000e3', 'MONT-1', 'MONTURA');
    const [r] = await filas<{ tipo: string }>(sql`select tipo_producto as tipo from referencia where codigo = 'MONT-1'`);
    expect(r!.tipo).toBe('MONTURA');
    await expect(insertarFicha('00000000-0000-4000-8000-0000000000e4', 'X-1', 'LENTE')).rejects.toThrow();
  });

  it('no toca los datos viejos: los campos retirados siguen en la ficha y en el historial (solo dejan de mostrarse)', async () => {
    const [r] = await filas<{ datos: Record<string, unknown> }>(sql`select datos from referencia where codigo = 'VIEJA-1'`);
    expect(Object.keys(r!.datos).sort()).toEqual(['cantidad_a_radicar', 'primer_clasificador', 'valor_unitario']);
  });

  it('volver a migrar no hace nada', async () => {
    const total = (JSON.parse(readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as Journal).entries.length;
    await migrar(c);
    const [m] = await filas<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(m!.n).toBe(total);
  });
});
