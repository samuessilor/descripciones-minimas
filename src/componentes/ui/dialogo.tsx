'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { AreaTexto } from './input';
import { Boton } from './button';
import { CampoFormulario } from './campo-formulario';

/**
 * Dialogo modal sobre el elemento nativo `<dialog>` + `showModal()`: el navegador atrapa el foco, hace
 * inerte el resto de la pagina, cierra con Esc y devuelve el foco a quien lo abrio. Aqui se le suma
 * titulo accesible, cierre al pulsar el fondo, animacion de entrada/salida y variantes.
 *
 *   <Dialogo abierto={abierto} onCerrar={() => setAbierto(false)} titulo="Enviar NSR E1 a…" pie={<>…</>}>…</Dialogo>
 *
 * - `onCerrar` se llama con Esc, con la X y con el fondo (si `cerrarConFondo`). Tu controlas `abierto`.
 * - Marca con `data-autofocus` el elemento que debe recibir el foco al abrir (por defecto, el primero).
 * - Usalo para decisiones que bloquean (confirmar, motivo, enviar). Lo que el usuario consulta mientras
 *   trabaja (historial, comentarios) va en `Cajon`. Un modal nunca es la primera opcion: prefiere en linea.
 * - El contenido sigue montado mientras esta cerrado: monta el dialogo condicionalmente o usa `key`
 *   si quieres reiniciar formularios.
 */
type Tamano = 'sm' | 'md' | 'lg';
const ANCHO: Record<Tamano, string> = { sm: 'sm:w-[26rem]', md: 'sm:w-[34rem]', lg: 'sm:w-[44rem]' };

function useModal(abierto: boolean, onCerrar: () => void, cerrarConFondo: boolean, bloquear: boolean) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const cerrarRef = useRef(onCerrar);
  useEffect(() => {
    cerrarRef.current = onCerrar;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      d.showModal();
      const auto = d.querySelector<HTMLElement>('[data-autofocus]');
      auto?.focus();
    } else if (!abierto && d.open) {
      d.close();
    }
  }, [abierto]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const alCancelar = (e: Event) => {
      if (bloquear) e.preventDefault(); // Esc no cierra mientras se envia
    };
    const alCerrar = () => cerrarRef.current();
    d.addEventListener('cancel', alCancelar);
    d.addEventListener('close', alCerrar);
    return () => {
      d.removeEventListener('cancel', alCancelar);
      d.removeEventListener('close', alCerrar);
    };
  }, [bloquear]);

  // Tab y Mayus+Tab dan la vuelta dentro del dialogo (sin salir a la interfaz del navegador).
  const alTeclear = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const foco = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null);
    if (foco.length === 0) return;
    const primero = foco[0]!;
    const ultimo = foco[foco.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  const alPulsar = (e: MouseEvent<HTMLDialogElement>) => {
    // El panel ocupa todo el dialogo: un clic cuyo destino es el propio <dialog> cayo en el fondo.
    if (cerrarConFondo && !bloquear && e.target === e.currentTarget) ref.current?.close();
  };
  return { ref, alPulsar, alTeclear };
}

interface PropsBase {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion?: ReactNode;
  children: ReactNode;
  /** Zona de botones fija abajo. */
  pie?: ReactNode;
  cerrarConFondo?: boolean;
  /** Mientras es true no se puede cerrar (enviando). */
  bloquear?: boolean;
  className?: string;
}

export function Dialogo({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  pie,
  tamano = 'md',
  cerrarConFondo = true,
  bloquear = false,
  className,
}: PropsBase & { tamano?: Tamano }) {
  const id = useId().replace(/:/g, '');
  const { ref, alPulsar, alTeclear } = useModal(abierto, onCerrar, cerrarConFondo, bloquear);
  return (
    <dialog
      ref={ref}
      className="dialogo"
      aria-labelledby={`dlg-t-${id}`}
      aria-describedby={descripcion ? `dlg-d-${id}` : undefined}
      onClick={alPulsar}
      onKeyDown={alTeclear}
    >
      <div
        className={cn(
          'dialogo-panel flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-superficie shadow-modal',
          ANCHO[tamano],
          className,
        )}
      >
        <div className="flex items-start gap-4 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <h2 id={`dlg-t-${id}`} className="font-display text-xl font-extrabold leading-snug text-tinta">
              {titulo}
            </h2>
            {descripcion ? (
              <p id={`dlg-d-${id}`} className="mt-1.5 text-base text-tinta-suave">
                {descripcion}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            disabled={bloquear}
            onClick={() => ref.current?.close()}
            className="-mr-2 -mt-1 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-tinta-suave hover:bg-azul-50 hover:text-tinta disabled:opacity-40"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {pie ? <div className="flex flex-wrap justify-end gap-3 border-t border-borde-suave bg-superficie-2 px-6 py-4 max-sm:flex-col-reverse [&>*]:max-sm:w-full">{pie}</div> : null}
      </div>
    </dialog>
  );
}

/**
 * Cajon lateral (derecha, 384 px) que en movil es una hoja inferior (11.6). Superpuesto: no ensancha la
 * pagina. Para historial, comentarios y el menu «Mas» de movil. Mismo contrato que `Dialogo`.
 */
export function Cajon({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  children,
  pie,
  cerrarConFondo = true,
  bloquear = false,
  className,
}: PropsBase) {
  const id = useId().replace(/:/g, '');
  const { ref, alPulsar, alTeclear } = useModal(abierto, onCerrar, cerrarConFondo, bloquear);
  return (
    <dialog
      ref={ref}
      className="dialogo dialogo-cajon"
      aria-labelledby={`caj-t-${id}`}
      aria-describedby={descripcion ? `caj-d-${id}` : undefined}
      onClick={alPulsar}
      onKeyDown={alTeclear}
    >
      <div className={cn('dialogo-panel flex h-full flex-col overflow-hidden bg-superficie shadow-modal sm:rounded-l-2xl', className)}>
        <div className="flex items-start gap-3 border-b border-borde-suave px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={`caj-t-${id}`} className="font-display text-lg font-extrabold leading-snug text-tinta">
              {titulo}
            </h2>
            {descripcion ? (
              <p id={`caj-d-${id}`} className="mt-1 text-sm text-tinta-suave">
                {descripcion}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => ref.current?.close()}
            className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-tinta-suave hover:bg-azul-50 hover:text-tinta"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {pie ? <div className="border-t border-borde-suave bg-superficie-2 px-5 py-4">{pie}</div> : null}
      </div>
    </dialog>
  );
}

/**
 * Dialogo de confirmacion (patron estandar): titulo con la accion, una frase que dice que pasara, y dos
 * botones con verbos («Cerrar clasificacion» / «Todavia no»), nunca «Aceptar / Cancelar». Con `pedirMotivo`
 * el boton no se activa hasta que haya un motivo con texto visible (reabrir, archivar, reemplazar valor ajeno).
 *
 *   <DialogoConfirmacion abierto titulo="Cerrar la clasificacion" descripcion="La referencia quedara en verde…"
 *     confirmar="Cerrar clasificacion" cancelar="Todavia no" onConfirmar={async (motivo) => { … }} onCerrar={…} />
 *
 * `onConfirmar` puede ser asincrona: mientras corre, el boton muestra «cargando» y el dialogo no se cierra.
 * Si lanza, el mensaje se muestra dentro del dialogo (con salida) y el dialogo sigue abierto.
 */
export function DialogoConfirmacion({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  confirmar,
  cancelar = 'Cancelar',
  onConfirmar,
  peligro = false,
  pedirMotivo = false,
  etiquetaMotivo = 'Motivo',
  ayudaMotivo,
  children,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion: ReactNode;
  confirmar: string;
  cancelar?: string;
  onConfirmar: (motivo: string) => void | Promise<void>;
  peligro?: boolean;
  pedirMotivo?: boolean;
  etiquetaMotivo?: string;
  ayudaMotivo?: string;
  children?: ReactNode;
}) {
  const [motivo, setMotivo] = useState('');
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = motivo.replace(/[\s\p{Cc}\p{Cf}]/gu, '').length > 0;

  async function aceptar() {
    setEnCurso(true);
    setError(null);
    try {
      await onConfirmar(motivo.trim());
      setMotivo('');
      onCerrar();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.');
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={() => {
        setError(null);
        onCerrar();
      }}
      titulo={titulo}
      descripcion={descripcion}
      tamano="sm"
      bloquear={enCurso}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={enCurso} data-autofocus={!pedirMotivo ? '' : undefined}>
            {cancelar}
          </Boton>
          <Boton
            variante={peligro ? 'peligro' : 'primario'}
            onClick={aceptar}
            cargando={enCurso}
            disabled={pedirMotivo && !visible}
          >
            {confirmar}
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {pedirMotivo ? (
          <CampoFormulario etiqueta={etiquetaMotivo} ayuda={ayudaMotivo}>
            {(p) => <AreaTexto {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} data-autofocus="" />}
          </CampoFormulario>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md border border-error/60 bg-error-fondo px-3 py-2 text-sm font-medium text-error">
            {error}
          </p>
        ) : null}
      </div>
    </Dialogo>
  );
}
