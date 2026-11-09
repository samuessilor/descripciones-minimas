import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';
import { GrupoCampos } from './campo-formulario';

/**
 * Casilla, radio e interruptor: `<input>` nativos con estilo (teclado y lectores de pantalla gratis).
 * Cada uno va dentro de un `<label>` que ocupa todo el renglon (objetivo tactil >= 44 px).
 */
interface PropsOpcion extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  etiqueta: ReactNode;
  descripcion?: ReactNode;
  ref?: Ref<HTMLInputElement>;
}

function Opcion({ tipo, claseControl, etiqueta, descripcion, className, id, ref, ...props }: PropsOpcion & { tipo: 'checkbox' | 'radio'; claseControl: string }) {
  const generado = useId().replace(/:/g, '');
  const idControl = id ?? `op-${generado}`;
  return (
    <label
      htmlFor={idControl}
      className={cn(
        'flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-azul-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      <input
        ref={ref}
        id={idControl}
        type={tipo}
        className={cn(claseControl, 'mt-px')}
        aria-describedby={descripcion ? `${idControl}-desc` : undefined}
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-base leading-snug text-tinta">{etiqueta}</span>
        {descripcion ? (
          <span id={`${idControl}-desc`} className="mt-0.5 block text-sm text-tinta-suave">
            {descripcion}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export function Casilla(props: PropsOpcion) {
  return <Opcion tipo="checkbox" claseControl="casilla" {...props} />;
}

export function OpcionRadio(props: PropsOpcion) {
  return <Opcion tipo="radio" claseControl="radio" {...props} />;
}

/**
 * Grupo de radios con leyenda (<= 5 opciones visibles, 10.2). Los campos que las usuarias pidieron como
 * desplegable (Tipo de producto, Clasificacion finalizada) usan `Seleccion`, no esto.
 */
export function GrupoRadios({
  leyenda,
  ayuda,
  error,
  nombre,
  opciones,
  valor,
  valorInicial,
  onCambio,
  deshabilitado,
  orientacion = 'vertical',
}: {
  leyenda: ReactNode;
  ayuda?: ReactNode;
  error?: ReactNode;
  nombre: string;
  opciones: readonly { valor: string; etiqueta: ReactNode; descripcion?: ReactNode; deshabilitada?: boolean }[];
  /** Controlado. */
  valor?: string;
  /** No controlado. */
  valorInicial?: string;
  onCambio?: (valor: string) => void;
  deshabilitado?: boolean;
  orientacion?: 'vertical' | 'horizontal';
}) {
  return (
    <GrupoCampos leyenda={leyenda} ayuda={ayuda} error={error}>
      <div role="radiogroup" className={cn(orientacion === 'horizontal' ? 'flex flex-wrap gap-x-2' : 'space-y-0.5')}>
        {opciones.map((o) => (
          <OpcionRadio
            key={o.valor}
            name={nombre}
            value={o.valor}
            etiqueta={o.etiqueta}
            descripcion={o.descripcion}
            disabled={deshabilitado || o.deshabilitada}
            aria-invalid={error ? true : undefined}
            {...(valor !== undefined ? { checked: valor === o.valor } : { defaultChecked: valorInicial === o.valor })}
            onChange={() => onCambio?.(o.valor)}
          />
        ))}
      </div>
    </GrupoCampos>
  );
}

/** Interruptor (`role="switch"`): para preferencias que se aplican al instante (atajos, avisos). */
export function Interruptor({
  etiqueta,
  descripcion,
  className,
  id,
  ref,
  ...props
}: PropsOpcion) {
  const generado = useId().replace(/:/g, '');
  const idControl = id ?? `sw-${generado}`;
  return (
    <label
      htmlFor={idControl}
      className={cn('flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2 has-[:disabled]:cursor-not-allowed', className)}
    >
      <span className="min-w-0">
        <span className="block text-base text-tinta">{etiqueta}</span>
        {descripcion ? <span className="mt-0.5 block text-sm text-tinta-suave">{descripcion}</span> : null}
      </span>
      <input ref={ref} id={idControl} type="checkbox" role="switch" className="interruptor" {...props} />
    </label>
  );
}
