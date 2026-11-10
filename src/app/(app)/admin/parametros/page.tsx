import type { Metadata } from 'next';
import { Seccion } from '@/componentes/admin/piezas';
import { Aviso } from '@/componentes/ui/aviso';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { getConfig } from '@/server/config';
import { leerParametros } from '@/server/parametros';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin } from '../_contexto';

export const metadata: Metadata = { title: 'Parámetros · Descripciones mínimas' };

export default async function AdminParametros() {
  const ctx = await contextoAdmin('administrar');
  if (!ctx) return <SinPermiso />;
  const grupos = leerParametros(ctx.actor, getConfig());

  return (
    <>
      <EncabezadoPagina
        titulo="Parámetros"
        descripcion="Las reglas con las que está funcionando la plataforma ahora mismo. Aquí solo se leen."
      />
      <Aviso tipo="info" titulo="Se cambian por variables de entorno" className="mb-6">
        Quien administra el servidor las modifica en la configuración del entorno (en local, el archivo <span className="font-mono">.env.local</span>) y reinicia la aplicación. Las que dicen «regla del producto» cambian con una nueva versión de la plataforma. Las llaves y claves nunca se muestran.
      </Aviso>

      <div className="space-y-6">
        {grupos.map((g) => (
          <Seccion key={g.id} id={g.id} titulo={g.titulo} descripcion={g.descripcion} sinPadding>
            <dl className="divide-y divide-borde-suave">
              {g.parametros.map((p) => (
                <div key={p.nombre} className="grid gap-x-6 gap-y-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-baseline lg:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_minmax(0,21rem)]">
                  <dt>
                    <span className="block text-base font-semibold text-tinta">{p.nombre}</span>
                    {p.nota ? <span className="mt-0.5 block text-sm text-tinta-suave">{p.nota}</span> : null}
                  </dt>
                  <dd className="min-w-0 break-words text-base font-semibold tabular-nums text-azul-900 sm:text-right lg:text-left">{p.valor}</dd>
                  <dd className="text-sm text-tinta-suave sm:col-span-2 lg:col-span-1">
                    {p.variable ? (
                      <span className="inline-block max-w-full break-all rounded border border-borde-suave bg-superficie-2 px-1.5 py-0.5 font-mono text-xs text-tinta">{p.variable}</span>
                    ) : (
                      'Regla del producto'
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Seccion>
        ))}
      </div>
    </>
  );
}
