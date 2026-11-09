import type { Metadata } from 'next';
import { siguienteSeguro } from '@/dominio/redireccion';
import { EnlaceNoUsable, FormularioConfirmar } from './formulario-confirmar';

export const metadata: Metadata = { title: 'Confirmar acceso · Descripciones mínimas' };
export const dynamic = 'force-dynamic';

export default async function PaginaConfirmar({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; siguiente?: string }>;
}) {
  const { token, siguiente } = await searchParams;
  const destino = siguienteSeguro(siguiente);
  if (!token) {
    return <EnlaceNoUsable motivo="invalido" mensaje="Este enlace no es válido. Pide uno nuevo." siguiente={destino} />;
  }
  return <FormularioConfirmar token={token} siguiente={destino} />;
}
