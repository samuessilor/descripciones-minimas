/**
 * `GET /api/exportar`: descarga de la base en Excel en streaming (H4, SPEC 15.1).
 *
 * Parametros: `alcance=filtrado|toda`, `archivadas=1`, y los filtros de la lista: `estado=todas|amarillas|verdes|archivadas`,
 * `tipo=INSUMO|REPUESTO|EQUIPO|ACCESORIO|MONTURA`, `q=texto`, `mias=1`, `agencia=<id de organizacion>`, `sinResponsable=1`,
 * `partida=<prefijo, con o sin puntos>` (los mismos nombres que usa el listado).
 * Con `resumen=1` no descarga: responde `{filtrado, toda}` con el numero de filas de cada alcance.
 */
import { prefijoPartida } from '@/dominio/busqueda';
import { TIPOS_PRODUCTO, type TipoProducto } from '@/dominio/campos';
import { contarExportable, exportarBase, type FiltrosExportacion } from '@/server/exportar';
import { json, respuestaDeError } from '@/server/http';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function filtrosDe(p: URLSearchParams): FiltrosExportacion {
  const f: FiltrosExportacion = {};
  const estado = p.get('estado');
  if (estado === 'amarillas' || estado === 'verdes' || estado === 'archivadas' || estado === 'todas') f.estado = estado;
  const tipo = p.get('tipo');
  if (tipo && (TIPOS_PRODUCTO as readonly string[]).includes(tipo)) f.tipo = tipo as TipoProducto;
  const q = p.get('q')?.trim();
  if (q) f.q = q.slice(0, 200);
  if (p.get('mias') === '1') f.mias = true;
  const agencia = p.get('agencia');
  if (agencia && UUID.test(agencia)) f.agencia = agencia;
  if (p.get('sinResponsable') === '1') f.sinResponsable = true;
  const partida = p.get('partida')?.trim();
  if (partida && prefijoPartida(partida)) f.partida = partida.slice(0, 13);
  return f;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    const p = new URL(request.url).searchParams;
    const filtros = filtrosDe(p);
    const incluirArchivadas = p.get('archivadas') === '1';

    if (p.get('resumen') === '1') {
      return json({ ok: true, data: await contarExportable(ctx, filtros, incluirArchivadas) });
    }

    const r = await exportarBase(ctx, {
      alcance: p.get('alcance') === 'toda' ? 'toda' : 'filtrado',
      incluirArchivadas,
      filtros,
    });
    return new Response(r.flujo, {
      status: 200,
      headers: {
        'content-type': r.contentType,
        'content-disposition': `attachment; filename="${r.nombreArchivo}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-filas': String(r.filas),
      },
    });
  } catch (e) {
    return respuestaDeError(e);
  }
}
