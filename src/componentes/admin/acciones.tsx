'use client';

/**
 * Piezas cliente para llamar a las Server Actions de administracion con la misma conducta en todas partes:
 *  - `FormularioAccion`: un formulario con varios campos; muestra el error en linea (con foco) y el exito como aviso.
 *  - `BotonAccion`: una sola accion con parametros fijos; con `confirmar` pide confirmacion (y motivo si hace falta).
 * Las acciones llegan como props desde la pagina (referencias a Server Actions), nunca se escribe seguridad aqui:
 * el servidor vuelve a exigir el rol en cada llamada.
 */
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EstadoAdmin } from '@/app/acciones/admin';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton, type PropsBoton } from '@/componentes/ui/button';
import { DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { useAvisos } from '@/componentes/ui/toast';
import { ContextoFormulario } from './campos';

export type AccionAdmin = (previo: EstadoAdmin, datos: FormData) => Promise<EstadoAdmin>;
const INICIAL: EstadoAdmin = { estado: 'inicial' };

export function FormularioAccion({
  accion,
  children,
  enviar,
  enviando,
  variante = 'primario',
  tamano,
  className,
  reiniciar = false,
  secundario,
  deshabilitado = false,
  pieIzquierdo,
}: {
  accion: AccionAdmin;
  /** Desde una pagina de SERVIDOR pasa nodos (y usa `CampoAdmin` / `RadiosAdmin`); la funcion solo la admiten componentes cliente. */
  children: ReactNode | ((estado: EstadoAdmin) => ReactNode);
  /** Texto del boton («Guardar cambios»): un verbo y su objeto. */
  enviar: string;
  /** Texto mientras se envia («Guardando…»). */
  enviando: string;
  variante?: PropsBoton['variante'];
  tamano?: PropsBoton['tamano'];
  className?: string;
  /** Vacia el formulario al terminar bien (altas seguidas). */
  reiniciar?: boolean;
  /** Boton o enlace extra junto al principal («Cancelar»). */
  secundario?: ReactNode;
  deshabilitado?: boolean;
  pieIzquierdo?: ReactNode;
}) {
  const { avisar } = useAvisos();
  const router = useRouter();
  const formulario = useRef<HTMLFormElement | null>(null);
  const aviso = useRef<HTMLDivElement | null>(null);
  const ultima = useRef<number | undefined>(undefined);

  // El aviso de exito y la navegacion se hacen AQUI, cuando la accion responde, y no en un efecto: si la accion
  // cambia lo que la pagina muestra (desactivar a alguien quita el formulario), este componente ya no existe
  // cuando el efecto correria y la persona no veria ninguna confirmacion. El aviso vive en el layout raiz.
  const accionConAviso = useCallback(
    async (previo: EstadoAdmin, datos: FormData): Promise<EstadoAdmin> => {
      const r = await accion(previo, datos);
      if (r.estado === 'ok') {
        avisar({ tipo: 'exito', titulo: r.mensaje ?? 'Listo' });
        if (reiniciar) formulario.current?.reset();
        if (r.irA) router.push(r.irA);
      }
      return r;
    },
    [accion, avisar, reiniciar, router],
  );
  const [estado, enviarAccion, pendiente] = useActionState(accionConAviso, INICIAL);

  useEffect(() => {
    if (estado.estado !== 'error' || estado.marca === ultima.current) return;
    ultima.current = estado.marca;
    aviso.current?.focus();
  }, [estado]);

  // `<form action>` de React 19 vacia los campos al terminar, tambien cuando hubo un error: aqui NO, lo escrito se conserva.
  function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const datos = new FormData(e.currentTarget);
    startTransition(() => enviarAccion(datos));
  }

  return (
    <form ref={formulario} onSubmit={alEnviar} className={className} noValidate>
      <ContextoFormulario.Provider value={estado}>{typeof children === 'function' ? children(estado) : children}</ContextoFormulario.Provider>
      {estado.estado === 'error' ? (
        <div ref={aviso} tabIndex={-1} className="mt-4 outline-none">
          <Aviso tipo="error" titulo={estado.mensaje}>
            {(estado.detalles ?? Object.values(estado.errores ?? {})).length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-4">
                {(estado.detalles ?? Object.values(estado.errores ?? {})).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
          </Aviso>
        </div>
      ) : null}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Boton type="submit" variante={variante} tamano={tamano} cargando={pendiente} disabled={deshabilitado}>
          {pendiente ? enviando : enviar}
        </Boton>
        {secundario}
        {pieIzquierdo}
      </div>
    </form>
  );
}

export interface ConfirmacionBoton {
  titulo: string;
  descripcion: ReactNode;
  confirmar: string;
  cancelar?: string;
  peligro?: boolean;
  /** Pide un motivo y lo envia en este campo. */
  campoMotivo?: string;
  etiquetaMotivo?: string;
  ayudaMotivo?: string;
}

export function BotonAccion({
  accion,
  campos,
  children,
  variante = 'secundario',
  tamano = 'sm',
  confirmar,
  className,
  etiquetaAria,
  deshabilitado,
}: {
  accion: AccionAdmin;
  campos: Record<string, string>;
  children: ReactNode;
  variante?: PropsBoton['variante'];
  tamano?: PropsBoton['tamano'];
  confirmar?: ConfirmacionBoton;
  className?: string;
  etiquetaAria?: string;
  deshabilitado?: boolean;
}) {
  const { avisar } = useAvisos();
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);

  async function ejecutar(motivo?: string): Promise<EstadoAdmin> {
    const datos = new FormData();
    for (const [k, v] of Object.entries(campos)) datos.set(k, v);
    if (motivo !== undefined && confirmar?.campoMotivo) datos.set(confirmar.campoMotivo, motivo);
    const r = await accion(INICIAL, datos);
    if (r.estado === 'ok') {
      avisar({ tipo: 'exito', titulo: r.mensaje ?? 'Listo' });
      if (r.irA) router.push(r.irA);
    }
    return r;
  }

  async function alPulsar() {
    if (confirmar) {
      setAbierto(true);
      return;
    }
    setCargando(true);
    try {
      const r = await ejecutar();
      if (r.estado === 'error') avisar({ tipo: 'error', titulo: r.mensaje ?? 'No pudimos hacerlo', descripcion: 'Intenta de nuevo; si sigue, avisa al administrador.' });
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <Boton variante={variante} tamano={tamano} onClick={alPulsar} cargando={cargando} disabled={deshabilitado} className={className} aria-label={etiquetaAria}>
        {children}
      </Boton>
      {confirmar ? (
        <DialogoConfirmacion
          abierto={abierto}
          onCerrar={() => setAbierto(false)}
          titulo={confirmar.titulo}
          descripcion={confirmar.descripcion}
          confirmar={confirmar.confirmar}
          cancelar={confirmar.cancelar ?? 'Todavía no'}
          peligro={confirmar.peligro}
          pedirMotivo={!!confirmar.campoMotivo}
          etiquetaMotivo={confirmar.etiquetaMotivo}
          ayudaMotivo={confirmar.ayudaMotivo}
          onConfirmar={async (motivo) => {
            const r = await ejecutar(motivo);
            if (r.estado === 'error') throw new Error(r.mensaje);
          }}
        />
      ) : null}
    </>
  );
}
