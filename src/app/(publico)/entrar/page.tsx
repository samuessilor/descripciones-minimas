import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { siguienteSeguro } from '@/dominio/redireccion';
import { getConfig } from '@/server/config';
import { cuentasDemo } from '@/server/cuentas-demo';
import { getActor } from '@/server/sesion';
import { FormularioEntrada } from './formulario-entrada';

export const metadata: Metadata = { title: 'Entrar · Descripciones mínimas' };
export const dynamic = 'force-dynamic';

export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<{ siguiente?: string }> }) {
  const { siguiente } = await searchParams;
  const destino = siguienteSeguro(siguiente);
  // Si ya hay sesion valida, no se pide el enlace otra vez.
  if (await getActor()) redirect(destino);
  // Solo desarrollo con `npm run inicio`: sin login, se entra como admin (ver MenuUsuario para cambiar de cuenta).
  if (process.env.NODE_ENV === 'development' && process.env.SIN_LOGIN === '1') {
    redirect(`/api/dev/entrar?correo=${cuentasDemo()[0]!.email}&siguiente=${encodeURIComponent(destino)}`);
  }
  return <FormularioEntrada siguiente={destino} contacto={getConfig().CONTACTO_ADMIN} />;
}
