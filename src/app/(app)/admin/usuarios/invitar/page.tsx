import type { Metadata } from 'next';
import { FormularioInvitar } from '@/componentes/admin/FormularioInvitar';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { getConfig } from '@/server/config';
import { listarOrganizacionesAdmin } from '@/server/politicas/administracion';
import { contextoAdmin, param } from '../../_contexto';

export const metadata: Metadata = { title: 'Invitar a una persona o agencia ·Descripciones mínimas' };

export default async function InvitarUsuario({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const sp = await searchParams;
  const organizaciones = (await listarOrganizacionesAdmin(ctx.db, ctx.actor)).filter((o) => o.activa);
  return (
    <ContenedorLectura>
      <EncabezadoPagina
        titulo="Invitar a una persona o agencia"
        descripcion="No hay registro abierto: entra solo quien invitas aquí. Una agencia de aduana tiene una sola cuenta general, con el correo de la empresa. Le llega un correo con su enlace de acceso."
        migas={[{ etiqueta: 'Usuarios', href: '/admin/usuarios' }, { etiqueta: 'Invitar' }]}
      />
      <FormularioInvitar
        organizaciones={organizaciones.map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo }))}
        {...(param(sp.organizacion) ? { organizacionInicial: param(sp.organizacion) as string } : {})}
        vigenciaMinutos={getConfig().ENLACE_VIGENCIA_MINUTOS}
      />
    </ContenedorLectura>
  );
}
