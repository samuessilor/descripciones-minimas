'use client';

import { Mail, MailCheck } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';
import { solicitarEnlaceAccion, type EstadoFormulario } from '@/app/acciones/sesion';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Campo } from '@/componentes/ui/input';

const INICIAL: EstadoFormulario = { estado: 'inicial' };
const ESPERA_REENVIO_S = 30;

/**
 * Boton unico del formulario. Se vuelve a montar (por `key`) con cada respuesta "enviado", asi la
 * cuenta de 30 s para «Reenviar» arranca sola sin tocar estado dentro de un efecto.
 */
function BotonEnviar({ pendiente, enviado }: { pendiente: boolean; enviado: boolean }) {
  const [segundos, setSegundos] = useState(enviado ? ESPERA_REENVIO_S : 0);

  useEffect(() => {
    if (!enviado) return;
    const t = setInterval(() => setSegundos((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [enviado]);

  return (
    <Boton
      type="submit"
      tamano="lg"
      variante={enviado ? 'secundario' : 'primario'}
      className="w-full"
      cargando={pendiente}
      disabled={segundos > 0}
    >
      {pendiente
        ? 'Enviando…'
        : enviado
          ? segundos > 0
            ? `Reenviar en ${segundos} s`
            : 'Reenviar el enlace'
          : 'Enviarme el enlace'}
    </Boton>
  );
}

/** Un solo campo (correo, `autocomplete="email"`) y un solo boton (10.6). Funciona tambien sin JavaScript. */
export function FormularioEntrada({ siguiente, contacto }: { siguiente: string; contacto: string }) {
  const [estado, accion, pendiente] = useActionState(solicitarEnlaceAccion, INICIAL);
  const enviado = estado.estado === 'enviado';
  const errorCorreo = estado.estado === 'error' && estado.mensaje?.startsWith('Escribe un correo') ? estado.mensaje : undefined;
  const errorGeneral = estado.estado === 'error' && !errorCorreo;

  return (
    <form action={accion} className="space-y-6" noValidate>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta sm:text-3xl">Entrar</h1>
        <p className="text-base text-tinta-suave">Escribe tu correo y te enviamos un enlace para entrar. Sin contraseñas.</p>
      </div>

      <input type="hidden" name="siguiente" value={siguiente} />

      <CampoFormulario etiqueta="Correo" ayuda="Usa el correo con el que te invitaron." error={errorCorreo}>
        {(p) => (
          <div className="relative">
            <Mail aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-tinta-suave" />
            <Campo
              {...p}
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="nombre@empresa.com"
              autoFocus
              required
              className="pl-11"
            />
          </div>
        )}
      </CampoFormulario>

      {enviado ? (
        <div role="status" className="flex gap-3 rounded-xl border border-azul-200 bg-azul-50 p-4 text-azul-900">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-azul-700 text-white">
            <MailCheck aria-hidden className="size-5" />
          </span>
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Revisa tu correo</p>
            <p>{estado.mensaje}</p>
          </div>
        </div>
      ) : null}
      {estado.estado === 'limite' ? <Aviso tipo="error">{estado.mensaje}</Aviso> : null}
      {errorGeneral ? <Aviso tipo="error">{estado.mensaje}</Aviso> : null}

      <BotonEnviar key={estado.marca ?? 0} pendiente={pendiente} enviado={enviado} />

      <p className="border-t border-borde-suave pt-4 text-sm text-tinta-suave">¿No llega? Pídele acceso a {contacto}.</p>
    </form>
  );
}
