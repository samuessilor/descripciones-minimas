import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { listarPaises } from '@/dominio/paises';
import { Demos } from './demos';

export const metadata: Metadata = { title: 'Biblioteca de componentes · Desarrollo' };
export const dynamic = 'force-dynamic';

/**
 * Pagina de desarrollo: muestra TODOS los componentes de `componentes/ui/` para revisarlos con ojos y teclado.
 * Solo existe fuera de produccion (404 en produccion; el proxy tambien la bloquea y la hace publica en desarrollo).
 */
export default function PaginaDevUi() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Demos paises={listarPaises()} />;
}
