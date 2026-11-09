'use client';

/**
 * Campos de formulario para usar DENTRO de `FormularioAccion` desde paginas de servidor. Una pagina de servidor no
 * puede pasar funciones (ni manejadores de eventos) a un componente cliente, asi que estos campos son clientes y
 * leen el estado del formulario (errores por campo) de un contexto que pone `FormularioAccion`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { EstadoAdmin } from '@/app/acciones/admin';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { GrupoRadios } from '@/componentes/ui/casilla';
import { AreaTexto, Campo, Seleccion } from '@/componentes/ui/input';
import { cn } from '@/lib/utils';

export const ContextoFormulario = createContext<EstadoAdmin>({ estado: 'inicial' });

export function useEstadoFormulario(): EstadoAdmin {
  return useContext(ContextoFormulario);
}

interface PropsCampoAdmin {
  /** `name` del control y clave con la que llega su error del servidor. */
  nombre: string;
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  opcional?: boolean;
  control?: 'texto' | 'correo' | 'numerico' | 'area' | 'seleccion' | 'buscar' | 'clave';
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  readOnly?: boolean;
  maxLength?: number;
  rows?: number;
  autoComplete?: string;
  mono?: boolean;
  className?: string;
  /** Opciones (`<option>`) cuando el control es una seleccion. */
  children?: ReactNode;
}

/** Etiqueta + control + ayuda + error del servidor, ya cableados. */
export function CampoAdmin({
  nombre,
  etiqueta,
  ayuda,
  opcional,
  control = 'texto',
  defaultValue,
  placeholder,
  required,
  readOnly,
  maxLength,
  rows,
  autoComplete = 'off',
  mono,
  className,
  children,
}: PropsCampoAdmin) {
  const estado = useEstadoFormulario();
  const error = estado.errores?.[nombre];
  return (
    <CampoFormulario etiqueta={etiqueta} ayuda={ayuda} opcional={opcional} error={error} className={className}>
      {(p) => {
        if (control === 'area') {
          return <AreaTexto {...p} name={nombre} defaultValue={defaultValue} rows={rows ?? 4} required={required} readOnly={readOnly} maxLength={maxLength} className={cn(mono && 'font-mono text-sm')} />;
        }
        if (control === 'seleccion') {
          return (
            <Seleccion {...p} name={nombre} defaultValue={defaultValue}>
              {children}
            </Seleccion>
          );
        }
        return (
          <Campo
            {...p}
            name={nombre}
            type={control === 'correo' ? 'email' : control === 'buscar' ? 'search' : control === 'clave' ? 'password' : 'text'}
            inputMode={control === 'correo' ? 'email' : control === 'numerico' ? 'numeric' : undefined}
            defaultValue={defaultValue}
            placeholder={placeholder}
            required={required}
            readOnly={readOnly}
            maxLength={maxLength}
            autoComplete={autoComplete}
            className={cn(mono && 'font-mono text-sm')}
          />
        );
      }}
    </CampoFormulario>
  );
}

/** Grupo de radios sin estado propio (valor inicial) para formularios de servidor. */
export function RadiosAdmin({
  nombre,
  leyenda,
  valorInicial,
  opciones,
}: {
  nombre: string;
  leyenda: ReactNode;
  valorInicial: string;
  opciones: ReadonlyArray<{ valor: string; etiqueta: ReactNode; descripcion?: ReactNode }>;
}) {
  const estado = useEstadoFormulario();
  return <GrupoRadios leyenda={leyenda} nombre={nombre} valorInicial={valorInicial} error={estado.errores?.[nombre]} opciones={opciones} />;
}
