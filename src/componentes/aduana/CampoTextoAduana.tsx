'use client';

import { useId, useState } from 'react';
import { guardarCampoAccion, resolverConflictoAccion } from '@/app/acciones/ficha';
import { HistorialCampo } from '@/componentes/slots/HistorialCampo';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { AreaTexto } from '@/componentes/ui/input';
import type { CampoAduanaVista } from '@/server/politicas/aduana';
import { Autoria, ErrorEnLinea, FranjaConflicto, FranjaMotivo, IndicadorGuardado, esNoAplica, sinTexto, useCampoGuardable } from './comun';

/**
 * Campo de texto de la zona de la aduana (descripciones minimas adicionales, respuesta del area, restricciones,
 * observaciones): guarda al salir, pide motivo si pisa lo de otra persona, ofrece dejar/usar/combinar si hubo un
 * choque, y muestra autor, fecha y el acceso a su historial. Con `noAplica`, una casilla marca «No aplica» (cuenta como
 * diligenciado) y desmarcarla lo deja pendiente otra vez. Si no se puede editar, es texto.
 */
export function CampoTextoAduana({
  referenciaId,
  clave,
  etiqueta,
  ayuda,
  campo,
  editable,
  filas = 3,
  maximo = 2000,
  placeholder,
  opcional = false,
  noAplica,
  aTexto = sinTexto,
  alCambiar,
  textoVacio,
}: {
  referenciaId: string;
  clave: string;
  etiqueta: string;
  ayuda?: string;
  campo: CampoAduanaVista | null;
  editable: boolean;
  filas?: number;
  maximo?: number;
  placeholder?: string;
  opcional?: boolean;
  /** Texto de la casilla «No aplica» (si el campo la admite). */
  noAplica?: string;
  /** Texto con que se muestra el valor guardado (por defecto, el valor si es texto). */
  aTexto?: (valor: unknown) => string;
  alCambiar: () => void;
  textoVacio?: string;
}) {
  const id = useId().replace(/:/g, '');
  const vigente = aTexto(campo?.valor);
  // La casilla responde al instante; cuando llega el valor guardado (otra version) manda el servidor.
  const [marcaLocal, setMarcaLocal] = useState<{ v: boolean; version: number } | null>(null);
  const version = campo?.version ?? 0;
  if (marcaLocal && marcaLocal.version !== version) setMarcaLocal(null);
  const marcadoNoAplica = !!noAplica && (marcaLocal ? marcaLocal.v : esNoAplica(campo?.valor));

  const g = useCampoGuardable({
    campo,
    textoVigente: vigente,
    aEntrada: (t) => (t.trim() === '' ? null : t),
    guardar: ({ valor, versionEsperada, motivo }) => guardarCampoAccion({ referenciaId, campo: clave, valor, versionEsperada, ...(motivo ? { motivo } : {}) }),
    resolver: ({ opcion, valor, motivo }) => resolverConflictoAccion({ referenciaId, campo: clave, opcion, valor: valor ?? '', ...(motivo ? { motivo } : {}) }),
    alGuardar: alCambiar,
    textoDe: aTexto,
  });
  // Si el servidor no lo acepto (p. ej. vaciar un valor ajeno), la casilla vuelve a lo guardado.
  if (marcaLocal && g.estado === 'error') setMarcaLocal(null);

  if (!editable) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-semibold text-tinta">{etiqueta}</p>
        {vigente || marcadoNoAplica ? (
          <>
            <p className="whitespace-pre-wrap text-base text-tinta">{marcadoNoAplica ? noAplica : vigente}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Autoria campo={campo} />
              <HistorialCampo referenciaId={referenciaId} campo={clave} />
            </div>
          </>
        ) : (
          <p className="text-base text-tinta-suave">{textoVacio ?? 'Sin información.'}</p>
        )}
      </div>
    );
  }

  const hayValor = vigente !== '' || marcadoNoAplica;
  return (
    <div className="space-y-2.5">
      <CampoFormulario etiqueta={etiqueta} ayuda={ayuda} opcional={opcional} id={`${id}-c`} error={g.estado === 'error' ? g.mensaje : undefined}>
        {(p) => (
          <AreaTexto
            {...p}
            rows={filas}
            maxLength={maximo}
            placeholder={marcadoNoAplica ? noAplica : placeholder}
            value={g.texto}
            disabled={marcadoNoAplica || g.estado === 'guardando'}
            onChange={(e) => g.cambiar(e.target.value)}
            onBlur={g.alSalir}
          />
        )}
      </CampoFormulario>
      {noAplica ? (
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 rounded-md px-1 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
          <input
            type="checkbox"
            className="casilla"
            checked={marcadoNoAplica}
            disabled={g.estado === 'guardando'}
            onChange={(e) => {
              setMarcaLocal({ v: e.target.checked, version });
              g.fijar(e.target.checked ? { no_aplica: true } : null);
            }}
          />
          {noAplica}
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <IndicadorGuardado estado={g.estado} />
        {hayValor ? <Autoria campo={campo} /> : null}
        {hayValor ? <HistorialCampo referenciaId={referenciaId} campo={clave} /> : null}
      </div>
      {g.estado === 'motivo' ? (
        <FranjaMotivo autor={campo?.autor ?? 'Alguien'} motivo={g.motivo} onMotivo={g.setMotivo} onConfirmar={g.confirmarMotivo} onCancelar={g.cancelar} mensaje={g.mensaje} />
      ) : null}
      {g.estado === 'conflicto' && g.conflicto ? (
        <FranjaConflicto
          autor={g.conflicto.autor}
          vigente={aTexto(g.conflicto.valor)}
          esTexto
          motivo={g.motivo}
          onMotivo={g.setMotivo}
          onResolver={(o) => void g.resolver(o)}
          onCombinar={g.combinar}
          mensaje={g.mensaje}
        />
      ) : null}
      {g.estado === 'error' ? <ErrorEnLinea mensaje={g.mensaje} onReintentar={() => void g.enviar(g.motivo.trim() || undefined)} /> : null}
    </div>
  );
}
