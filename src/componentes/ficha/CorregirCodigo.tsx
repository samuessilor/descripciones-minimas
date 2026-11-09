'use client';

import Link from 'next/link';
import { useState } from 'react';
import { corregirCodigoAccion } from '@/app/acciones/ficha';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario, TextoError } from '@/componentes/ui/campo-formulario';
import { Dialogo } from '@/componentes/ui/dialogo';
import { AreaTexto, Campo } from '@/componentes/ui/input';

/**
 * «Corregir código» (SPEC 6.3, CA-34): el codigo identifica a la referencia, asi que corregirlo pide un motivo y
 * queda en el historial. Si el codigo nuevo ya es de otra referencia, se dice cual y se ofrece abrirla.
 */
export function CorregirCodigo({
  referenciaId,
  codigoActual,
  abierto,
  onCerrar,
  alCorregir,
}: {
  referenciaId: string;
  codigoActual: string;
  abierto: boolean;
  onCerrar: () => void;
  alCorregir: () => void;
}) {
  const [codigo, setCodigo] = useState(codigoActual);
  const [motivo, setMotivo] = useState('');
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<{ mensaje: string; existenteId?: string; campo: 'codigo' | 'motivo' | 'general' } | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (codigo.trim() === '') return setError({ campo: 'codigo', mensaje: 'Escribe el código correcto.' });
    if (codigo.trim() === codigoActual) return setError({ campo: 'codigo', mensaje: 'Es el mismo código que ya tiene. Escribe el correcto.' });
    if (motivo.trim() === '') return setError({ campo: 'motivo', mensaje: 'Cuéntanos por qué lo corriges. Queda en el historial.' });
    setEnCurso(true);
    try {
      const r = await corregirCodigoAccion({ referenciaId, codigoNuevo: codigo, motivo });
      if (r.ok) {
        alCorregir();
        onCerrar();
        return;
      }
      const existenteId = r.codigo === 'DUPLICADO' ? (r.detalle as { id?: string } | undefined)?.id : undefined;
      setError({
        mensaje: r.mensaje,
        campo: r.codigo === 'DUPLICADO' || r.codigo === 'VALIDACION' ? 'codigo' : r.codigo === 'FALTA_MOTIVO' ? 'motivo' : 'general',
        ...(existenteId ? { existenteId } : {}),
      });
    } catch {
      setError({ campo: 'general', mensaje: 'No pudimos conectar. El código sigue igual; intenta de nuevo.' });
    } finally {
      setEnCurso(false);
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Corregir el código"
      descripcion="Cambia el código solo si estaba mal escrito. La referencia sigue siendo la misma y el código anterior queda en el historial."
      tamano="md"
      bloquear={enCurso}
      pie={
        <>
          <Boton variante="secundario" onClick={onCerrar} disabled={enCurso}>
            Todavía no
          </Boton>
          <Boton type="submit" form="form-corregir-codigo" cargando={enCurso}>
            {enCurso ? 'Corrigiendo…' : 'Corregir código'}
          </Boton>
        </>
      }
    >
      <form id="form-corregir-codigo" onSubmit={enviar} className="space-y-4" noValidate>
        <CampoFormulario
          etiqueta="Código correcto"
          ayuda="Tal como viene en la factura o en el catálogo. Ej.: 1GA0612A00"
          error={
            error?.campo === 'codigo' ? (
              <>
                {error.mensaje}{' '}
                {error.existenteId ? (
                  <Link className="font-semibold underline" href={`/referencias/${error.existenteId}`}>
                    Abrir esa referencia
                  </Link>
                ) : null}
              </>
            ) : undefined
          }
        >
          {(p) => <Campo {...p} data-autofocus="" maxLength={80} autoComplete="off" value={codigo} onChange={(e) => setCodigo(e.target.value)} />}
        </CampoFormulario>
        <CampoFormulario
          etiqueta="Motivo"
          ayuda="Ej.: había una letra cambiada al copiarlo de la factura."
          error={error?.campo === 'motivo' ? error.mensaje : undefined}
        >
          {(p) => <AreaTexto {...p} rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}
        </CampoFormulario>
        {error?.campo === 'general' ? <TextoError>{error.mensaje}</TextoError> : null}
      </form>
    </Dialogo>
  );
}
