import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FichaFormulario } from '@/componentes/ficha/FichaFormulario';
import { listarPaisesFrecuentes } from '@/dominio/paises';
import { listarAdjuntos } from '@/server/acciones/adjuntos';
import { ErrorAccion } from '@/server/acciones/resultado';
import { fotosActivas } from '@/server/config';
import { opcionesDeCatalogo } from '@/server/politicas/catalogos';
import { cargarReferenciaVisible, vistaFicha } from '@/server/politicas/referencias';
import { responsablesPorParte } from '@/server/politicas/tablero';
import { exigirContexto } from '@/server/sesion';

export const metadata: Metadata = { title: 'Referencia · Descripciones mínimas' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** La ficha: tres secciones en una sola pantalla (SPEC 10.2). Ficha ajena o inexistente => 404, nunca 403 (13.2). */
export default async function PaginaFicha({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db, actor } = await exigirContexto();
  const ahora = new Date();
  if (!UUID.test(id)) notFound();

  let ficha;
  let creadaPorId: string;
  try {
    ficha = await vistaFicha(db, actor, id, ahora);
    creadaPorId = (await cargarReferenciaVisible(db, actor, id, ahora)).creadaPor;
  } catch (e) {
    if (e instanceof ErrorAccion && e.codigo === 'NO_ENCONTRADO') notFound();
    throw e;
  }

  const [unidades, aspectos, adjuntos, quien] = await Promise.all([
    opcionesDeCatalogo(db, 'unidad_medida'),
    opcionesDeCatalogo(db, 'aspecto_fisico'),
    listarAdjuntos(db, actor, id, ahora),
    responsablesPorParte(db, actor, [id], ahora),
  ]);

  return (
    <FichaFormulario
      inicial={ficha}
      adjuntosIniciales={adjuntos}
      fotosActivas={fotosActivas()}
      actor={{
        usuarioId: actor.usuarioId,
        rol: actor.rol,
        organizacionId: actor.organizacionId,
        organizacionTipo: actor.organizacionTipo,
        creadaPorId,
      }}
      catalogos={{ unidad_medida: unidades, aspecto_fisico: aspectos }}
      paises={listarPaisesFrecuentes()}
      responsables={quien.get(id) ?? { producto: [], detalle: [], especificaciones: [], aduana: [] }}
    />
  );
}
