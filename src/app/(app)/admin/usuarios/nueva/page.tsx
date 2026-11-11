import type { Metadata } from 'next';
import { FormularioCrearCuenta } from '@/componentes/admin/FormularioCrearCuenta';
import { ContenedorLectura, EncabezadoPagina } from '@/componentes/ui/pagina';
import { puede } from '@/dominio/permisos';
import { listarOrganizacionesAdmin } from '@/server/politicas/administracion';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin, param } from '../../_contexto';

export const metadata: Metadata = { title: 'Crear cuenta · Descripciones mínimas' };

export default async function CrearCuenta({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const sp = await searchParams;
  const organizaciones = (await listarOrganizacionesAdmin(ctx.db, ctx.actor)).filter((o) => o.activa);
  return (
    <ContenedorLectura>
      <EncabezadoPagina
        titulo="Crear cuenta"
        descripcion={
          puede(ctx.actor, 'administrar')
            ? 'No hay registro abierto: entra solo quien tiene una cuenta creada aquí. Una cuenta por área; las agencias de aduana se crean completas desde Organizaciones. Se crea con un usuario y una contraseña temporal que tú entregas.'
            : 'No hay registro abierto: entra solo quien tiene una cuenta creada aquí. Una cuenta por área; las agencias de aduana se crean completas desde Organizaciones. La contraseña se genera sola y solo la ve el administrador, que la entrega.'
        }
        migas={[{ etiqueta: 'Usuarios', href: '/admin/usuarios' }, { etiqueta: 'Crear cuenta' }]}
      />
      <FormularioCrearCuenta
        actorRol={ctx.actor.rol}
        organizaciones={organizaciones.map((o) => ({ id: o.id, nombre: o.nombre, tipo: o.tipo }))}
        {...(param(sp.organizacion) ? { organizacionInicial: param(sp.organizacion) as string } : {})}
      />
    </ContenedorLectura>
  );
}
