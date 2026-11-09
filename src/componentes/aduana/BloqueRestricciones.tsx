'use client';

import { Lock, PenLine, Scale } from 'lucide-react';
import { useId, useState } from 'react';
import { Boton } from '@/componentes/ui/button';
import { Insignia } from '@/componentes/ui/insignia';
import type { VistaAduana } from '@/server/politicas/aduana';
import { Autoria, EncabezadoPaso, esNoAplica, sinTexto } from './comun';
import { CampoTextoAduana } from './CampoTextoAduana';

/**
 * Restricciones: el texto normativo de la partida (RETIE, RAEE...) se LEE primero, con el nombre de la norma;
 * la aduana lo edita solo si hace falta (queda en el historial). Debajo, sus observaciones. Las dos admiten «No aplica»
 * (cuenta como diligenciado; desmarcarlo las deja pendientes otra vez).
 */
export function BloqueRestricciones({ vista, alCambiar }: { vista: VistaAduana; alCambiar: () => void }) {
  const id = useId().replace(/:/g, '');
  const [editando, setEditando] = useState(false);
  const texto = sinTexto(vista.restricciones?.valor);
  const editable = vista.permisos.editar;
  const hay = texto.trim() !== '';
  const hecho = (hay || esNoAplica(vista.restricciones?.valor)) && (sinTexto(vista.observaciones?.valor).trim() !== '' || esNoAplica(vista.observaciones?.valor));

  return (
    <div className="space-y-5" role="group" aria-labelledby={`${id}-t`}>
      <EncabezadoPaso
        id={`${id}-t`}
        icono={Scale}
        titulo="Restricciones y observaciones"
        hecho={hecho}
        ayuda="La norma que aplica a esta partida. Se prellena al elegirla y queda guardada en esta referencia."
      />

      {hay && !editando ? (
        <div className="space-y-3">
          {vista.normas.length > 0 ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
              Normas citadas:
              {vista.normas.map((n) => (
                <Insignia key={n} variante="azul">
                  {n}
                </Insignia>
              ))}
            </p>
          ) : null}
          <div className="rounded-lg border border-azul-200 bg-azul-50/70 px-4 py-3.5">
            <p className="whitespace-pre-wrap text-base leading-relaxed text-tinta" data-restricciones>
              {texto}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Autoria campo={vista.restricciones} />
            {editable ? (
              <Boton variante="secundario" tamano="sm" onClick={() => setEditando(true)}>
                <PenLine aria-hidden className="size-4" /> Anotar o editar restricciones
              </Boton>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-tinta-suave">
                <Lock aria-hidden className="size-3.5" /> Solo lectura: la completa la aduana
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <CampoTextoAduana
            referenciaId={vista.referenciaId}
            clave="restricciones"
            etiqueta="Restricciones de esta referencia"
            ayuda={
              vista.restriccionCatalogo
                ? 'Edita el texto de la partida o agrega condiciones propias de esta referencia.'
                : 'Pega el texto de la norma o escribe «Sin restricciones». Ejemplo: Excluido de RETIE; no aplica RAEE.'
            }
            campo={vista.restricciones}
            editable={editable}
            filas={6}
            maximo={5000}
            noAplica="No aplica"
            alCambiar={alCambiar}
            textoVacio="La aduana todavía no ha escrito las restricciones."
          />
          {hay ? (
            <Boton variante="terciario" tamano="sm" onClick={() => setEditando(false)}>
              Listo, volver a leer
            </Boton>
          ) : null}
        </div>
      )}

      <CampoTextoAduana
        referenciaId={vista.referenciaId}
        clave="observaciones_aduana"
        etiqueta="Observaciones de la aduana"
        ayuda="Salen en el Excel. Ejemplo: se requiere certificado de origen."
        campo={vista.observaciones}
        editable={editable}
        filas={2}
        noAplica="No aplica"
        alCambiar={alCambiar}
        textoVacio="La aduana todavía no ha escrito sus observaciones."
      />
    </div>
  );
}
