'use client';

import { Compass, Lock, LogIn, RefreshCw, ServerCrash } from 'lucide-react';
import Link from 'next/link';
import { Boton, botonVariantes } from './button';
import { PantallaEstado } from './pantalla-estado';

/**
 * Pantallas de estado ya redactadas con los textos del SPEC 10.5 y 10.6. Cada una responde a QUE paso,
 * y ofrece una SALIDA. Usalas tal cual en vez de escribir otras: asi el tono es el mismo en todas partes.
 */

export function ErrorGeneral({ reset, digest, compacto = false }: { reset?: () => void; digest?: string; compacto?: boolean }) {
  return (
    <PantallaEstado
      icono={ServerCrash}
      titulo="Algo salió mal"
      compacto={compacto}
      detalle={digest ? `Referencia del error: ${digest}` : undefined}
      acciones={
        <>
          {reset ? (
            <Boton onClick={reset}>
              <RefreshCw aria-hidden className="size-4" />
              Reintentar
            </Boton>
          ) : null}
          <Link href="/" className={botonVariantes({ variante: 'secundario' })}>
            Ir al inicio
          </Link>
        </>
      }
    >
      <p>Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.</p>
      <p>No perdiste nada de lo que ya estaba guardado.</p>
    </PantallaEstado>
  );
}

export function NoEncontrada({ aduana = false, compacto = false }: { aduana?: boolean; compacto?: boolean }) {
  return (
    <PantallaEstado
      icono={Compass}
      titulo="No encontramos esa página"
      compacto={compacto}
      acciones={
        <>
          <Link href="/referencias" className={botonVariantes()}>
            Ir a Referencias
          </Link>
          <Link href="/" className={botonVariantes({ variante: 'secundario' })}>
            Ir al inicio
          </Link>
        </>
      }
    >
      <p>
        {aduana
          ? 'Esta referencia no está asignada a tu cuenta. Pide acceso a quien te la envió.'
          : 'No encontramos esa referencia. Revisa el enlace o búscala por código.'}
      </p>
    </PantallaEstado>
  );
}

export function SinPermiso({ compacto = true }: { compacto?: boolean }) {
  return (
    <PantallaEstado
      icono={Lock}
      titulo="No tienes permiso para ver esto"
      compacto={compacto}
      acciones={
        <Link href="/" className={botonVariantes()}>
          Ir al inicio
        </Link>
      }
    >
      <p>No tienes permiso para ver esta sección. Pídele acceso a un administrador.</p>
    </PantallaEstado>
  );
}

export function SesionVencida({ siguiente = '/' }: { siguiente?: string }) {
  const href = siguiente === '/' ? '/entrar' : `/entrar?siguiente=${encodeURIComponent(siguiente)}`;
  return (
    <PantallaEstado
      icono={LogIn}
      titulo="Tu sesión venció"
      acciones={
        <Link href={href} className={botonVariantes()}>
          Entrar de nuevo
        </Link>
      }
    >
      <p>Entra de nuevo y volverás a esta misma página. Lo que ya estaba guardado sigue ahí.</p>
    </PantallaEstado>
  );
}
