'use client';

import { FileCheck } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { guardarCampoAccion, resolverConflictoAccion } from '@/app/acciones/ficha';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Seleccion } from '@/componentes/ui/input';
import type { VistaAduana } from '@/server/politicas/aduana';
import { Autoria, EncabezadoPaso, ErrorEnLinea, FranjaConflicto, FranjaMotivo, IndicadorGuardado, sinTexto, useCampoGuardable } from './comun';

type Respuesta = 'SI' | 'NO';

const TEXTO: Record<Respuesta, string> = { SI: 'Sí', NO: 'No' };

/**
 * ¿Requiere registro de importacion (RIM)? La responde la aduana al clasificar (reunion 2026-11): Sí o No. Si es Sí,
 * Comercio Exterior gestiona el registro por fuera de la plataforma. Es obligatoria para cerrar la clasificacion.
 * Guarda al elegir, con el mismo manejo de motivo y conflicto de los demas campos de la zona.
 */
export function BloqueRim({ vista, alCambiar }: { vista: VistaAduana; alCambiar: () => void }) {
  const id = useId().replace(/:/g, '');
  const editable = vista.permisos.editar;
  const referenciaId = vista.referenciaId;
  const vigente = sinTexto(vista.requiereRim?.valor);
  const versionVigente = vista.requiereRim?.version ?? 0;
  // Lo elegido y aun no confirmado por la vista; deja de valer cuando el campo cambia de version.
  const [elegido, setElegido] = useState<{ base: number; valor: Respuesta } | null>(null);
  const pendiente = useRef<Respuesta | null>(null);

  const g = useCampoGuardable({
    campo: vista.requiereRim,
    textoVigente: vigente,
    aEntrada: (t) => (t === 'SI' || t === 'NO' ? t : null),
    guardar: ({ valor, versionEsperada, motivo }) =>
      guardarCampoAccion({ referenciaId, campo: 'requiere_rim', valor, versionEsperada, ...(motivo ? { motivo } : {}) }),
    resolver: async ({ opcion, motivo, versionVigente: v }) => {
      if (opcion === 'dejar') return resolverConflictoAccion({ referenciaId, campo: 'requiere_rim', opcion, valor: '' });
      return guardarCampoAccion({ referenciaId, campo: 'requiere_rim', valor: pendiente.current, versionEsperada: v, ...(motivo ? { motivo } : {}) });
    },
    alGuardar: alCambiar,
    textoDe: (v) => sinTexto(v),
  });

  const mostrado: string = elegido && elegido.base === versionVigente ? elegido.valor : vigente;
  const hay = vigente === 'SI' || vigente === 'NO';

  function elegir(v: string) {
    if (v !== 'SI' && v !== 'NO') return;
    if (v === vigente) {
      setElegido(null);
      return;
    }
    pendiente.current = v;
    setElegido({ base: versionVigente, valor: v });
    g.fijar(v);
  }

  function cancelar() {
    setElegido(null);
    g.cancelar();
  }

  return (
    <div className="space-y-4" role="group" aria-labelledby={`${id}-t`}>
      <EncabezadoPaso
        id={`${id}-t`}
        icono={FileCheck}
        titulo="Registro de importación (RIM)"
        hecho={hay}
        ayuda="Es obligatoria para cerrar la clasificación."
        derecha={<IndicadorGuardado estado={g.estado} />}
      />

      {editable ? (
        <CampoFormulario etiqueta="¿Requiere registro de importación (RIM)?" ayuda="Si es Sí, Comercio Exterior gestiona el registro por fuera de la plataforma.">
          {(p) => (
            <Seleccion {...p} data-campo="requiere_rim" className="max-w-xs" value={mostrado} onChange={(e) => elegir(e.target.value)}>
              <option value="" disabled={mostrado !== ''}>
                Elige Sí o No
              </option>
              <option value="SI">Sí</option>
              <option value="NO">No</option>
            </Seleccion>
          )}
        </CampoFormulario>
      ) : (
        <div>
          <p className="text-sm font-semibold text-tinta">¿Requiere registro de importación (RIM)?</p>
          {hay ? (
            <p className="mt-1 text-xl font-semibold text-tinta">{TEXTO[vigente as Respuesta]}</p>
          ) : (
            <p className="mt-1 text-base text-tinta-suave">La aduana todavía no ha respondido esta pregunta.</p>
          )}
          <p className="mt-1 text-sm text-tinta-suave">Si es Sí, Comercio Exterior gestiona el registro por fuera de la plataforma.</p>
        </div>
      )}

      {g.estado === 'motivo' ? (
        <FranjaMotivo
          autor={vista.requiereRim?.autor ?? 'Alguien'}
          motivo={g.motivo}
          onMotivo={g.setMotivo}
          onConfirmar={g.confirmarMotivo}
          onCancelar={cancelar}
          mensaje={g.mensaje}
          cargando={false}
        />
      ) : null}
      {g.estado === 'conflicto' && g.conflicto ? (
        <FranjaConflicto
          autor={g.conflicto.autor}
          vigente={TEXTO[sinTexto(g.conflicto.valor) as Respuesta] ?? sinTexto(g.conflicto.valor)}
          esTexto={false}
          motivo={g.motivo}
          onMotivo={g.setMotivo}
          onResolver={(o) => {
            if (o === 'dejar') setElegido(null);
            void g.resolver(o);
          }}
          onCombinar={g.combinar}
          mensaje={g.mensaje}
        />
      ) : null}
      {g.estado === 'error' ? <ErrorEnLinea mensaje={g.mensaje} onReintentar={editable ? () => void g.enviar(g.motivo.trim() || undefined) : undefined} /> : null}

      {hay ? <Autoria campo={vista.requiereRim} /> : null}
    </div>
  );
}
