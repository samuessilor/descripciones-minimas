import type { Metadata } from 'next';
import { FormularioCrearCuenta } from '@/componentes/admin/FormularioCrearCuenta';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { listarOrganizacionesAdmin } from '@/server/politicas/administracion';
import { contextoAdmin, param } from '../../_contexto';

export const metadata: Metadata = { title: 'Crear cuenta · Descripciones mínimas' };

export default async function CrearCuenta({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return null;
  const sp = await searchParams;
  const organizaciones = (await listarOrganizacionesAdmin(ctx.db, ctx.actor)).filter((o) => o.activa);
  return (
    <ContenedorLectura>
      <EncabezadoPagina
        titulo="Crear cuenta"
        descripcion="No hay registro abierto: entra solo quien tiene una cuenta creada aquí. Lo normal es una cuenta por área y una por agencia de aduana; se crea con un usuario y una contraseña temporal que tú entregas."
        migas={[{ etiqueta: 'Usuarios', href: '/admin/usuarios' }, { etiqueta: 'Crear cuenta' }]}
      />
      <FormularioCrearCuenta
        organizaciones={organizaciones.map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo }))}
        {...(param(sp.organizacion) ? { organizacionInicial: param(sp.organizacion) as string } : {})}
      />
    </ContenedorLectura>
  );
}
