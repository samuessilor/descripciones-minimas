'use client';

import { ChevronDown, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Boton } from '@/componentes/ui/button';
import { ItemMenu, MenuDesplegable, SeparadorMenu } from '@/componentes/ui/menu-desplegable';
import { useAvisos } from '@/componentes/ui/toast';

/** Filtros de la lista que entiende `/api/exportar` (el listado los usa con estos mismos nombres). */
const FILTROS = ['estado', 'tipo', 'q', 'mias', 'agencia', 'sinResponsable', 'partida'] as const;

interface Conteo {
  filtrado: number;
  toda: number;
}

const filas = (n: number) => `${n.toLocaleString('es-CO')} ${n === 1 ? 'fila' : 'filas'}`;

/**
 * «Descargar Excel ▾» del listado (SPEC 15.1): «Lo que veo en la lista (N filas)» aplica los filtros activos de la
 * direccion; «Toda la base (N filas)» los ignora. Ambas respetan lo que el rol puede ver. La descarga se hace con
 * `fetch` para poder explicar un fallo (limite de uso, sesion antigua) en vez de dejar la pagina en un JSON.
 */
export function DescargarExcel() {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const { avisar } = useAvisos();
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [archivadas, setArchivadas] = useState(false);
  const [descargando, setDescargando] = useState<'filtrado' | 'toda' | null>(null);
  const [abierto, setAbierto] = useState(false);

  const consulta = useCallback(
    (extra: Record<string, string> = {}) => {
      const q = new URLSearchParams();
      for (const k of FILTROS) {
        const v = parametros.get(k);
        if (v) q.set(k, v);
      }
      if (archivadas) q.set('archivadas', '1');
      for (const [k, v] of Object.entries(extra)) q.set(k, v);
      return q.toString();
    },
    [parametros, archivadas],
  );

  // El resumen (cuantas filas) se pide al ABRIR el menu, no al montar el listado: asi la pantalla no hace trabajo
  // que quiza nadie use. Si cambian los filtros con el menu abierto, se repite.
  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/exportar?${consulta({ resumen: '1' })}`, { cache: 'no-store' });
        const j = (await r.json()) as { ok: boolean; data?: Conteo };
        if (vigente && j.ok && j.data) setConteo(j.data);
      } catch {
        /* sin cifra: el menu sigue funcionando */
      }
    }, 0);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [consulta, abierto]);

  async function descargar(alcance: 'filtrado' | 'toda') {
    setDescargando(alcance);
    try {
      const r = await fetch(`/api/exportar?${consulta({ alcance })}`, { cache: 'no-store' });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { mensaje?: string; detalle?: { reautenticar?: boolean } } | null;
        avisar({
          tipo: 'error',
          titulo: 'No pudimos descargar el Excel',
          descripcion: j?.mensaje ?? 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.',
          ...(j?.detalle?.reautenticar ? { accion: { etiqueta: 'Entrar de nuevo', href: `/entrar?siguiente=${encodeURIComponent(ruta)}` } } : {}),
        });
        return;
      }
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'descripciones-minimas.xlsx';
      const total = r.headers.get('x-filas');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      avisar({ tipo: 'exito', titulo: 'Excel descargado', descripcion: `${total ? `${filas(Number(total))} · ` : ''}${nombre}` });
    } catch {
      avisar({ tipo: 'error', titulo: 'No pudimos descargar el Excel', descripcion: 'Revisa tu conexión e intenta de nuevo.' });
    } finally {
      setDescargando(null);
    }
  }

  return (
    <MenuDesplegable
      etiqueta="Opciones de descarga"
      alinear="fin"
      onCambio={setAbierto}
      disparador={(p) => (
        <Boton {...p} variante="secundario" disabled={descargando !== null} data-descargar-excel>
          {descargando ? <LoaderCircle aria-hidden className="size-4 animate-girar" /> : <FileSpreadsheet aria-hidden className="size-4 text-azul-700" />}
          {descargando ? 'Preparando Excel…' : 'Descargar Excel'}
          <ChevronDown aria-hidden className="size-4 text-tinta-suave" />
        </Boton>
      )}
    >
      <ItemMenu onClick={() => void descargar('filtrado')}>
        <FileSpreadsheet aria-hidden />
        <span>
          Lo que veo en la lista
          {conteo ? <span className="block text-sm text-tinta-suave">{filas(conteo.filtrado)}</span> : null}
        </span>
      </ItemMenu>
      <ItemMenu onClick={() => void descargar('toda')}>
        <FileSpreadsheet aria-hidden />
        <span>
          Toda la base
          {conteo ? <span className="block text-sm text-tinta-suave">{filas(conteo.toda)}</span> : null}
        </span>
      </ItemMenu>
      <SeparadorMenu />
      <label className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-base text-tinta hover:bg-azul-50">
        <input type="checkbox" className="casilla" checked={archivadas} onChange={(e) => setArchivadas(e.target.checked)} />
        Incluir archivadas
      </label>
    </MenuDesplegable>
  );
}
