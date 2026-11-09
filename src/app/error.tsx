'use client';

import { ErrorGeneral } from '@/componentes/ui/pantallas';

/** Error fuera del armazon (entrada, raiz). El detalle tecnico va plegado, con el identificador del error. */
export default function ErrorGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenido" tabIndex={-1} className="outline-none">
      <ErrorGeneral reset={reset} digest={error.digest} />
    </main>
  );
}
