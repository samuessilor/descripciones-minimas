'use client';

import { Percent } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { guardarCampoAccion, resolverConflictoAccion } from '@/app/acciones/ficha';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Seleccion } from '@/componentes/ui/input';
import { ARANCELES, IVAS } from '@/dominio/campos';
import type { CampoAduanaVista, VistaAduana } from '@/server/politicas/aduana';
import { Autoria, EncabezadoPaso, ErrorEnLinea, FranjaConflicto, FranjaMotivo, IndicadorGuardado, sinTexto, useCampoGuardable } from './comun';

/**
 * Arancel e IVA de la partida (reunion 2026-11-10): la aduana los elige de una lista justo despues de la partida.
 * Cada uno guarda al elegir, con el mismo manejo de motivo y conflicto de los demas campos de la zona.
 */
export function BloqueImpuestos({ vista, alCambiar }: { vista: VistaAduana; alCambiar: () => void }) {
  const id = useId().replace(/:/g, '');
  const hecho = sinTexto(vista.arancel?.valor) !== '' && sinTexto(vista.iva?.valor) !== '';
  return (
    <div className="space-y-5" role="group" aria-labelledby={`${id}-t`}>
      <EncabezadoPaso
        id={`${id}-t`}
        icono={Percent}
        titulo="Arancel e IVA"
        hecho={hecho}
        ayuda="Se eligen de la lista, después de la partida."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectorTributo vista={vista} clave="arancel" etiqueta="Arancel" opciones={ARANCELES} campo={vista.arancel} alCambiar={alCambiar} />
        <SelectorTributo vista={vista} clave="iva" etiqueta="IVA" opciones={IVAS} campo={vista.iva} alCambiar={alCambiar} />
      </div>
    </div>
  );
}

function SelectorTributo({
  vista,
  clave,
  etiqueta,
  opciones,
  campo,
  alCambiar,
}: {
  vista: VistaAduana;
  clave: 'arancel' | 'iva';
  etiqueta: string;
  opciones: readonly string[];
  campo: CampoAduanaVista | null;
  alCambiar: () => void;
}) {
  const editable = vista.permisos.editar;
  const referenciaId = vista.referenciaId;
  const vigente = sinTexto(campo?.valor);
  const versionVigente = campo?.version ?? 0;
  // Lo elegido y aun no confirmado por la vista; deja de valer cuando el campo cambia de version.
  const [elegido, setElegido] = useState<{ base: number; valor: string } | null>(null);
  const pendiente = useRef<string | null>(null);

  const g = useCampoGuardable({
    campo,
    textoVigente: vigente,
    aEntrada: (t) => (opciones.includes(t) ? t : null),
    guardar: ({ valor, versionEsperada, motivo }) => guardarCampoAccion({ referenciaId, campo: clave, valor, versionEsperada, ...(motivo ? { motivo } : {}) }),
    resolver: async ({ opcion, motivo, versionVigente: v }) => {
      if (opcion === 'dejar') return resolverConflictoAccion({ referenciaId, campo: clave, opcion, valor: '' });
      return guardarCampoAccion({ referenciaId, campo: clave, valor: pendiente.current, versionEsperada: v, ...(motivo ? { motivo } : {}) });
    },
    alGuardar: alCambiar,
    textoDe: (v) => sinTexto(v),
  });

  const mostrado = elegido && elegido.base === versionVigente ? elegido.valor : vigente;
  const hay = opciones.includes(vigente);

  function elegir(v: string) {
    if (!opciones.includes(v)) return;
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
    <div className="space-y-3" data-bloque-tributo={clave}>
      {editable ? (
        <CampoFormulario etiqueta={etiqueta} acciones={<IndicadorGuardado estado={g.estado} />}>
          {(p) => (
            <Seleccion {...p} data-campo={clave} className="max-w-xs" value={mostrado} onChange={(e) => elegir(e.target.value)}>
              <option value="" disabled={mostrado !== ''}>
                Elige el {etiqueta === 'IVA' ? 'IVA' : 'arancel'}
              </option>
              {opciones.map((o) => (
                <option key={o} value={o}>
                  {o.replace('%', ' %')}
                </option>
              ))}
            </Seleccion>
          )}
        </CampoFormulario>
      ) : (
        <div>
          <p className="text-sm font-semibold text-tinta">{etiqueta}</p>
          {hay ? (
            <p className="mt-1 text-xl font-semibold text-tinta">{vigente.replace('%', ' %')}</p>
          ) : (
            <p className="mt-1 text-base text-tinta-suave">La aduana todavía no lo ha elegido.</p>
          )}
        </div>
      )}

      {g.estado === 'motivo' ? (
        <FranjaMotivo
          autor={campo?.autor ?? 'Alguien'}
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
          vigente={sinTexto(g.conflicto.valor)}
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

      {hay ? <Autoria campo={campo} /> : null}
    </div>
  );
}
