import { CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Etiqueta } from './etiqueta';

/**
 * Etiqueta + ayuda + control + error, ya cableados (WCAG 3.3.1/3.3.2/4.1.2):
 * `<label for>`, ayuda y error enlazados con `aria-describedby`, `aria-invalid` cuando hay error.
 * Reglas de la casa (10.2): etiqueta arriba, ayuda con EJEMPLO REAL debajo de la etiqueta, se marcan
 * los OPCIONALES (no los obligatorios), el error va debajo del campo y dice que hacer.
 *
 *   <CampoFormulario etiqueta="Descripcion segun factura" ayuda="Copiala tal cual de la factura." error={e}>
 *     {(p) => <Campo {...p} name="descripcion" />}
 *   </CampoFormulario>
 *
 * `children` recibe `{ id, 'aria-describedby', 'aria-invalid' }` para esparcir sobre el control.
 */
export interface PropsControl {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export function CampoFormulario({
  etiqueta,
  ayuda,
  error,
  opcional: _opcional = false,
  acciones,
  id: idExterno,
  className,
  children,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  /** Ya no se rotula «(opcional)»: se acepta para no tocar a quien lo pasa. */
  opcional?: boolean;
  /** Elemento a la derecha de la etiqueta (p. ej. «Igual que la marca»). */
  acciones?: ReactNode;
  id?: string;
  className?: string;
  children: (props: PropsControl) => ReactNode;
}) {
  const generado = useId();
  const id = idExterno ?? `campo-${generado.replace(/:/g, '')}`;
  const idAyuda = `${id}-ayuda`;
  const idError = `${id}-error`;
  const describe = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Etiqueta htmlFor={id}>
          {etiqueta}
        </Etiqueta>
        {acciones}
      </div>
      {ayuda ? (
        <p id={idAyuda} className="text-sm text-tinta-suave">
          {ayuda}
        </p>
      ) : null}
      {children({ id, 'aria-describedby': describe, ...(error ? { 'aria-invalid': true as const } : {}) })}
      {error ? <TextoError id={idError}>{error}</TextoError> : null}
    </div>
  );
}

/** Mensaje de error de campo: icono + texto (nunca solo color). */
export function TextoError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} className={cn('flex items-start gap-1.5 text-sm font-medium text-error', className)}>
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Agrupa controles relacionados con titulo (radios, casillas, bloques de campos). */
export function GrupoCampos({
  leyenda,
  ayuda,
  error,
  className,
  children,
}: {
  leyenda: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, '');
  return (
    <fieldset
      className={cn('min-w-0 space-y-2', className)}
      aria-describedby={[ayuda ? `${id}-ayuda` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined}
    >
      <legend className="mb-1 text-sm font-semibold text-tinta">{leyenda}</legend>
      {ayuda ? (
        <p id={`${id}-ayuda`} className="text-sm text-tinta-suave">
          {ayuda}
        </p>
      ) : null}
      {children}
      {error ? <TextoError id={`${id}-error`}>{error}</TextoError> : null}
    </fieldset>
  );
}
