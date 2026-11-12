'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { verClaveEntregaAccion } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { fechaHora } from './formato';
import { TextoCopiable } from './TextoCopiable';

/**
 * «Ver contraseña»: solo el administrador. Pide al servidor la contrasena de ENTREGA de la cuenta (la que se genero al crearla
 * o al restablecerla) y la muestra con su boton Copiar. No viaja en la pagina: se pide al pulsar y cada vez queda una fila en la
 * auditoria. Si la persona ya la cambio, o la cuenta se creo fuera de la plataforma, no hay copia y se dice como obtener una.
 */
export function VerClave({ usuarioId, usuario }: { usuarioId: string; usuario: string }) {
  const [estado, setEstado] = useState<
    { tipo: 'oculta' } | { tipo: 'cargando' } | { tipo: 'visible'; clave: string; desde: string | null } | { tipo: 'sinCopia' } | { tipo: 'error'; mensaje: string }
  >({ tipo: 'oculta' });

  async function ver() {
    setEstado({ tipo: 'cargando' });
    const r = await verClaveEntregaAccion({ usuarioId });
    if (!r.ok) {
      setEstado({ tipo: 'error', mensaje: r.mensaje });
      return;
    }
    setEstado(r.data.clave ? { tipo: 'visible', clave: r.data.clave, desde: r.data.desde } : { tipo: 'sinCopia' });
  }

  return (
    <div className="space-y-3" data-testid="ver-clave">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-tinta">Usuario</p>
        <TextoCopiable texto={usuario} etiqueta="usuario" />
      </div>

      {estado.tipo === 'visible' ? (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-tinta">Contraseña actual</p>
          <TextoCopiable texto={estado.clave} etiqueta="contraseña" />
          {estado.desde ? <p className="text-sm text-tinta-suave">Guardada el {fechaHora(estado.desde)}. Si la persona la cambia, aquí verás la nueva.</p> : null}
          <Boton variante="terciario" tamano="sm" onClick={() => setEstado({ tipo: 'oculta' })}>
            <EyeOff aria-hidden className="size-4" />
            Ocultar contraseña
          </Boton>
        </div>
      ) : (
        <Boton variante="secundario" tamano="md" onClick={() => void ver()} cargando={estado.tipo === 'cargando'} data-testid="ver-clave-boton">
          <Eye aria-hidden className="size-4" />
          Ver contraseña
        </Boton>
      )}

      {estado.tipo === 'sinCopia' ? (
        <Aviso tipo="info" titulo="No hay contraseña guardada para esta cuenta">
          La cuenta es anterior a esta función o se creó fuera de la plataforma, y de la contraseña solo existe su huella (no se puede recuperar). Restablécela una vez: la nueva queda guardada y desde entonces la ves aquí siempre.
        </Aviso>
      ) : null}
      {estado.tipo === 'error' ? (
        <Aviso tipo="error" titulo="No pudimos mostrarla">
          {estado.mensaje}
        </Aviso>
      ) : null}
    </div>
  );
}
