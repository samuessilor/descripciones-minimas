'use client';

import { Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Boton } from '@/componentes/ui/button';
import { Casilla } from '@/componentes/ui/casilla';
import { Campo, Seleccion } from '@/componentes/ui/input';
import { prefijoPartida } from '@/dominio/busqueda';
import { ETIQUETA_TIPO, TIPOS_PRODUCTO } from '@/dominio/campos';
import { cn } from '@/lib/utils';
import { ETIQUETA_ORDEN, ORDENES, parametrosDeFiltros, type FiltrosListado as Filtros } from '@/server/politicas/listado';

/**
 * Barra de filtros del listado (SPEC 10.3). Los filtros viven en la URL: se comparten, sobreviven a recargar y
 * funcionan sin JavaScript (es un formulario GET). Con JavaScript se aplican al instante, sin recargar la
 * pagina, y el texto espera a que dejes de escribir.
 */
export function FiltrosListado({
  filtros,
  agencias,
  esInterno,
  hayFiltros,
}: {
  filtros: Filtros;
  agencias: Array<{ id: string; nombre: string }>;
  esInterno: boolean;
  hayFiltros: boolean;
}) {
  const router = useRouter();
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendiente, empezar] = useTransition();

  // Los controles son controlados: si la URL cambia desde fuera (limpiar filtros, el buscador de la barra), siguen a la URL.
  const clave = parametrosDeFiltros({ ...filtros, pagina: 1 }).toString();
  const [claveVista, setClaveVista] = useState(clave);
  const [v, setV] = useState({
    q: filtros.q,
    partida: filtros.partida,
    tipo: filtros.tipo ?? '',
    orden: filtros.orden as string,
    agencia: filtros.agencia ?? '',
    mias: filtros.mias,
    sinResponsable: filtros.sinResponsable,
  });
  if (clave !== claveVista) {
    setClaveVista(clave);
    setV({ q: filtros.q, partida: filtros.partida, tipo: filtros.tipo ?? '', orden: filtros.orden, agencia: filtros.agencia ?? '', mias: filtros.mias, sinResponsable: filtros.sinResponsable });
  }

  useEffect(
    () => () => {
      if (espera.current) clearTimeout(espera.current);
    },
    [],
  );

  function aplicar(cambio: Partial<typeof v> = {}, esperarTecleo = false) {
    const siguiente = { ...v, ...cambio };
    setV(siguiente);
    if (espera.current) clearTimeout(espera.current);
    const ir = () => {
      const nuevo: Partial<Filtros> = {
        estado: filtros.estado,
        q: siguiente.q.trim(),
        // Se guarda tal como se escribe (con puntos) para que el campo no salte mientras se teclea; el filtro ignora los puntos
        partida: prefijoPartida(siguiente.partida) ? siguiente.partida.trim() : '',
        tipo: (TIPOS_PRODUCTO as readonly string[]).includes(siguiente.tipo) ? (siguiente.tipo as Filtros['tipo']) : null,
        mias: siguiente.mias,
        sinResponsable: siguiente.sinResponsable,
        agencia: siguiente.agencia || null,
        orden: (ORDENES as readonly string[]).includes(siguiente.orden) ? (siguiente.orden as Filtros['orden']) : 'recientes',
        pagina: 1,
      };
      const qs = parametrosDeFiltros(nuevo).toString();
      empezar(() => router.replace(qs ? `/referencias?${qs}` : '/referencias', { scroll: false }));
    };
    if (esperarTecleo) espera.current = setTimeout(ir, 350);
    else ir();
  }

  return (
    <form
      method="get"
      action="/referencias"
      role="search"
      aria-label="Filtrar referencias"
      onSubmit={(e) => {
        e.preventDefault();
        aplicar();
      }}
      className="space-y-4 rounded-xl border border-borde-suave bg-superficie p-4 shadow-suave sm:p-5"
    >
      {filtros.estado !== 'todas' ? <input type="hidden" name="estado" value={filtros.estado} /> : null}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
        <div className="space-y-1.5">
          <label htmlFor="filtro-q" className="block text-sm font-semibold text-tinta">
            Buscar en la lista
          </label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
            <Campo
              id="filtro-q"
              name="q"
              type="search"
              autoComplete="off"
              placeholder="Código, descripción, nombre comercial, proveedor, fabricante…"
              className="pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
              value={v.q}
              onChange={(e) => aplicar({ q: e.target.value }, true)}
            />
            {v.q !== '' ? (
              <button
                type="button"
                aria-label="Borrar lo escrito"
                onClick={() => aplicar({ q: '' })}
                className="absolute inset-y-0 right-1.5 my-auto inline-flex size-8 items-center justify-center rounded text-tinta-suave hover:bg-azul-50 hover:text-tinta"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro-tipo" className="block text-sm font-semibold text-tinta">
            Tipo de producto
          </label>
          <Seleccion id="filtro-tipo" name="tipo" value={v.tipo} onChange={(e) => aplicar({ tipo: e.target.value })}>
            <option value="">Todos los tipos</option>
            {TIPOS_PRODUCTO.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </option>
            ))}
          </Seleccion>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="filtro-orden" className="block text-sm font-semibold text-tinta">
            Ordenar por
          </label>
          <Seleccion id="filtro-orden" name="orden" value={v.orden} onChange={(e) => aplicar({ orden: e.target.value })}>
            {ORDENES.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORDEN[o]}
              </option>
            ))}
          </Seleccion>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {esInterno && agencias.length > 0 ? (
          <div className="min-w-56 flex-1 space-y-1.5 sm:max-w-xs">
            <label htmlFor="filtro-agencia" className="block text-sm font-semibold text-tinta">
              En manos de la agencia
            </label>
            <Seleccion id="filtro-agencia" name="agencia" value={v.agencia} onChange={(e) => aplicar({ agencia: e.target.value })}>
              <option value="">Cualquiera</option>
              {agencias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre.replace(/\s*\[.*?\]/g, '')}
                </option>
              ))}
            </Seleccion>
          </div>
        ) : null}
        <div className="w-full space-y-1.5 sm:w-52">
          <label htmlFor="filtro-partida" className="block text-sm font-semibold text-tinta">
            Partida arancelaria
          </label>
          <Campo
            id="filtro-partida"
            name="partida"
            inputMode="decimal"
            autoComplete="off"
            maxLength={13}
            placeholder="Ej. 8421 o 8421.39"
            className="font-mono"
            value={v.partida}
            onChange={(e) => aplicar({ partida: e.target.value }, true)}
          />
        </div>
        <Casilla name="mias" value="1" checked={v.mias} onChange={(e) => aplicar({ mias: e.target.checked })} etiqueta="Solo mis pendientes" />
        {esInterno ? <Casilla name="sinResponsable" value="1" checked={v.sinResponsable} onChange={(e) => aplicar({ sinResponsable: e.target.checked })} etiqueta="Sin responsable" /> : null}
        <div className="ml-auto flex items-center gap-3">
          {pendiente ? (
            <span role="status" className="text-sm text-tinta-suave">
              Actualizando…
            </span>
          ) : null}
          {hayFiltros ? (
            <Link href="/referencias" className={cn('inline-flex min-h-11 items-center px-2 text-sm font-semibold text-azul-500 underline-offset-2 hover:underline')}>
              Limpiar filtros
            </Link>
          ) : null}
          <noscript>
            <Boton type="submit" variante="secundario" tamano="sm">
              Aplicar filtros
            </Boton>
          </noscript>
        </div>
      </div>
    </form>
  );
}
