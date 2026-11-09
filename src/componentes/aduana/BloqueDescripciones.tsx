'use client';

import { ListChecks, MessageSquareReply } from 'lucide-react';
import { useId, useState } from 'react';
import { guardarCampoAccion } from '@/app/acciones/ficha';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import type { VistaAduana } from '@/server/politicas/aduana';
import { EncabezadoPaso, ErrorEnLinea, diligenciado, sinTexto } from './comun';
import { CampoTextoAduana } from './CampoTextoAduana';

/** Texto de la respuesta del area (`{ texto, sobre }`). */
export function textoRespuesta(v: unknown): string {
  return typeof v === 'object' && v !== null && typeof (v as { texto?: unknown }).texto === 'string' ? (v as { texto: string }).texto : '';
}

/**
 * Descripciones minimas adicionales: la aduana escribe lo que le falta saber del producto (ej. «¿el motor es AC o DC?
 * amperaje») o marca «No es necesario por ahora / no aplica». Si escribe una solicitud, al area le llega un pendiente
 * «Responder» y la contesta aqui mismo, en «Respuesta del área», debajo de la solicitud. La parte queda pendiente
 * (amarilla) hasta que haya respuesta; si la aduana cambia la solicitud despues, vuelve a quedar pendiente.
 */
export function BloqueDescripciones({ vista, alCambiar }: { vista: VistaAduana; alCambiar: () => void }) {
  const id = useId().replace(/:/g, '');
  const solicitud = sinTexto(vista.descripcionesMinimas?.valor).trim();
  const hayRespuesta = textoRespuesta(vista.respuestaArea?.valor).trim() !== '';
  const hecho = diligenciado(vista.descripcionesMinimas?.valor) && !vista.solicitudPendiente;
  const [confirmando, setConfirmando] = useState(false);
  const [errorConfirmar, setErrorConfirmar] = useState('');

  // La solicitud cambio pero la respuesta sigue valiendo: se vuelve a guardar el mismo texto y el servidor la ata a la
  // solicitud vigente (`sobre`). Si la respuesta es de otra persona, el servidor pide motivo: se edita el campo.
  async function confirmarRespuesta() {
    setConfirmando(true);
    setErrorConfirmar('');
    const r = await guardarCampoAccion({
      referenciaId: vista.referenciaId,
      campo: 'respuesta_area',
      valor: textoRespuesta(vista.respuestaArea?.valor),
      versionEsperada: vista.respuestaArea?.version ?? 0,
    }).catch(() => ({ ok: false as const, codigo: 'RED', mensaje: 'No pudimos conectar. Intenta de nuevo.' }));
    setConfirmando(false);
    if (r.ok) alCambiar();
    else if (r.codigo === 'FALTA_MOTIVO') setErrorConfirmar('Esta respuesta la escribió otra persona: edítala en el campo y cuéntale por qué.');
    else setErrorConfirmar(r.mensaje);
  }

  return (
    <div className="space-y-4" role="group" aria-labelledby={`${id}-t`}>
      <EncabezadoPaso
        id={`${id}-t`}
        icono={ListChecks}
        titulo="Descripciones mínimas adicionales"
        hecho={hecho}
        ayuda={
          vista.permisos.editar
            ? 'Escribe lo que te falta saber del producto: el área recibe un pendiente y te responde aquí. Si no te falta nada, marca la casilla.'
            : 'Lo que la agencia de aduana necesita saber del producto, además de lo que ya está en la ficha.'
        }
      />
      <CampoTextoAduana
        referenciaId={vista.referenciaId}
        clave="descripciones_minimas"
        etiqueta="Lo que la aduana necesita saber"
        ayuda="Ejemplo: ¿El motor es de corriente alterna (AC) o continua (DC)? ¿Cuál es su amperaje?"
        placeholder={'¿…?\n¿…?'}
        campo={vista.descripcionesMinimas}
        editable={vista.permisos.editar}
        filas={4}
        maximo={5000}
        noAplica="No es necesario por ahora / no aplica"
        alCambiar={alCambiar}
        textoVacio="La aduana todavía no ha dicho si necesita información adicional."
      />

      {solicitud !== '' ? (
        <div className="space-y-3 rounded-lg border border-borde-suave bg-superficie px-4 py-4" data-respuesta-area>
          <p className="flex items-center gap-2 text-sm font-semibold text-tinta">
            <MessageSquareReply aria-hidden className="size-4 text-azul-700" />
            Respuesta del área
          </p>
          {vista.solicitudPendiente ? (
            <Aviso tipo="aviso" titulo={hayRespuesta ? 'La solicitud cambió después de la respuesta' : 'Pendiente de respuesta del área'}>
              {vista.permisos.responder
                ? 'Responde aquí lo que pide la aduana. Se guarda al salir del campo.'
                : 'El área recibió un pendiente «Responder» y contesta aquí.'}
            </Aviso>
          ) : null}
          {vista.solicitudPendiente && hayRespuesta && vista.permisos.responder ? (
            <div className="space-y-1">
              <Boton variante="secundario" tamano="sm" cargando={confirmando} onClick={() => void confirmarRespuesta()}>
                Mi respuesta sigue valiendo
              </Boton>
              {errorConfirmar ? <ErrorEnLinea mensaje={errorConfirmar} /> : null}
            </div>
          ) : null}
          <CampoTextoAduana
            referenciaId={vista.referenciaId}
            clave="respuesta_area"
            etiqueta={vista.permisos.responder ? 'Tu respuesta' : 'Lo que respondió el área'}
            campo={vista.respuestaArea}
            editable={vista.permisos.responder}
            filas={4}
            maximo={5000}
            aTexto={textoRespuesta}
            alCambiar={alCambiar}
            textoVacio="El área todavía no ha respondido."
          />
        </div>
      ) : null}
    </div>
  );
}
