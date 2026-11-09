/**
 * SOLO DESARROLLO (404 fuera de NODE_ENV=development): los correos de `correo_dev`.
 *   GET /api/dev/correo?para=<correo>&limite=n          JSON (lo leen las pruebas E2E sin abrir la base)
 *   GET /api/dev/correo?formato=html                    bandeja de correos de desarrollo (vista previa)
 *   GET /api/dev/correo?id=<id>&ver=html|texto          el correo tal como se ve / su texto plano alterno
 */
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { correoDev } from '@/db/esquema';
import { escaparHtml } from '@/server/correo/plantillas';
import { json, soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function html(cuerpo: string, estado = 200): Response {
  return new Response(cuerpo, { status: estado, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const url = new URL(request.url);
  const db = getDb();

  const id = url.searchParams.get('id');
  if (id) {
    if (!UUID.test(id)) return json({ ok: false, codigo: 'NO_ENCONTRADO' }, 404);
    const [f] = await db.select().from(correoDev).where(eq(correoDev.id, id)).limit(1);
    if (!f) return json({ ok: false, codigo: 'NO_ENCONTRADO' }, 404);
    if (url.searchParams.get('ver') === 'texto') {
      return new Response(f.cuerpoTexto, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    return html(f.cuerpoHtml);
  }

  const para = url.searchParams.get('para')?.toLowerCase();
  const limite = Math.min(Number(url.searchParams.get('limite') ?? 20) || 20, 100);
  const consulta = db.select().from(correoDev);
  const filas = await (para ? consulta.where(eq(correoDev.destinatario, para)) : consulta).orderBy(desc(correoDev.creadoEn)).limit(limite);

  if (url.searchParams.get('formato') === 'html') {
    const items = filas
      .map(
        (f) => `<li style="margin:0 0 10px;padding:12px 14px;background:#fff;border:1px solid #DCE4EF;border-radius:10px">
  <div style="font-size:12px;color:#4A5A70">${escaparHtml(f.creadoEn.toISOString())} · para ${escaparHtml(f.destinatario)}</div>
  <div style="font-weight:700;margin:2px 0 6px">${escaparHtml(f.asunto)}</div>
  <a href="/api/dev/correo?id=${f.id}&ver=html" style="margin-right:12px;color:#0B5FD0">Ver correo</a>
  <a href="/api/dev/correo?id=${f.id}&ver=texto" style="margin-right:12px;color:#0B5FD0">Texto plano</a>
  ${f.enlace ? `<a href="${escaparHtml(f.enlace)}" style="color:#0B5FD0">Abrir el enlace</a>` : ''}
</li>`,
      )
      .join('');
    return html(`<!doctype html><html lang="es-CO"><head><meta charset="utf-8"><title>Correos de desarrollo</title></head>
<body style="margin:0;padding:24px;background:#F3F6FA;font-family:Arial,Helvetica,sans-serif;color:#0F1B2D">
<h1 style="font-size:20px;margin:0 0 4px">Correos de desarrollo</h1>
<p style="margin:0 0 16px;color:#4A5A70">Solo existe en desarrollo. Aquí llegan los correos que en producción salen por Resend o SMTP.</p>
<ul style="list-style:none;padding:0;margin:0;max-width:720px">${items || '<li>No hay correos todavía.</li>'}</ul></body></html>`);
  }

  return json(
    filas.map((f) => ({
      id: f.id,
      para: f.destinatario,
      asunto: f.asunto,
      texto: f.cuerpoTexto,
      enlace: f.enlace,
      creadoEn: f.creadoEn.toISOString(),
    })),
  );
}
