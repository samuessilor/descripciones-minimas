import type { ReactNode } from 'react';
import { SubNavAdmin } from '@/componentes/admin/SubNavAdmin';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { ContenedorAncho, ContenedorLectura } from '@/componentes/ui/pagina';
import { puede } from '@/dominio/permisos';
import { exigirActor } from '@/server/sesion';

/**
 * La administracion exige rol `admin` o `supervisor` (13.2): la comprobacion vive en el servidor. Quien no tiene ninguno
 * de los dos ve el aviso de permiso (sin pistas de lo que hay detras). Lo que es solo del administrador lo vuelve a
 * exigir cada pagina, que pinta el mismo aviso.
 * Un 403 real pide `forbidden()` de Next, que hoy exige `experimental.authInterrupts` en la configuracion
 * (ver docs/PETICIONES-CONFIG-admin.md).
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const actor = await exigirActor();
  if (!puede(actor, 'supervisar')) {
    return (
      <ContenedorLectura>
        <SinPermiso />
      </ContenedorLectura>
    );
  }
  return (
    <ContenedorAncho>
      <SubNavAdmin administrador={puede(actor, 'administrar')} />
      {children}
    </ContenedorAncho>
  );
}
