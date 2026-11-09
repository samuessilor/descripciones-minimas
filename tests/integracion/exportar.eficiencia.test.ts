/**
 * Eficiencia de la exportacion bajo volumen (medida con 5.000 fichas y 120.000 cambios, ver `historial.ts`):
 *  - una descarga con mas fichas que un lote (`LOTE`) sale completa, sin duplicados y en el orden de la lista;
 *  - el numero de consultas crece con los lotes, no con las fichas ni con los campos;
 *  - el recorte de la hoja Historial no es silencioso: el aviso y la leyenda dicen cuantos cambios hay en total.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campoHistorial, limiteTasa, referencia } from '@/db/esquema';
import { LOTE, exportarBase, flujoDeDescarga } from '@/server/exportar';
import { NombresUsuarios } from '@/server/exportar/filas';
import { cargarHistorial, TOPE_HISTORIAL } from '@/server/exportar/historial';
import { escribirLibro } from '@/server/exportar/libro';
import { condicionVisible } from '@/server/politicas/referencias';
import { nuevoEscenario, type Escenario } from './ayudas';
import { abrirLibro } from './ayudas-aduana';

let e: Escenario;
const AHORA = new Date('2026-10-21T20:30:00Z');
const N = LOTE * 2 + 50; // dos lotes completos y uno corto

beforeAll(async () => {
  e = await nuevoEscenario();
  const base = AHORA.getTime();
  const filas = Array.from({ length: N }, (_, i) => ({
    codigo: `VOL-${String(i).padStart(4, '0')}`,
    codigoNorm: `VOL${String(i).padStart(4, '0')}`,
    nombreProducto: `Producto de volumen ${i}`,
    tipoProducto: 'INSUMO',
    creadaPor: e.edward.usuarioId,
    // Una por segundo hacia atras: el orden de la lista (mas reciente primero) es VOL-0000, VOL-0001, ...
    creadaEn: new Date(base - i * 1000),
    actualizadaEn: new Date(base - i * 1000),
  }));
  const ids: string[] = [];
  for (let i = 0; i < filas.length; i += 100) {
    const r = await e.db.insert(referencia).values(filas.slice(i, i + 100)).returning({ id: referencia.id });
    ids.push(...r.map((x) => x.id));
  }
  // Tres cambios por ficha en la tercera parte de ellas: de sobra para ver el conteo total y el recorte.
  const cambios = ids
    .filter((_, i) => i % 3 === 0)
    .flatMap((id, k) =>
      [1, 2, 3].map((v) => ({
        referenciaId: id,
        campo: 'uso',
        versionCampo: v,
        tipoEvento: 'fijar',
        valor: `uso ${k} v${v}`,
        autorId: e.edward.usuarioId,
        rol: 'solicitante',
        organizacionId: e.orgInterna,
        creadoEn: new Date(base - k * 1000 + v),
      })),
    );
  for (let i = 0; i < cambios.length; i += 500) await e.db.insert(campoHistorial).values(cambios.slice(i, i + 500));
});
afterAll(async () => {
  await e.c.cerrar();
});

/** Cuenta las consultas `select` que se hacen por la conexion. */
function contarSelect(): { db: Escenario['db']; total: () => number } {
  let n = 0;
  const db = new Proxy(e.db, {
    get(t, p) {
      const v = Reflect.get(t, p) as unknown;
      if (p === 'select') {
        return (...a: unknown[]) => {
          n += 1;
          return (v as (...x: unknown[]) => unknown).apply(t, a);
        };
      }
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
  });
  return { db, total: () => n };
}

describe('exportar con mas fichas que un lote', () => {
  it('sale completa, sin duplicados y en el orden de la lista; las consultas crecen con los lotes y no con las fichas', async () => {
    await e.db.delete(limiteTasa);
    const { db, total } = contarSelect();
    const r = await exportarBase({ ...e.ctx(e.admin, AHORA), db }, { alcance: 'toda' });
    const libro = await abrirLibro(r.flujo);
    expect(r.filas).toBe(N);

    const base = libro.getWorksheet('Base')!;
    const codigos: string[] = [];
    base.eachRow((f, i) => {
      if (i > 1) codigos.push(f.getCell(1).text);
    });
    expect(codigos).toHaveLength(N);
    expect(new Set(codigos).size).toBe(N);
    expect(codigos[0]).toBe('VOL-0000');
    expect(codigos[N - 1]).toBe(`VOL-${String(N - 1).padStart(4, '0')}`);

    // Resumen de estado lleva las mismas fichas; el Historial, los tres cambios de cada tercera ficha.
    expect(libro.getWorksheet('Resumen de estado')!.rowCount).toBe(N + 1);
    const historial = libro.getWorksheet('Historial')!;
    expect(historial.rowCount).toBe(Math.ceil(N / 3) * 3 + 1);

    // ids (1) + 5 por lote + conteo/nombres del historial: acotado por los lotes, no por las 450 fichas.
    const lotes = Math.ceil(N / LOTE);
    expect(total()).toBeLessThanOrEqual(1 + lotes * 5 + 4);
  });
});

describe('recorte de la hoja Historial', () => {
  const cargar = (tope?: number) =>
    cargarHistorial({ ej: e.db, actor: e.admin, nombres: new NombresUsuarios(e.admin) }, condicionVisible(e.admin, AHORA), tope);

  it('el tope cubre la base objetivo: 1.500 fichas con ~25 cambios caben sin recorte', () => {
    expect(TOPE_HISTORIAL).toBeGreaterThanOrEqual(1500 * 25);
  });

  it('con recorte informa el total real de cambios; sin recorte no hace la consulta de conteo', async () => {
    const todo = await cargar();
    expect(todo.recortado).toBe(false);
    expect(todo.total).toBeUndefined();

    const corto = await cargar(10);
    expect(corto.recortado).toBe(true);
    expect(corto.filas).toHaveLength(10);
    expect(corto.total).toBe(todo.filas.length);
  });

  it('el aviso de la hoja y la leyenda dicen "de TOTAL", con separador de miles', async () => {
    const { salida, flujo } = flujoDeDescarga();
    const leyenda = { exportadoPor: 'Prueba', rol: 'admin', fecha: '2026-10-21 15:30', alcance: 'Toda', filtros: [], filas: 0, incluyeArchivadas: false };
    const escritura = escribirLibro(salida, {
      lotes: async function* () {
        yield [];
      },
      leyenda,
      historial: async () => ({ filas: [], recortado: true, tope: 50_000, total: 114_035 }),
    });
    const libro = await abrirLibro(flujo);
    await escritura;
    expect(libro.getWorksheet('Historial')!.getCell('A1').text).toContain('los 50.000 más recientes de 114.035');
    const t: string[] = [];
    libro.getWorksheet('Leyenda')!.eachRow((f) => t.push(`${f.getCell(1).text} ${f.getCell(2).text}`));
    expect(t.join('\n')).toContain('Incompleto: solo los 50.000 cambios más recientes de 114.035');
  });
});
