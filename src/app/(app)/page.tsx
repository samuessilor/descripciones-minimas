import type { Metadata } from 'next';
import { BandejaInicio } from '@/componentes/slots/BandejaInicio';
import { nombreVisible } from '@/componentes/ui/avatar';
import { EnlaceBoton } from '@/componentes/ui/button';
import { ContenedorAncho, EncabezadoPagina } from '@/componentes/ui/pagina';
import { puede } from '@/dominio/permisos';
import { exigirActor } from '@/server/sesion';

export const metadata: Metadata = { title: 'Inicio · Descripciones mínimas' };

/**
 * Inicio (10.3): saludo, «Nueva referencia» y la bandeja (slot `BandejaInicio`): lo mas urgente,
 * «Para mi · Esperando a otros · Recientes».
 */
export default async function Inicio() {
  const actor = await exigirActor();
  // Una agencia entra con su cuenta general («Agencia X»): se saluda con el nombre completo, no con «Hola, Agencia».
  const primerNombre = actor.organizacionTipo === 'agencia' ? nombreVisible(actor.nombre) : (nombreVisible(actor.nombre).split(/\s+/)[0] ?? '');

  return (
    <ContenedorAncho>
      <div className="mx-auto max-w-5xl">
        <EncabezadoPagina
          titulo={`Hola, ${primerNombre}`}
          descripcion={[nombreVisible(actor.organizacionNombre), actor.area].filter(Boolean).join(' · ')}
          acciones={
            puede(actor, 'crear_referencia') ? (
              <EnlaceBoton href="/referencias/nueva" variante="primario">
                Nueva referencia
              </EnlaceBoton>
            ) : undefined
          }
        />
        <BandejaInicio />
      </div>
    </ContenedorAncho>
  );
}
