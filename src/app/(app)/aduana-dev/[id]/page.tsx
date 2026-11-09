import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BotonExportar } from '@/componentes/slots/BotonExportar';
import { SeccionAduana } from '@/componentes/slots/SeccionAduana';
import { Estado } from '@/componentes/Estado';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { ErrorAccion } from '@/server/acciones/resultado';
import { vistaFicha } from '@/server/politicas/referencias';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Zona de la aduana · Desarrollo' };
export const dynamic = 'force-dynamic';

/**
 * Ruta SOLO DE DESARROLLO para ver la zona de la aduana aislada mientras la ficha definitiva no la monta.
 * En produccion responde 404.
 */
export default async function PaginaAduanaDev({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { id } = await params;
  const { db, actor } = await exigirContexto();
  let ficha;
  try {
    ficha = await vistaFicha(db, actor, id, new Date());
  } catch (e) {
    if (e instanceof ErrorAccion && e.codigo === 'NO_ENCONTRADO') notFound();
    throw e;
  }
  return (
    <ContenedorLectura>
      <EncabezadoPagina
        titulo={ficha.nombreProducto}
        migas={[{ etiqueta: 'Referencias', href: '/referencias' }, { etiqueta: ficha.codigo }]}
        acciones={<BotonExportar />}
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Estado color={ficha.color} texto={ficha.etiqueta} tamano="lg" />
        <span className="font-mono text-sm text-tinta-suave">{ficha.codigo}</span>
        <span className="text-sm text-tinta-suave">{ficha.diasEnGestion} días en gestión</span>
      </div>
      <SeccionAduana referenciaId={ficha.id} />
    </ContenedorLectura>
  );
}
