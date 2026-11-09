import { ArrowRight, Clock } from 'lucide-react';
import Link from 'next/link';
import { Estado } from '@/componentes/Estado';
import { Avatar, nombreVisible } from '@/componentes/ui/avatar';
import { EnlaceBoton } from '@/componentes/ui/button';
import { Insignia } from '@/componentes/ui/insignia';
import { ETIQUETA_TIPO } from '@/dominio/campos';
import { plural, tiempoRelativo } from '@/dominio/colaboracion';
import type { FilaEsperando, FilaPendiente, FilaReciente } from '@/server/politicas/colaboracion';
import { AccionesAsignacion } from './AccionesAsignacion';
import { InsigniaPedido } from './piezas';

/**
 * Filas de la bandeja de inicio (F7, 10.3). Cada fila es UNA tarjeta con UN solo enlace «Abrir» que cubre toda la
 * tarjeta (se puede pulsar en cualquier parte, 44 px o mas de alto) y dice: quien la envio, que falta y desde
 * cuando, y los dias en gestion. El estado va con icono y palabra (triangulo = pendiente, circulo con check = clasificada).
 */

function Dias({ dias }: { dias: number }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-tinta-suave tabular-nums">
      <Clock aria-hidden className="size-4" />
      <span>
        <strong className="font-bold text-tinta">{dias}</strong> {dias === 1 ? 'día' : 'días'} en gestión
      </span>
    </p>
  );
}

const claseTarjeta =
  'relative rounded-xl border border-borde-suave bg-superficie p-4 transition-[border-color,box-shadow] duration-150 ease-salida hover:border-azul-500 hover:shadow-suave focus-within:border-azul-500';

export function FilaPendienteUI({ f, ahora }: { f: FilaPendiente; ahora: Date }) {
  return (
    <li className={claseTarjeta} data-testid="fila-pendiente">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Estado color={f.color} texto={f.etiqueta} tamano="sm" sinRol />
            {f.delArea ? <Insignia variante="contorno">De tu área</Insignia> : <InsigniaPedido pedido={f.pedido} />}
            <span className="font-mono text-sm text-tinta-suave">{f.codigo}</span>
          </div>
          <h3 className="break-words font-display text-lg font-extrabold leading-snug text-tinta">{f.nombreProducto}</h3>
          <p className="text-sm text-tinta-suave">
            {f.delArea ? (
              <>
                {ETIQUETA_TIPO[f.tipoProducto]} · Es de tu área (<strong className="font-semibold text-tinta">{f.delArea}</strong>) y nadie la
                tiene asignada
              </>
            ) : (
              <>
                {ETIQUETA_TIPO[f.tipoProducto]} · Te la envió <strong className="font-semibold text-tinta">{nombreVisible(f.deUsuario)}</strong>{' '}
                {tiempoRelativo(f.desde, ahora)}
                {f.estadoAsignacion === 'en_curso' ? ' · Ya la abriste' : ''}
              </>
            )}
          </p>
          {f.falta ? <p className="text-sm font-medium text-tinta">{f.falta}</p> : null}
          {f.mensaje ? (
            <p className="max-w-prose rounded-lg bg-azul-50 px-3 py-2 text-sm text-azul-900">
              <span className="sr-solo">Mensaje de {nombreVisible(f.deUsuario)}: </span>«{f.mensaje}»
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          <Dias dias={f.diasEnGestion} />
          <EnlaceBoton
            href={`/referencias/${f.referenciaId}`}
            aria-label={`Abrir ${f.codigo}`}
            variante="primario"
            className="after:absolute after:inset-0 after:content-['']"
          >
            Abrir
            <ArrowRight aria-hidden className="size-4" />
          </EnlaceBoton>
        </div>
      </div>
    </li>
  );
}

export function FilaEsperandoUI({ f }: { f: FilaEsperando }) {
  const destino = f.aUsuario;
  return (
    <li className={claseTarjeta} data-testid="fila-esperando">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-72 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Estado color={f.color} texto={f.etiqueta} tamano="sm" sinRol />
            <InsigniaPedido pedido={f.pedido} />
            <span className="font-mono text-sm text-tinta-suave">{f.codigo}</span>
          </div>
          <h3 className="break-words font-display text-lg font-extrabold leading-snug text-tinta">
            <Link
              href={`/referencias/${f.referenciaId}`}
              aria-label={`Abrir ${f.codigo}: ${f.nombreProducto}`}
              className="after:absolute after:inset-0 after:content-[''] hover:text-azul-700 focus-visible:outline-offset-4"
            >
              {f.nombreProducto}
            </Link>
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tinta-suave">
            <Avatar nombre={destino.nombre} tamano="sm" />
            <span>
              Esperando a <strong className="font-semibold text-tinta">{nombreVisible(destino.nombre)}</strong>
              {destino.organizacion ? ` (${destino.organizacion})` : ''} desde {tiempoRelativo(f.desde)}
              {!f.esMia ? <> · la envió {f.deUsuario.nombre}</> : null}
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {f.estadoAsignacion === 'en_curso' ? <Insignia variante="azul">Ya la abrió</Insignia> : <Insignia variante="neutra">Sin abrir</Insignia>}
            {f.nRecordatorios > 0 ? <span className="text-xs text-tinta-suave">{plural(f.nRecordatorios, 'recordatorio', 'recordatorios')}</span> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3 max-sm:w-full max-sm:flex-row max-sm:items-center max-sm:justify-between">
          <Dias dias={f.diasEnGestion} />
          {f.puedeRecordar || f.puedeGestionar ? (
            <AccionesAsignacion
              a={{
                asignacionId: f.asignacionId,
                referenciaId: f.referenciaId,
                codigo: f.codigo,
                nombreDestino: destino.nombre,
                destinoId: destino.id,
                puedeRecordar: f.puedeRecordar,
                puedeGestionar: f.puedeGestionar,
                recordadaHoy: f.recordadaHoy,
              }}
            />
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function FilaRecienteUI({ f }: { f: FilaReciente }) {
  return (
    <li className={claseTarjeta} data-testid="fila-reciente">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1 basis-64 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Estado color={f.color} texto={f.etiqueta} tamano="sm" sinRol />
            <span className="font-mono text-sm text-tinta-suave">{f.codigo}</span>
          </div>
          <h3 className="break-words font-display text-base font-extrabold leading-snug text-tinta">
            <Link
              href={`/referencias/${f.id}`}
              aria-label={`Abrir ${f.codigo}: ${f.nombreProducto}`}
              className="after:absolute after:inset-0 after:content-[''] hover:text-azul-700 focus-visible:outline-offset-4"
            >
              {f.nombreProducto}
            </Link>
          </h3>
          <p className="text-sm text-tinta-suave">
            {ETIQUETA_TIPO[f.tipoProducto]} · Actualizada {tiempoRelativo(f.actualizadaEn)}
          </p>
        </div>
        <Dias dias={f.diasEnGestion} />
      </div>
    </li>
  );
}
