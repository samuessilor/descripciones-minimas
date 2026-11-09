import type { Metadata } from 'next';
import { Aviso } from '@/componentes/ui/aviso';
import { ContenedorLectura } from '@/componentes/ui/pagina';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { esArea } from '@/dominio/areas';
import { CAMPOS, esVisible } from '@/dominio/campos';
import { fechaBogota } from '@/dominio/dias-gestion';
import { estaVacio } from '@/dominio/valores';
import { puede } from '@/dominio/permisos';
import { CAMPOS_SIMILAR } from '@/server/acciones/crear-referencia';
import { vistaFicha } from '@/server/politicas/referencias';
import { exigirContexto } from '@/server/sesion';
import { FormularioNueva, type OrigenSimilar } from './formulario-nueva';

export const metadata: Metadata = { title: 'Nueva referencia · Descripciones mínimas' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `?codigo=` precarga el codigo (desde «Crear "X"»); `?similar=<id>` parte de otra referencia (F10). */
export default async function NuevaReferencia({ searchParams }: { searchParams: Promise<{ similar?: string; codigo?: string }> }) {
  const { db, actor } = await exigirContexto();
  const { similar, codigo } = await searchParams;
  if (!puede(actor, 'crear_referencia')) {
    // Misma pantalla neutra que el resto de paginas sin permiso (el rojo es solo para errores de validacion).
    return (
      <ContenedorLectura>
        <SinPermiso />
      </ContenedorLectura>
    );
  }

  let origen: OrigenSimilar | null = null;
  let sinOrigen = false;
  if (similar && UUID.test(similar)) {
    try {
      const f = await vistaFicha(db, actor, similar, new Date());
      const copiados = CAMPOS_SIMILAR.map((c) => CAMPOS.find((d) => d.clave === c))
        .filter((d): d is (typeof CAMPOS)[number] => !!d && esVisible(d, f.tipoProducto) && !estaVacio(f.campos[d.clave]?.valor))
        .map((d) => d.etiqueta.toLowerCase());
      const area = f.campos.area_responsable?.valor;
      origen = { id: f.id, codigo: f.codigo, nombre: f.nombreProducto, tipo: f.tipoProducto, area: esArea(area) ? area : null, copiados };
    } catch {
      sinOrigen = true;
    }
  } else if (similar) {
    sinOrigen = true;
  }

  return (
    <div className="space-y-5">
      {sinOrigen ? (
        <div className="contenedor-lectura">
          <Aviso tipo="aviso" titulo="No encontramos la referencia de origen">
            Puedes crear una nueva desde cero.
          </Aviso>
        </div>
      ) : null}
      <FormularioNueva
        codigoInicial={(codigo ?? '').slice(0, 80)}
        similar={origen}
        areaInicial={origen?.area ?? (esArea(actor.area) ? actor.area : '')}
        hoy={fechaBogota(new Date())}
      />
    </div>
  );
}
