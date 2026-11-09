import type { ReactNode } from 'react';
import { SubNavAdmin } from '@/componentes/admin/SubNavAdmin';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { ContenedorAncho, ContenedorLectura } from '@/componentes/ui/pagina';
import { puede } from '@/dominio/permisos';
import { exigirActor } from '@/server/sesion';

/**
 * Toda la administracion exige rol `admin` (13.2): la comprobacion vive en el servidor. Quien no es administrador
 * ve el aviso de permiso (sin pistas de lo que hay detras) y sus paginas hijas devuelven `null` sin leer nada.
 * Un 403 real pide `forbidden()` de Next, que hoy exige `experimental.authInterrupts` en la configuracion
 * (ver docs/PETICIONES-CONFIG-admin.md).
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const actor = await exigirActor();
  if (!puede(actor, 'administrar')) {
    return (
      <ContenedorLectura>
        <SinPermiso />
      </ContenedorLectura>
    );
  }
  return (
    <ContenedorAncho>
      <SubNavAdmin />
      {children}
    </ContenedorAncho>
  );
}
