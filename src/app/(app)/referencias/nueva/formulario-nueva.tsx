'use client';

import { CircleAlert, Copy, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';
import { crearReferenciaAccion, type EstadoCrear } from '@/app/acciones/ficha';
import { revisarCodigoApi } from '@/componentes/ficha/api-cliente';
import { AnillosLente } from '@/componentes/ui/decoracion';
import { Aviso } from '@/componentes/ui/aviso';
import { Boton } from '@/componentes/ui/button';
import { GrupoRadios } from '@/componentes/ui/casilla';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { AREAS, type Area } from '@/dominio/areas';
import { ETIQUETA_TIPO, TIPOS_PRODUCTO, type TipoProducto } from '@/dominio/campos';
import type { RevisionCodigo } from '@/server/acciones/crear-referencia';

const INICIAL: EstadoCrear = { estado: 'inicial' };

const DESCRIPCION_TIPO: Record<TipoProducto, string> = {
  INSUMO: 'Líquidos, químicos y consumibles',
  REPUESTO: 'Piezas para una máquina',
  EQUIPO: 'La máquina o el equipo completo',
  ACCESORIO: 'Complementos y herramientas',
  MONTURA: 'Monturas de gafas',
};

export interface OrigenSimilar {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoProducto;
  area: Area | null;
  /** Etiquetas de los campos que se copian. */
  copiados: string[];
}

/** Paso previo de la creacion (D-10): codigo, nombre, tipo y area responsable; nada mas. El resto se llena en la ficha, que se guarda sola. */
export function FormularioNueva({
  codigoInicial,
  similar,
  areaInicial,
  hoy,
}: {
  codigoInicial: string;
  similar: OrigenSimilar | null;
  /** La de la referencia de origen o la del area de quien crea; se puede cambiar. */
  areaInicial: string;
  hoy: string;
}) {
  const [estado, accion, pendiente] = useActionState(crearReferenciaAccion, INICIAL);
  const [codigo, setCodigo] = useState(codigoInicial);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<string>(similar?.tipo ?? '');
  const [area, setArea] = useState(areaInicial);
  const [fecha, setFecha] = useState('');
  const [errores, setErrores] = useState<{ codigo?: string; nombre?: string; tipo?: string; area?: string }>({});
  const [revision, setRevision] = useState<RevisionCodigo | null>(null);
  const [revisando, setRevisando] = useState(false);
  const peticion = useRef(0);

  // Revision en vivo del codigo: duplicado exacto (bloquea) y parecidos (solo avisa).
  useEffect(() => {
    const t = codigo.trim();
    const mia = ++peticion.current;
    const espera = setTimeout(async () => {
      if ([...t].length < 3) {
        if (peticion.current === mia) {
          setRevision(null);
          setRevisando(false);
        }
        return;
      }
      setRevisando(true);
      try {
        const r = await revisarCodigoApi(t);
        if (peticion.current === mia) setRevision(r.ok ? r.data : null);
      } catch {
        if (peticion.current === mia) setRevision(null);
      } finally {
        if (peticion.current === mia) setRevisando(false);
      }
    }, 450);
    return () => clearTimeout(espera);
  }, [codigo]);

  const duplicado = revision?.existente ?? null;
  const parecidas = revision?.parecidas ?? [];

  function validar(e: React.FormEvent<HTMLFormElement>) {
    const nuevos: typeof errores = {};
    if (codigo.trim() === '') nuevos.codigo = 'Escribe el código de la referencia.';
    if (nombre.trim() === '') nuevos.nombre = 'Escribe la descripción según factura.';
    if (tipo === '') nuevos.tipo = 'Elige el tipo de producto.';
    if (area === '') nuevos.area = 'Elige el área responsable.';
    if (duplicado) nuevos.codigo = 'Esa referencia ya existe. Ábrela en vez de crear otra.';
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) e.preventDefault();
  }

  const existenteServidor = estado.estado === 'error' ? estado.existenteId : undefined;
  const textoErrorCodigo = duplicado
    ? `Ya existe la referencia ${duplicado.codigo}${duplicado.archivada ? ' y está archivada' : ''}.`
    : (errores.codigo ?? (existenteServidor && estado.estado === 'error' ? estado.mensaje : undefined));
  const idExistente = duplicado?.id ?? existenteServidor;

  return (
    <div className="contenedor-lectura space-y-6">
      <div className="superficie-oscura relative overflow-hidden rounded-2xl bg-azul-700 px-6 py-7 text-white sm:px-8">
        <AnillosLente className="absolute -right-24 -top-12 h-[150%] w-auto opacity-90" />
        <p className="relative text-sm font-medium text-azul-200">Referencias</p>
        <h1 className="relative mt-1 font-display text-3xl font-extrabold tracking-tight">{similar ? 'Crear similar' : 'Nueva referencia'}</h1>
        <p className="relative mt-2 max-w-[48ch] text-base text-azul-100">
          {similar
            ? `Parte de ${similar.codigo}. Pon el código y la descripción según factura de la nueva; lo demás ya viene copiado.`
            : 'Empieza con cuatro datos. Todo lo demás lo llenas en la ficha, que se guarda sola.'}
        </p>
      </div>

      <form action={accion} onSubmit={validar} noValidate className="space-y-6 rounded-xl border border-borde-suave bg-superficie p-5 shadow-suave sm:p-7">
        {similar ? <input type="hidden" name="similarDe" value={similar.id} /> : null}
        {fecha ? <input type="hidden" name="fechaSolicitud" value={fecha} /> : null}

        {similar ? (
          <Aviso tipo="info" titulo="Qué se copia de la otra referencia">
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              <Copy aria-hidden className="size-3.5" />
              {similar.copiados.length > 0 ? similar.copiados.join(', ') : 'No había datos compartidos para copiar'}. No se copian el código, la
              descripción, el valor, la cantidad, la partida ni la clasificación.
            </span>
          </Aviso>
        ) : null}

        <CampoFormulario
          etiqueta="Código de referencia"
          ayuda="Tal como viene en la factura o en el catálogo. Ej.: 1GA0612A00"
          error={
            textoErrorCodigo ? (
              <>
                {textoErrorCodigo}{' '}
                {idExistente ? (
                  <Link className="font-semibold underline" href={`/referencias/${idExistente}`}>
                    {duplicado?.archivada ? 'Ver la referencia' : 'Abrir la referencia'}
                  </Link>
                ) : null}
              </>
            ) : undefined
          }
        >
          {(p) => (
            <Campo
              {...p}
              name="codigo"
              required
              maxLength={80}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              className="font-mono text-lg font-semibold tracking-wide"
              value={codigo}
              onChange={(e) => {
                setCodigo(e.target.value);
                setErrores((x) => ({ ...x, codigo: undefined }));
              }}
            />
          )}
        </CampoFormulario>

        {revisando ? <p className="-mt-3 text-sm text-tinta-suave">Revisando si ya existe…</p> : null}
        {!duplicado && parecidas.length > 0 ? (
          <Aviso tipo="aviso" titulo="Hay códigos parecidos">
            <ul className="space-y-1">
              {parecidas.map((s) => (
                <li key={s.id}>
                  <Link href={`/referencias/${s.id}`} className="font-mono font-semibold text-azul-500 underline underline-offset-2" target="_blank" rel="noopener">
                    {s.codigo}
                  </Link>{' '}
                  <span className="text-tinta-suave">· {s.nombreProducto}</span>
                </li>
              ))}
            </ul>
            <p className="pt-1 text-tinta-suave">Si es otra referencia, sigue. Esto es solo un aviso.</p>
          </Aviso>
        ) : null}

        <CampoFormulario
          etiqueta="Descripción según factura"
          ayuda="Tal cual aparece en la factura. Ej.: FILTRO ABSOLUTO -AIRE NUEVO"
          error={errores.nombre ?? (estado.estado === 'error' && !existenteServidor && /descripci[oó]n/i.test(estado.mensaje ?? '') ? estado.mensaje : undefined)}
        >
          {(p) => (
            <Campo
              {...p}
              name="nombreProducto"
              required
              maxLength={500}
              autoComplete="off"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                setErrores((x) => ({ ...x, nombre: undefined }));
              }}
            />
          )}
        </CampoFormulario>

        <GrupoRadios
          leyenda="Tipo de producto"
          ayuda="Define qué datos te pedimos después. Podrás cambiarlo en la ficha."
          nombre="tipoProducto"
          error={errores.tipo}
          valor={tipo}
          onCambio={(v) => {
            setTipo(v);
            setErrores((x) => ({ ...x, tipo: undefined }));
          }}
          opciones={TIPOS_PRODUCTO.map((t) => ({ valor: t, etiqueta: ETIQUETA_TIPO[t], descripcion: DESCRIPCION_TIPO[t] }))}
        />

        <CampoFormulario
          etiqueta="Área responsable"
          ayuda="El área a la que le pertenece la referencia: sus personas la verán en «Para mí». No depende del tipo."
          error={errores.area ?? (estado.estado === 'error' && /área/i.test(estado.mensaje ?? '') ? estado.mensaje : undefined)}
        >
          {(p) => (
            <Seleccion
              {...p}
              name="areaResponsable"
              required
              value={area}
              className="max-w-xs"
              onChange={(e) => {
                setArea(e.target.value);
                setErrores((x) => ({ ...x, area: undefined }));
              }}
            >
              <option value="">Elige el área</option>
              {AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Seleccion>
          )}
        </CampoFormulario>

        <details className="rounded-lg border border-borde-suave px-4 py-2.5">
          <summary className="flex min-h-9 cursor-pointer items-center text-sm font-semibold text-azul-700">Cambiar la fecha de solicitud</summary>
          <div className="pb-1 pt-2">
            <CampoFormulario etiqueta="Fecha de solicitud">
              {(p) => <Campo {...p} type="date" max={hoy} value={fecha} className="max-w-xs" onChange={(e) => setFecha(e.target.value)} />}
            </CampoFormulario>
          </div>
        </details>

        {estado.estado === 'error' && !existenteServidor ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-error/60 bg-error-fondo px-3.5 py-3 text-sm font-medium text-error">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{estado.mensaje}</span>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-borde-suave pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/referencias" className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-azul-500 underline-offset-2 hover:underline">
            Volver al listado
          </Link>
          <Boton type="submit" variante="primario" tamano="lg" cargando={pendiente} disabled={!!duplicado}>
            {pendiente ? 'Creando…' : 'Crear y seguir'}
          </Boton>
        </div>
        {duplicado ? (
          <p className="-mt-2 flex items-center gap-1.5 text-sm text-tinta-suave">
            <TriangleAlert aria-hidden className="size-4" /> No se puede crear: ese código ya existe.
          </p>
        ) : null}
      </form>
    </div>
  );
}
