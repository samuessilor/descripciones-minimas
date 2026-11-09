import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listarReferencias } from '@/server/politicas/referencias';
import { exigirContexto } from '@/server/sesion';
import { DemoLote } from './demo-lote';

export const metadata: Metadata = { title: 'Colaboración · Desarrollo' };
export const dynamic = 'force-dynamic';

/**
 * Pagina de desarrollo: ejercita `BarraLote` (envio en lote) con casillas, tal como la usaria el listado.
 * Solo existe fuera de produccion (404 en produccion).
 */
export default async function PaginaDevColaboracion() {
  if (process.env.NODE_ENV === 'production') notFound();
  const { db, actor } = await exigirContexto();
  const filas = await listarReferencias(db, actor, { limite: 12, ahora: new Date() });
  return (
    <main id="contenido" className="mx-auto max-w-3xl space-y-4 px-4 py-8">
      <h1 className="font-display text-2xl font-extrabold text-tinta">Envío en lote · demostración</h1>
      <p className="text-tinta-suave">Marca varias referencias y usa «Enviar a…»: es el mismo diálogo de la ficha, con un correo resumen por persona.</p>
      <DemoLote filas={filas.map((f) => ({ id: f.id, codigo: f.codigo, nombre: f.nombreProducto }))} />
    </main>
  );
}
