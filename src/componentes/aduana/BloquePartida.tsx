'use client';

import { Landmark } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { fijarPartidaAccion } from '@/app/acciones/aduana';
import { resolverConflictoAccion } from '@/app/acciones/ficha';
import { Aviso } from '@/componentes/ui/aviso';
import { TextoError } from '@/componentes/ui/campo-formulario';
import { Etiqueta } from '@/componentes/ui/etiqueta';
import { Campo } from '@/componentes/ui/input';
import { useAvisos } from '@/componentes/ui/toast';
import { digitosQueFaltan, mascaraPartida } from '@/dominio/partida-mascara';
import { esPartidaValida } from '@/dominio/partida';
import type { VistaAduana } from '@/server/politicas/aduana';
import { Autoria, EncabezadoPaso, ErrorEnLinea, FranjaConflicto, FranjaMotivo, IndicadorGuardado, sinTexto, useCampoGuardable } from './comun';

/**
 * Partida arancelaria: un texto con mascara 0000.00.00.00, sin desplegable (reunion con el area). El catalogo de
 * partidas sigue detras: si la partida escrita esta en el y tiene restriccion, se copia abajo; si no esta, se acepta.
 */
export function BloquePartida({ vista, alCambiar }: { vista: VistaAduana; alCambiar: () => void }) {
  const { avisar } = useAvisos();
  const id = useId().replace(/:/g, '');
  const editable = vista.permisos.editar;
  const valorVigente = sinTexto(vista.partida?.valor);
  const [errorLocal, setErrorLocal] = useState('');
  const entrada = useRef<HTMLInputElement | null>(null);
  const referenciaId = vista.referenciaId;

  const g = useCampoGuardable({
    campo: vista.partida,
    textoVigente: valorVigente,
    aEntrada: (t) => (t.trim() === '' ? null : t.trim()),
    guardar: async ({ valor, versionEsperada, motivo }) => {
      const r = await fijarPartidaAccion({ referenciaId, partida: valor === null ? '' : String(valor), versionEsperada, ...(motivo ? { motivo } : {}) });
      if (r.ok && r.data.restriccionPrellenada) {
        avisar({ tipo: 'exito', titulo: 'Copiamos la restricción de esta partida', descripcion: 'Revísala abajo; puedes editarla si hace falta.' });
      }
      return r;
    },
    resolver: async ({ opcion, valor, motivo, versionVigente }) => {
      if (opcion === 'dejar') return resolverConflictoAccion({ referenciaId, campo: 'partida_arancelaria', opcion, valor: valor ?? '' });
      return fijarPartidaAccion({ referenciaId, partida: String(valor ?? ''), versionEsperada: versionVigente, ...(motivo ? { motivo } : {}) });
    },
    alGuardar: alCambiar,
  });

  function alSalir() {
    const t = g.texto.trim();
    if (t !== '' && !esPartidaValida(t)) {
      setErrorLocal(`La partida lleva 10 dígitos. Ejemplo: 8421.39.90.00${digitosQueFaltan(t) > 0 ? ` (te faltan ${digitosQueFaltan(t)})` : ''}`);
      return;
    }
    setErrorLocal('');
    g.alSalir();
  }

  const info = vista.infoPartida;
  const hay = valorVigente !== '';

  return (
    <div className="space-y-4" aria-labelledby={`${id}-t`} role="group">
      <EncabezadoPaso
        id={`${id}-t`}
        icono={Landmark}
        titulo="Partida arancelaria"
        hecho={hay}
        ayuda="Escribe los 10 dígitos. Si la partida está en el catálogo con una restricción, la copiamos abajo."
        derecha={<IndicadorGuardado estado={g.estado} />}
      />

      {editable ? (
        <div className="space-y-2">
          <Etiqueta htmlFor={`${id}-campo`}>Número de partida</Etiqueta>
          <Campo
            ref={entrada}
            id={`${id}-campo`}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            placeholder="0000.00.00.00"
            maxLength={13}
            value={g.texto}
            aria-invalid={errorLocal ? true : undefined}
            aria-describedby={errorLocal ? `${id}-err` : `${id}-ayuda`}
            className="max-w-xs font-mono text-lg tracking-wide"
            onChange={(e) => {
              setErrorLocal('');
              g.cambiar(mascaraPartida(e.target.value, g.texto));
            }}
            onBlur={alSalir}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                entrada.current?.blur();
              }
            }}
          />
          <p id={`${id}-ayuda`} className="text-sm text-tinta-suave">
            Formato 0000.00.00.00. Los puntos los ponemos nosotros.
          </p>
          {errorLocal ? (
            <div id={`${id}-err`}>
              <TextoError>{errorLocal}</TextoError>
            </div>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="text-sm font-semibold text-tinta">Número de partida</p>
          {hay ? (
            <p className="mt-1 font-mono text-xl font-semibold tracking-wide text-tinta">{valorVigente}</p>
          ) : (
            <p className="mt-1 text-base text-tinta-suave">La aduana todavía no ha escrito la partida.</p>
          )}
        </div>
      )}

      {g.estado === 'motivo' ? (
        <FranjaMotivo
          autor={vista.partida?.autor ?? 'Alguien'}
          motivo={g.motivo}
          onMotivo={g.setMotivo}
          onConfirmar={g.confirmarMotivo}
          onCancelar={g.cancelar}
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
          onResolver={(o) => void g.resolver(o)}
          onCombinar={g.combinar}
          mensaje={g.mensaje}
        />
      ) : null}
      {g.estado === 'error' ? <ErrorEnLinea mensaje={g.mensaje} onReintentar={() => void g.enviar(g.motivo.trim() || undefined)} /> : null}

      {hay ? <Autoria campo={vista.partida} /> : null}

      {hay && info ? (
        <div className="space-y-2.5">
          {info.descripcion ? <p className="text-sm text-tinta-suave">{info.descripcion}</p> : null}
          {!info.existe && editable ? (
            <Aviso tipo="aviso" titulo="Partida nueva">
              La aceptamos como partida libre. Cuando cierres la clasificación queda en el catálogo con tu nombre.
            </Aviso>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
