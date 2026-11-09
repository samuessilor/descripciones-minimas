/**
 * `GET /api/admin/auditoria/exportar`: la auditoria filtrada, en CSV (13.6). Solo `admin`. Neutraliza las celdas que
 * empiezan por `=`, `+`, `-`, `@` (13.4), tiene un tope de filas y deja constancia de la descarga en la propia
 * auditoria (quien, cuando, cuantas filas, con que filtros). Los filtros son los mismos de la pantalla.
 */
import { puede } from '@/dominio/permisos';
import { auditar } from '@/server/auditoria';
import { ErrorAccion } from '@/server/acciones/resultado';
import { aCsv } from '@/server/csv';
import { respuestaDeError } from '@/server/http';
import { limitarTasa } from '@/server/limite-tasa';
import { MAXIMO_FILAS_CSV, auditoriaParaCsv, type FiltrosAuditoria } from '@/server/politicas/administracion-auditoria';
import { contextoDeAccion } from '@/server/sesion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REGLA_DESCARGA = { max: 10, ventanaMs: 3_600_000 } as const;

export async function GET(request: Request): Promise<Response> {
  try {
    const ctx = await contextoDeAccion();
    if (!puede(ctx.actor, 'administrar')) throw new ErrorAccion('SIN_PERMISO', 'No tienes permiso para descargar la auditoría.');

    const lim = await limitarTasa(ctx.db, `exportar-auditoria:${ctx.actor.usuarioId}`, REGLA_DESCARGA);
    if (!lim.permitido) {
      const min = Math.max(1, Math.ceil(lim.reintentarEnMs / 60_000));
      throw new ErrorAccion('LIMITE_TASA', `Descargaste varias veces seguidas. Espera ${min} ${min === 1 ? 'minuto' : 'minutos'} y vuelve a intentar.`);
    }

    const p = new URL(request.url).searchParams;
    const filtros: FiltrosAuditoria = {
      desde: p.get('desde') || undefined,
      hasta: p.get('hasta') || undefined,
      usuarioId: p.get('persona') || undefined,
      accion: p.get('accion') || undefined,
      ficha: p.get('ficha') || undefined,
    };
    const { filas, truncado } = await auditoriaParaCsv(ctx.db, ctx.actor, filtros);

    const csv = aCsv(
      ['id', 'fecha_bogota', 'persona', 'persona_id', 'accion', 'entidad', 'entidad_id', 'entidad_etiqueta', 'ip', 'detalle'],
      filas.map((f) => [
        f.id,
        new Date(f.creadoEn).toLocaleString('sv-SE', { timeZone: 'America/Bogota' }),
        f.usuarioNombre ?? '',
        f.usuarioId ?? '',
        f.accion,
        f.entidad,
        f.entidadId,
        f.entidadEtiqueta ?? '',
        f.ip ?? '',
        f.detalle,
      ]),
    );

    await auditar(ctx.db, {
      usuarioId: ctx.actor.usuarioId,
      accion: 'exportar',
      entidad: 'auditoria',
      entidadId: 'csv',
      detalle: { filas: filas.length, truncado, filtros: Object.fromEntries(Object.entries(filtros).filter(([, v]) => v)) },
      ip: ctx.ip,
    });

    const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Bogota' });
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="auditoria-${fecha}.csv"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'x-filas': String(filas.length),
        ...(truncado ? { 'x-truncado': String(MAXIMO_FILAS_CSV) } : {}),
      },
    });
  } catch (e) {
    return respuestaDeError(e);
  }
}
