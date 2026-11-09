import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { ProveedorAvisos } from '@/componentes/ui/toast';
import { manrope, sourceSans } from './fuentes';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Descripciones mínimas', template: '%s' },
  description: 'Plataforma de descripciones mínimas de EssilorLuxottica · Supply Chain.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#071f4a',
};

export default function LayoutRaiz({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CO" className={`${manrope.variable} ${sourceSans.variable}`}>
      <body className="font-sans antialiased">
        <a href="#contenido" className="enlace-saltar">
          Saltar al contenido
        </a>
        <ProveedorAvisos>{children}</ProveedorAvisos>
      </body>
    </html>
  );
}
