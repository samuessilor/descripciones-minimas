'use client';

import { Clock, Link2Off, MousePointerClick, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';
import { confirmarEnlaceAccion, type EstadoFormulario } from '@/app/acciones/sesion';
import { Boton, botonVariantes } from '@/componentes/ui/button';
import { cn } from '@/lib/utils';

const INICIAL: EstadoFormulario = { estado: 'inicial' };

const ICONO = { vencido: Clock, usado: MousePointerClick, invalido: Link2Off } as const;
/** El titulo es el mismo para los tres: la frase exacta (venció / ya se usó / no es válido) la dice el mensaje. */
const TITULO = {
  vencido: 'Necesitas un enlace nuevo',
  usado: 'Este enlace ya no sirve',
  invalido: 'No pudimos usar este enlace',
} as const;

/** Enlace vencido, usado o invalido: dice que paso y ofrece la salida (pedir otro). 10.6. */
export function EnlaceNoUsable({
  motivo,
  mensaje,
  siguiente,
}: {
  motivo: keyof typeof TITULO;
  mensaje?: string;
  siguiente: string;
}) {
  const Icono = ICONO[motivo];
  const nuevo = siguiente === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(siguiente)}`;
  return (
    <div className="space-y-6">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-azul-200 bg-azul-50 text-azul-700">
        <Icono aria-hidden className="size-7" strokeWidth={1.7} />
      </span>
      <div role="alert" className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta sm:text-3xl">{TITULO[motivo]}</h1>
        <p className="text-base text-tinta-suave">{mensaje ?? 'Pide uno nuevo y te llega en un minuto.'}</p>
      </div>
      <div className="flex flex-col gap-3">
        <Link href={nuevo} className={cn(botonVariantes({ tamano: 'lg' }), 'w-full')}>
          Pedir uno nuevo
        </Link>
        {motivo === 'usado' ? (
          <Link href={siguiente} className={cn(botonVariantes({ variante: 'secundario', tamano: 'lg' }), 'w-full')}>
            {siguiente === '/' ? 'Ir a mis pendientes' : 'Ir a la referencia'}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * El enlace del correo NO consume el token al abrirse: esta pagina solo MUESTRA un boton cuyo POST
 * (Server Action) lo consume, para que un escaner de enlaces del correo no lo queme (13.1, RV-17).
 * El boton se deshabilita al primer clic (doble clic).
 */
export function FormularioConfirmar({ token, siguiente }: { token: string; siguiente: string }) {
  const [estado, accion, pendiente] = useActionState(confirmarEnlaceAccion, INICIAL);

  if (estado.estado === 'error') {
    return <EnlaceNoUsable motivo={estado.motivo ?? 'invalido'} mensaje={estado.mensaje} siguiente={siguiente} />;
  }

  return (
    <form action={accion} className="space-y-6">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-azul-200 bg-azul-50 text-azul-700">
        <ShieldCheck aria-hidden className="size-7" strokeWidth={1.7} />
      </span>
      <div className="space-y-2">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-tinta sm:text-3xl">Confirma que eres tú</h1>
        <p className="text-base text-tinta-suave">Pulsa el botón para entrar a Descripciones mínimas.</p>
      </div>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="siguiente" value={siguiente} />

      <Boton type="submit" tamano="lg" className="w-full" cargando={pendiente}>
        {pendiente ? 'Entrando…' : 'Entrar'}
      </Boton>

      <p className="border-t border-borde-suave pt-4 text-sm text-tinta-suave">
        Este paso evita que el programa de tu correo gaste el enlace antes que tú.
      </p>
    </form>
  );
}
