import { Building2 } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { crearOrganizacionAccion } from '@/app/acciones/admin';
import { FormularioAccion } from '@/componentes/admin/acciones';
import { FormularioNuevaAgencia } from '@/componentes/admin/FormularioNuevaAgencia';
import { CampoAdmin } from '@/componentes/admin/campos';
import { plural } from '@/componentes/admin/formato';
import { Seccion } from '@/componentes/admin/piezas';
import { Aviso } from '@/componentes/ui/aviso';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Insignia } from '@/componentes/ui/insignia';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { TablaDatos } from '@/componentes/ui/tabla';
import { fichasConVariasAgencias, listarOrganizacionesAdmin, type FilaOrganizacionAdmin } from '@/server/politicas/administracion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin } from '../_contexto';

export const metadata: Metadata = { title: 'Organizaciones · Descripciones mínimas' };

function TablaOrganizaciones({ filas, agencia }: { filas: FilaOrganizacionAdmin[]; agencia: boolean }) {
  return (
    <TablaDatos
      etiqueta={agencia ? 'Agencias de aduana' : 'Organizaciones internas'}
      filas={filas}
      clave={(o) => o.id}
      hrefFila={(o) => `/admin/organizaciones/${o.id}`}
      etiquetaEnlace={(o) => `Abrir ${o.nombre}`}
      columnas={[
        { id: 'nombre', encabezado: 'Nombre', principal: true, celda: (o) => <span className="whitespace-normal">{o.nombre}</span> },
        {
          id: 'personas',
          encabezado: 'Personas activas',
          celda: (o) => (
            <span className={o.usuariosActivos === 0 && o.activa ? 'font-semibold text-error' : undefined}>
              {o.usuariosActivos}
              {o.usuariosTotal > o.usuariosActivos ? <span className="text-tinta-suave"> de {o.usuariosTotal}</span> : null}
            </span>
          ),
        },
        ...(agencia
          ? [{ id: 'fichas', encabezado: 'Referencias con acceso', alinear: 'der' as const, ocultarBajo: 'md' as const, celda: (o: FilaOrganizacionAdmin) => o.fichasConAcceso }]
          : []),
        { id: 'estado', encabezado: 'Estado', celda: (o) => (o.activa ? <Insignia variante="azul">Activa</Insignia> : <Insignia variante="neutra">Inactiva</Insignia>) },
      ]}
      vacio={
        <EstadoVacio
          compacto
          icono={Building2}
          titulo={agencia ? 'Todavía no hay agencias de aduana' : 'Todavía no hay organizaciones internas'}
          descripcion={agencia ? 'Crea la primera: se crea con su cuenta y queda lista para enviarle referencias.' : 'Crea la organización de EssilorLuxottica; el área de cada cuenta se elige al crearla.'}
        />
      }
    />
  );
}

export default async function AdminOrganizaciones() {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const [organizaciones, varias] = await Promise.all([listarOrganizacionesAdmin(ctx.db, ctx.actor), fichasConVariasAgencias(ctx.db, ctx.actor)]);
  const internas = organizaciones.filter((o) => o.tipo === 'interna');
  const agencias = organizaciones.filter((o) => o.tipo === 'agencia');

  return (
    <>
      <EncabezadoPagina
        titulo="Organizaciones"
        descripcion="EssilorLuxottica y las agencias de aduana (una por empresa). Una persona pertenece a una sola; una referencia trabaja con una agencia a la vez."
      />

      {varias.length > 0 ? (
        <Aviso
          tipo="aviso"
          titulo={`${plural(varias.length, 'referencia está abierta', 'referencias están abiertas')} a más de una agencia`}
          className="mb-6"
        >
          <ul className="mt-1 space-y-1">
            {varias.map((f) => (
              <li key={f.referenciaId}>
                <Link href={`/referencias/${f.referenciaId}`} className="font-mono font-bold underline underline-offset-2">
                  {f.codigo}
                </Link>{' '}
                con {f.agencias.join(' y ')}. Abre una de las agencias y usa «Retirar acceso».
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      <div className="space-y-8">
        <Seccion
          id="nueva-agencia"
          titulo="Nueva agencia de aduana"
          descripcion="Una agencia es una empresa con una sola cuenta. Escribe el nombre de la empresa: creamos la agencia y su cuenta de una vez, lista para enviarle referencias."
        >
          <FormularioNuevaAgencia />
        </Seccion>

        <Seccion id="nueva" titulo="Nueva área interna" descripcion="Para personas de EssilorLuxottica. El área de cada cuenta (Consumibles, Mantenimiento…) se elige al crear la cuenta.">
          <FormularioAccion accion={crearOrganizacionAccion} enviar="Crear organización" enviando="Creando…" reiniciar className="space-y-5">
            <div className="max-w-xl">
              <CampoAdmin nombre="nombre" etiqueta="Nombre" ayuda="Ejemplo: EssilorLuxottica." required maxLength={120} />
            </div>
          </FormularioAccion>
        </Seccion>

        <section aria-labelledby="t-internas" className="space-y-3">
          <h2 id="t-internas" className="flex items-baseline gap-2 text-lg font-bold text-tinta">
            Internas <span className="text-sm font-normal text-tinta-suave">{internas.length}</span>
          </h2>
          <TablaOrganizaciones filas={internas} agencia={false} />
        </section>

        <section aria-labelledby="t-agencias" className="space-y-3">
          <h2 id="t-agencias" className="flex items-baseline gap-2 text-lg font-bold text-tinta">
            Agencias de aduana <span className="text-sm font-normal text-tinta-suave">{agencias.length}</span>
          </h2>
          <p className="max-w-[65ch] text-sm text-tinta-suave">
            Una agencia ve una referencia mientras tenga algo pendiente en ella y, después de clasificada, unos días más. Desde cada agencia puedes
            retirar el acceso a una referencia en cualquier momento. Si cambian de proveedor de aduana, desactiva la cuenta de la agencia vieja (sus pendientes pasan a quien elijas) y después la agencia.
          </p>
          <TablaOrganizaciones filas={agencias} agencia />
        </section>
      </div>
    </>
  );
}
