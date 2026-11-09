import { RefreshCw } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { reintentarCorreoAccion } from '@/app/acciones/admin';
import { BotonAccion } from '@/componentes/admin/acciones';
import { etiquetaPlantillaCorreo, fechaHora } from '@/componentes/admin/formato';
import { Dato, Datos, Seccion } from '@/componentes/admin/piezas';
import { Aviso } from '@/componentes/ui/aviso';
import { Insignia } from '@/componentes/ui/insignia';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { obtenerCorreoAdmin } from '@/server/politicas/administracion-correo';
import { contextoAdmin, param } from '../../_contexto';

export const metadata: Metadata = { title: 'Correo · Descripciones mínimas' };

const NOMBRE = { pendiente: 'En cola', enviando: 'Enviándose', enviado: 'Enviado', fallido: 'Fallido', abandonado: 'Abandonado' } as const;

export default async function AdminCorreoVistaPrevia({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const { id } = await params;
  const origen = param((await searchParams).origen) === 'desarrollo' ? 'desarrollo' : 'cola';
  const c = await obtenerCorreoAdmin(ctx.db, ctx.actor, id, origen);
  if (!c) notFound();
  const puedeReintentar = c.estado === 'fallido' || c.estado === 'abandonado';

  return (
    <>
      <EncabezadoPagina
        titulo={c.asunto}
        migas={[{ etiqueta: 'Cola de correo', href: '/admin/correo' }, { etiqueta: 'Vista previa' }]}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {c.estado ? <Insignia variante={c.estado === 'fallido' ? 'error' : c.estado === 'enviado' ? 'oscura' : 'azul'}>{NOMBRE[c.estado]}</Insignia> : <Insignia variante="contorno">Desarrollo</Insignia>}
            <span className="break-all">Para {c.destinatario}</span>
          </span>
        }
        acciones={
          puedeReintentar ? (
            <BotonAccion accion={reintentarCorreoAccion} campos={{ entregaId: c.id }} variante="primario" tamano="md">
              <RefreshCw aria-hidden className="size-4" />
              Reintentar el envío
            </BotonAccion>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <Seccion id="vista" titulo="Cómo lo ve quien lo recibe" descripcion="Es exactamente el mismo contenido: un reintento no cambia el texto." sinPadding>
          <iframe
            title={`Vista previa del correo: ${c.asunto}`}
            sandbox=""
            srcDoc={c.cuerpoHtml}
            className="block h-[34rem] w-full rounded-b-xl border-0 bg-superficie-2"
          />
        </Seccion>

        <div className="space-y-6">
          <Seccion id="datos" titulo="Datos">
            <Datos className="sm:grid-cols-[minmax(0,6rem)_minmax(0,1fr)]">
              <Dato etiqueta="Tipo">{c.plantilla ? etiquetaPlantillaCorreo(c.plantilla) : 'Acceso o invitación'}</Dato>
              <Dato etiqueta="Creado">{fechaHora(c.creadaEn)}</Dato>
              {c.intentos !== null ? <Dato etiqueta="Intentos">{c.intentos}</Dato> : null}
            </Datos>
          </Seccion>
          {c.ultimoError ? (
            <Aviso tipo="error" titulo="Último error">
              <span className="break-words">{c.ultimoError}</span>
            </Aviso>
          ) : null}
          <Seccion id="texto" titulo="Texto simple" descripcion="La versión sin formato, para quien no ve HTML.">
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-tinta">{c.cuerpoTexto}</pre>
          </Seccion>
          <p className="text-sm text-tinta-suave">Por seguridad, cualquier enlace de acceso («token=») se muestra tapado en esta vista.</p>
        </div>
      </div>
    </>
  );
}
