'use client';

import { CircleAlert, ImagePlus, LoaderCircle, Lock, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { retirarAdjuntoAccion } from '@/app/acciones/ficha';
import { Boton } from '@/componentes/ui/button';
import { Dialogo, DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { cn } from '@/lib/utils';
import type { AdjuntoVista } from '@/server/acciones/adjuntos';
import { fechaCorta } from './formato';
import { comprimirFoto } from './comprimir-foto';

const MAX_FOTOS = 5;

/**
 * Foto de la ficha (SPEC 10.2, 13.5): clip «Adjuntar foto» (con texto, no solo icono), arrastrar y soltar en
 * escritorio, camara o galeria en el celular. El navegador reduce la foto antes de subirla (lado mayor 2000 px,
 * 4 MB); el servidor NO confia en eso y la reprocesa. No se quita la foto de otra persona; la propia se retira
 * con motivo y queda en el historial (nada se borra). No cuenta para el verde.
 */
export function FotosFicha({
  referenciaId,
  adjuntos,
  puedeAdjuntar,
  razonSoloLectura,
  alCambiar,
}: {
  referenciaId: string;
  adjuntos: readonly AdjuntoVista[];
  puedeAdjuntar: boolean;
  razonSoloLectura: string | null;
  alCambiar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [grande, setGrande] = useState<AdjuntoVista | null>(null);
  const [aRetirar, setARetirar] = useState<AdjuntoVista | null>(null);

  const vivas = adjuntos.filter((a) => !a.retirado);
  const retiradas = adjuntos.filter((a) => a.retirado);
  const lleno = vivas.length >= MAX_FOTOS;

  async function subir(archivos: FileList | File[]) {
    const lista = Array.from(archivos);
    if (lista.length === 0) return;
    setError(null);
    setSubiendo(true);
    try {
      for (const original of lista) {
        if (vivas.length + 1 > MAX_FOTOS) {
          setError(`Ya hay ${MAX_FOTOS} fotos, que es el máximo. Retira una para subir otra.`);
          break;
        }
        const archivo = await comprimirFoto(original);
        const datos = new FormData();
        datos.set('referenciaId', referenciaId);
        datos.set('archivo', archivo, archivo.name);
        let respuesta: Response;
        try {
          respuesta = await fetch('/api/adjuntos/subir', { method: 'POST', body: datos });
        } catch {
          setError('No pudimos subir la foto. Revisa tu conexión y vuelve a intentar; lo demás sigue guardado.');
          break;
        }
        if (!respuesta.ok) {
          const cuerpo = (await respuesta.json().catch(() => null)) as { mensaje?: string; detalle?: { sesionVencida?: boolean } } | null;
          setError(
            cuerpo?.detalle?.sesionVencida
              ? 'Tu sesión venció. Entra de nuevo en otra pestaña y vuelve a subir la foto.'
              : (cuerpo?.mensaje ?? 'No pudimos subir la foto. Intenta de nuevo; si sigue, avisa al administrador.'),
          );
          break;
        }
        alCambiar();
      }
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <div className="space-y-3" data-campo="adjuntos">
      <div className="flex items-baseline justify-between gap-3">
        <span id="foto-etiqueta" className="text-sm font-semibold text-tinta">
          Foto <span className="ml-1 font-normal text-tinta-suave">(opcional)</span>
        </span>
        {!puedeAdjuntar && razonSoloLectura ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-tinta-suave">
            <Lock aria-hidden className="size-3.5" />
            {razonSoloLectura}
          </span>
        ) : null}
      </div>
      <p className="text-sm text-tinta-suave">JPG, PNG o WebP, hasta 4 MB y máximo {MAX_FOTOS} fotos. Si la tienes, ayuda a la aduana a entender el producto.</p>

      {vivas.length > 0 ? (
        <ul aria-label="Fotos adjuntas" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {vivas.map((a) => (
            <li key={a.id} className="group relative overflow-hidden rounded-lg border border-borde-suave bg-superficie-2">
              <button
                type="button"
                onClick={() => setGrande(a)}
                aria-label={`Ver la foto ${a.nombre}, subida por ${a.subidoPor}`}
                className="block aspect-[4/3] w-full overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- la ruta pasa por permiso; next/image no aplica */}
                <img src={a.urlMiniatura} alt={`Foto ${a.nombre}`} loading="lazy" className="size-full object-cover transition-transform duration-200 ease-salida group-hover:scale-[1.03]" />
              </button>
              <div className="space-y-1 p-2.5 text-sm">
                <p className="truncate font-semibold text-tinta">{a.nombre}</p>
                <p className="truncate text-tinta-suave">
                  {a.esPropio ? 'Tú' : a.subidoPor} · {fechaCorta(a.subidoEn)}
                </p>
                {puedeAdjuntar && (a.esPropio) ? (
                  <button
                    type="button"
                    onClick={() => setARetirar(a)}
                    className="min-h-8 font-semibold text-azul-500 underline-offset-2 hover:underline"
                  >
                    Retirar
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {puedeAdjuntar ? (
        <div
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setArrastrando(true);
            }
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            if (!lleno) void subir(e.dataTransfer.files);
          }}
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-borde-campo px-4 py-3 transition-colors duration-150',
            arrastrando && 'border-azul-500 bg-azul-50',
          )}
        >
          <input
            ref={entrada}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-labelledby="foto-etiqueta"
            data-adjuntar
            onChange={(e) => e.target.files && void subir(e.target.files)}
          />
          <Boton variante="secundario" onClick={() => entrada.current?.click()} disabled={subiendo || lleno} aria-describedby="foto-ayuda-estado">
            {subiendo ? <LoaderCircle aria-hidden className="size-4 animate-girar" /> : <Paperclip aria-hidden className="size-4" />}
            {subiendo ? 'Subiendo…' : 'Adjuntar foto'}
          </Boton>
          <p id="foto-ayuda-estado" className="flex min-w-0 flex-1 items-center gap-2 text-sm text-tinta-suave">
            <ImagePlus aria-hidden className="size-4 shrink-0" />
            {lleno ? 'Llegaste al máximo de fotos. Retira una para subir otra.' : 'También puedes arrastrarla hasta aquí. En el celular, toma la foto o elígela de la galería.'}
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-error">
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      {retiradas.length > 0 ? (
        <details className="text-sm text-tinta-suave">
          <summary className="cursor-pointer font-semibold">Fotos retiradas ({retiradas.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {retiradas.map((a) => (
              <li key={a.id}>
                <span className="font-medium text-tinta">{a.nombre}</span> · la retiró {a.retiradoPor ?? 'alguien'}
                {a.retiradoEn ? `, ${fechaCorta(a.retiradoEn)}` : ''}
                {a.motivoRetiro ? `. Motivo: ${a.motivoRetiro}` : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {grande ? (
        <Dialogo
          abierto
          onCerrar={() => setGrande(null)}
          titulo={grande.nombre}
          descripcion={`Subida por ${grande.esPropio ? 'ti' : grande.subidoPor} · ${fechaCorta(grande.subidoEn)}`}
          tamano="lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- la ruta pasa por permiso */}
          <img src={grande.url} alt={`Foto ${grande.nombre}`} className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-md" />
        </Dialogo>
      ) : null}

      {aRetirar ? (
        <DialogoConfirmacion
          abierto
          titulo="Retirar la foto"
          descripcion="La foto deja de mostrarse en la referencia. No se borra: queda en el historial con tu motivo."
          confirmar="Retirar foto"
          cancelar="Todavía no"
          pedirMotivo
          etiquetaMotivo="Motivo"
          ayudaMotivo="Ej.: se ve borrosa, la cambié por otra."
          onCerrar={() => setARetirar(null)}
          onConfirmar={async (motivo) => {
            const r = await retirarAdjuntoAccion({ adjuntoId: aRetirar.id, motivo });
            if (!r.ok) throw new Error(r.mensaje);
            alCambiar();
          }}
        />
      ) : null}
    </div>
  );
}
