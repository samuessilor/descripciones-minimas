'use client';

import { ErrorGeneral } from '@/componentes/ui/pantallas';

/** Error dentro del armazon: la barra y el menu siguen ahi, solo falla el contenido. */
export default function ErrorEnApp({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorGeneral reset={reset} digest={error.digest} compacto />;
}
