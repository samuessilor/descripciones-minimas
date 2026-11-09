'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { restablecerClaveAccion, type SecretoEntrega } from '@/app/acciones/admin';
import { Boton } from '@/componentes/ui/button';
import { Dialogo, DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { useAvisos } from '@/componentes/ui/toast';
import { CredencialesEntrega } from './CredencialesEntrega';

/** «Restablecer contraseña»: confirma, genera una temporal, cierra las sesiones de esa cuenta y la muestra una vez. */
export function RestablecerClave({ usuarioId, nombre, variante = 'secundario' }: { usuarioId: string; nombre: string; variante?: 'primario' | 'secundario' }) {
  const { avisar } = useAvisos();
  const [confirmando, setConfirmando] = useState(false);
  const [secreto, setSecreto] = useState<SecretoEntrega | null>(null);

  return (
    <>
      <Boton variante={variante} tamano="md" onClick={() => setConfirmando(true)} data-testid="restablecer-clave">
        <KeyRound aria-hidden className="size-4" />
        Restablecer contraseña
      </Boton>
      <DialogoConfirmacion
        abierto={confirmando}
        onCerrar={() => setConfirmando(false)}
        titulo="Restablecer la contraseña"
        descripcion={`Generamos una contraseña nueva para ${nombre} y cerramos sus sesiones abiertas. La anterior deja de servir.`}
        confirmar="Restablecer"
        cancelar="Todavía no"
        onConfirmar={async () => {
          const datos = new FormData();
          datos.set('usuarioId', usuarioId);
          const r = await restablecerClaveAccion({ estado: 'inicial' }, datos);
          if (r.estado === 'error' || !r.secreto) throw new Error(r.mensaje ?? 'No pudimos restablecerla.');
          avisar({ tipo: 'exito', titulo: r.mensaje ?? 'Listo' });
          setSecreto(r.secreto);
        }}
      />
      {secreto ? (
        <Dialogo
          abierto
          onCerrar={() => setSecreto(null)}
          titulo={`Contraseña nueva de ${secreto.nombre}`}
          pie={
            <Boton onClick={() => setSecreto(null)} data-autofocus="">
              Listo, ya la copié
            </Boton>
          }
        >
          <CredencialesEntrega secreto={secreto} />
        </Dialogo>
      ) : null}
    </>
  );
}
