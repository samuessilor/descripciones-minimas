'use client';

import { ArrowRight, CircleCheck, ClipboardList, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BotonEnviarA } from '@/componentes/slots/BotonEnviarA';
import { botonVariantes, Boton } from '@/componentes/ui/button';
import { cn } from '@/lib/utils';

export interface PropsSiguientePaso {
  referenciaId: string;
  /** Quien llena el area (solicitante o admin) o la aduana; el lector no ve el panel. */
  rolAduana: boolean;
  cerrada: boolean;
  estado: string;
  faltanArea: number;
  /** Claves que faltan de la parte de la aduana (`comp.aduana.faltantes`). */
  faltantesAduana: readonly string[];
  /** Hay campos escribiendose o guardandose ahora mismo. */
  hayPendientes: boolean;
  hayError: boolean;
  /** Quien tiene ahora la parte de la aduana («Andrés (Agencia Demo A)»); vacio = nadie se la ha enviado. */
  responsablesAduana: readonly string[];
  puedeCrear: boolean;
  irAlPrimeroQueFalta: () => void;
}

/** Nombre corto de cada dato de la aduana en «Siguiente paso». */
const DATO_ADUANA: Record<string, string> = {
  partida_arancelaria: 'partida',
  descripciones_minimas: 'descripciones mínimas adicionales',
  restricciones: 'restricciones',
  observaciones_aduana: 'observaciones',
};

/**
 * Cierra la ficha diciendo que sigue. Todo se guarda solo al salir de cada campo; el boton «Guardar y volver»
 * solo espera a que termine el ultimo guardado y lleva a la lista, para que nadie dude de si quedo.
 */
export function SiguientePaso(p: PropsSiguientePaso) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    if (!saliendo || p.hayPendientes) return;
    // Si algo no se guardo, no se sale: se baja la bandera y se avisa debajo del boton.
    const t = setTimeout(() => (p.hayError ? setSaliendo(false) : router.push('/referencias')), 400);
    return () => clearTimeout(t);
  }, [saliendo, p.hayPendientes, p.hayError, router]);

  let titulo: string;
  let texto: string;
  let accion: ReactNode = null;

  if (p.cerrada) {
    titulo = 'Esta referencia ya está clasificada';
    texto = 'No tienes nada pendiente aquí.';
  } else if (p.rolAduana) {
    // Mismo criterio que el Inicio (describirFalta): el cierre y la respuesta del area no son datos de la aduana.
    const datos = p.faltantesAduana.filter((k) => k !== 'clasificacion_finalizada' && k !== 'respuesta_area');
    const irZona = (
      <a href="#zona-aduana" className={botonVariantes({ tamano: 'lg' })}>
        Ir a la zona de la aduana <ArrowRight aria-hidden className="size-4" />
      </a>
    );
    if (datos.length > 0) {
      titulo = 'Siguiente paso: completar la zona de la aduana';
      const n = datos.length;
      texto = `Falta${n === 1 ? '' : 'n'} ${n} ${n === 1 ? 'dato' : 'datos'} de la aduana (${datos.map((k) => DATO_ADUANA[k] ?? k).join(', ')}).`;
      accion = irZona;
    } else if (p.faltantesAduana.includes('respuesta_area')) {
      titulo = 'Esperando la respuesta del área';
      texto = 'El área recibió tu solicitud de información como pendiente y la responde en la zona de la aduana.';
    } else if (p.faltantesAduana.includes('clasificacion_finalizada')) {
      titulo = 'Falta cerrar la clasificación';
      texto = 'Si ya terminaste, marca la clasificación como finalizada en la zona de la aduana.';
      accion = irZona;
    } else {
      titulo = 'La parte de la aduana está completa';
      texto = 'Si ya terminaste, marca la clasificación como finalizada en la zona de la aduana.';
    }
  } else if (p.faltanArea > 0) {
    titulo = `Te ${p.faltanArea === 1 ? 'falta 1 campo' : `faltan ${p.faltanArea} campos`}`;
    // Solo se afirma que quedo guardado si de verdad no hay nada pendiente (el error se avisa abajo).
    texto = p.hayPendientes
      ? 'Puedes seguir ahora o volver después. Hay cambios sin guardar: se guardan al salir del campo.'
      : 'Puedes seguir ahora o volver después: lo que escribiste ya quedó guardado.';
    accion = (
      <Boton tamano="lg" onClick={p.irAlPrimeroQueFalta}>
        Ir al primero que falta <ArrowRight aria-hidden className="size-4" />
      </Boton>
    );
  } else if (p.estado === 'BORRADOR' || p.responsablesAduana.length === 0) {
    // Enviada solo a alguien del area (o devuelta) sigue sin agencia: el siguiente paso es enviarla a la aduana.
    titulo = 'Tu parte está completa. Siguiente paso: enviarla';
    texto = 'Envíala a la aduana (o a quien siga) para que la tome. Le llega un aviso con el enlace directo.';
    accion = <BotonEnviarA referenciaId={p.referenciaId} />;
  } else {
    titulo = 'Tu parte está completa';
    texto = `La referencia sigue su camino con la aduana: la tiene ${p.responsablesAduana.join(', ')}. Si hay que cambiar algo o avisar de nuevo, usa «Enviar a».`;
    accion = <BotonEnviarA referenciaId={p.referenciaId} />;
  }

  return (
    <section aria-labelledby="siguiente-paso-titulo" className="rounded-2xl border border-borde-suave bg-superficie p-5 shadow-suave sm:p-6" data-siguiente-paso>
      <div className="flex items-start gap-3">
        <span aria-hidden className={cn('mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full', p.cerrada ? 'bg-verde-fondo text-verde-texto' : 'bg-azul-50 text-azul-700')}>
          {p.cerrada ? <CircleCheck className="size-5" /> : <ClipboardList className="size-5" />}
        </span>
        <div className="min-w-0 space-y-1">
          <h2 id="siguiente-paso-titulo" className="font-display text-xl font-extrabold tracking-tight text-tinta">
            {titulo}
          </h2>
          <p className="text-base text-tinta-suave">{texto}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {accion}
        <Boton variante="secundario" tamano="lg" cargando={saliendo} onClick={() => setSaliendo(true)}>
          {saliendo ? 'Guardando…' : 'Guardar y volver al listado'}
        </Boton>
        {p.puedeCrear ? (
          <Link href="/referencias/nueva" className={botonVariantes({ variante: 'terciario', tamano: 'lg' })}>
            <Plus aria-hidden className="size-4" /> Crear otra referencia
          </Link>
        ) : null}
      </div>
      {p.hayError ? <p className="mt-3 text-sm text-error">Un campo no se guardó. Revísalo antes de salir.</p> : null}
    </section>
  );
}
