/** SOLO DESARROLLO: "Procesar cola ahora" (SPEC 14). Corre una pasada del despachador sin esperar al temporizador. */
import { getDb } from '@/db';
import { getMailer } from '@/server/correo';
import { contarCola, despachar } from '@/server/correo/despachar';
import { json, soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const db = getDb();
  const r = await despachar({ db, mailer: getMailer() });
  return json({
    ok: true,
    tomados: r.tomados,
    enviados: r.enviados,
    fallidos: r.fallidos,
    abandonados: r.abandonados,
    filas: r.filas,
    cola: await contarCola(db),
  });
}
