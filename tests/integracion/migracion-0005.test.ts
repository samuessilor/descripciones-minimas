/**
 * La migracion 0005 (areas fijas y «Área responsable», reunion con el area 2026-10-29) aplica sobre una base que YA
 * tiene 0000-0003 con usuarios de area en texto libre y fichas sin area responsable. Se arma la base vieja con las
 * migraciones hasta la 0003 y despues se aplica la carpeta completa (0004 y 0005), igual que `npm run db:migrate`.
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
const AGENCIA = '00000000-0000-4000-8000-0000000000a2';
const U = {
  insumos: '00000000-0000-4000-8000-0000000000b1',
  mant: '00000000-0000-4000-8000-0000000000b2',
  otra: '00000000-0000-4000-8000-0000000000b3',
  sin: '00000000-0000-4000-8000-0000000000b4',
  agencia: '00000000-0000-4000-8000-0000000000b5',
};
let carpetaVieja: string;
let c: Conexion;

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

function carpetaHasta(idx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'dm-mig-0005-'));
  cpSync(DRIZZLE, dir, { recursive: true });
  const ruta = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(ruta, 'utf8')) as Journal;
  journal.entries = journal.entries.filter((e) => e.idx <= idx);
  writeFileSync(ruta, JSON.stringify(journal, null, 2));
  return dir;
}

async function filas<T>(consulta: ReturnType<typeof sql>): Promise<T[]> {
  const r = await c.db.execute(consulta);
  return (Array.isArray(r) ? r : ((r as unknown as { rows: T[] }).rows ?? [])) as T[];
}

const usuarioViejo = (id: string, email: string, area: string | null, org = ORG, tipo = 'interna', rol = 'solicitante') =>
  c.db.execute(
    sql`insert into usuario (id, nombre, email, organizacion_id, organizacion_tipo, rol, area) values (${id}, ${email}, ${email}, ${org}, ${tipo}, ${rol}, ${area})`,
  );

const fichaVieja = (codigo: string, autor: string, datos: Record<string, unknown> = {}) =>
  c.db.execute(
    sql`insert into referencia (codigo, codigo_norm, nombre_producto, tipo_producto, datos, creada_por)
        values (${codigo}, ${codigo.replace(/\W/g, '')}, 'Ficha', 'REPUESTO', ${JSON.stringify(datos)}::jsonb, ${autor})`,
  );

beforeAll(async () => {
  carpetaVieja = carpetaHasta(3);
  c = crearConexion({ pgliteDir: 'memory://' });
  await migrar(c, carpetaVieja);
  await c.db.execute(sql`insert into organizacion (id, nombre, tipo) values (${ORG}, 'Interna', 'interna'), (${AGENCIA}, 'Agencia', 'agencia')`);
  await usuarioViejo(U.insumos, 'insumos@prueba.invalid', ' Insumos ');
  await usuarioViejo(U.mant, 'mant@prueba.invalid', 'MANTENIMIENTO');
  await usuarioViejo(U.otra, 'otra@prueba.invalid', 'Logística');
  await usuarioViejo(U.sin, 'sin@prueba.invalid', null);
  await usuarioViejo(U.agencia, 'agencia@prueba.invalid', 'Mantenimiento', AGENCIA, 'agencia', 'aduana');
  await fichaVieja('VIEJA-INS', U.insumos);
  await fichaVieja('VIEJA-MANT', U.mant, { uso: { v: 'Algo', n: 1, a: U.mant, o: ORG, t: '2026-10-01T10:00:00.000Z' } });
  await fichaVieja('VIEJA-OTRA', U.otra);
  await fichaVieja('VIEJA-SIN', U.sin);
  await migrar(c);
}, 120_000);

afterAll(async () => {
  await c?.cerrar();
  if (carpetaVieja) rmSync(carpetaVieja, { recursive: true, force: true });
});

describe('migracion 0005 sobre una base con 0000-0003', () => {
  it('lleva el area de cada usuario al catalogo; lo desconocido y las agencias quedan sin area', async () => {
    const r = await filas<{ email: string; area: string | null }>(sql`select email, area from usuario order by email`);
    expect(Object.fromEntries(r.map((x) => [x.email, x.area]))).toEqual({
      'agencia@prueba.invalid': null,
      'insumos@prueba.invalid': 'Consumibles',
      'mant@prueba.invalid': 'Mantenimiento',
      'otra@prueba.invalid': null,
      'sin@prueba.invalid': null,
    });
  });

  it('las fichas toman el area de quien las creo, en `datos` y en el historial; sin area quedan pendientes', async () => {
    const r = await filas<{ codigo: string; datos: Record<string, { v: unknown; n: number; a: string }>; version: number }>(
      sql`select codigo, datos, version from referencia order by codigo`,
    );
    const por = Object.fromEntries(r.map((x) => [x.codigo, x]));
    expect(por['VIEJA-INS']!.datos.area_responsable).toMatchObject({ v: 'Consumibles', n: 1, a: U.insumos });
    expect(por['VIEJA-MANT']!.datos.area_responsable).toMatchObject({ v: 'Mantenimiento', n: 1, a: U.mant });
    expect(por['VIEJA-MANT']!.datos.uso).toMatchObject({ v: 'Algo' }); // lo demas no se toca
    expect(por['VIEJA-MANT']!.version).toBe(2);
    expect(por['VIEJA-OTRA']!.datos.area_responsable).toBeUndefined();
    expect(por['VIEJA-SIN']!.datos.area_responsable).toBeUndefined();

    const h = await filas<{ codigo: string; valor: unknown; tipo_evento: string; origen: string; version_campo: number }>(
      sql`select r.codigo, h.valor, h.tipo_evento, h.origen, h.version_campo
            from campo_historial h join referencia r on r.id = h.referencia_id where h.campo = 'area_responsable' order by r.codigo`,
    );
    expect(h).toEqual([
      { codigo: 'VIEJA-INS', valor: 'Consumibles', tipo_evento: 'sistema', origen: 'sistema', version_campo: 1 },
      { codigo: 'VIEJA-MANT', valor: 'Mantenimiento', tipo_evento: 'sistema', origen: 'sistema', version_campo: 1 },
    ]);
  });

  it('volver a migrar no hace nada', async () => {
    const total = (JSON.parse(readFileSync(join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as Journal).entries.length;
    await migrar(c);
    const [m] = await filas<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(m!.n).toBe(total);
    const [h] = await filas<{ n: number }>(sql`select count(*)::int as n from campo_historial where campo = 'area_responsable'`);
    expect(h!.n).toBe(2);
  });
});
