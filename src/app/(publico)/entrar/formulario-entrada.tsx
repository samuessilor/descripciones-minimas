'use client';

import { Eye, EyeOff, UserRound } from 'lucide-react';
import { useActionState, useState } from 'react';
import { iniciarSesionAccion, type EstadoFormulario } from '@/app/acciones/sesion';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Campo } from '@/componentes/ui/input';

const INICIAL: EstadoFormulario = { estado: 'inicial' };

/** Dos campos (usuario y contrasena) y un boton. No hay registro: las cuentas las entrega un administrador. */
export function FormularioEntrada({ siguiente, contacto }: { siguiente: string; contacto: string }) {
  const [estado, accion, pendiente] = useActionState(iniciarSesionAccion, INICIAL);
  const [verClave, setVerClave] = useState(false);

  return (
    <form action={accion} className="space-y-6" noValidate>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta sm:text-3xl">Entrar</h1>
        <p className="text-base text-tinta-suave">Escribe el usuario y la contraseña que te entregó el administrador.</p>
      </div>

      <input type="hidden" name="siguiente" value={siguiente} />

      <CampoFormulario etiqueta="Usuario" ayuda="Por ejemplo: consumibles.essilorluxottica">
        {(p) => (
          <div className="relative">
            <UserRound aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" />
            <Campo
              {...p}
              key={estado.marca ?? 0}
              name="usuario"
              defaultValue={estado.usuario ?? ''}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              required
              className="pl-11"
            />
          </div>
        )}
      </CampoFormulario>

      <CampoFormulario etiqueta="Contraseña">
        {(p) => (
          <div className="relative">
            <Campo {...p} name="clave" type={verClave ? 'text' : 'password'} autoComplete="current-password" required className="pr-12" />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              aria-label={verClave ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
              aria-pressed={verClave}
              className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-tinta-suave hover:bg-azul-50 hover:text-tinta"
            >
              {verClave ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
            </button>
          </div>
        )}
      </CampoFormulario>

      {estado.estado !== 'inicial' ? (
        <div role="alert" key={estado.marca}>
          <Aviso tipo="error">{estado.mensaje}</Aviso>
        </div>
      ) : null}

      <Boton type="submit" tamano="lg" className="w-full" cargando={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </Boton>

      <p className="border-t border-borde-suave pt-4 text-sm text-tinta-suave">¿No tienes usuario o olvidaste la contraseña? Consulta con {contacto}.</p>
    </form>
  );
}
