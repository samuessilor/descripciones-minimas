import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Search } from 'lucide-react';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { activarItemCatalogoAccion, guardarItemCatalogoAccion, guardarPartidaAccion, guardarRestriccionAccion, moverItemCatalogoAccion } from '@/app/acciones/admin';
import { BotonAccion, FormularioAccion } from '@/componentes/admin/acciones';
import { CampoAdmin } from '@/componentes/admin/campos';
import { plural } from '@/componentes/admin/formato';
import { Desplegable, PestanasEnlace, Seccion } from '@/componentes/admin/piezas';
import { Boton } from '@/componentes/ui/button';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Campo } from '@/componentes/ui/input';
import { Insignia } from '@/componentes/ui/insignia';
import { EncabezadoPagina } from '@/componentes/ui/pagina';
import { ETIQUETA_TIPO, TIPOS_PRODUCTO } from '@/dominio/campos';
import {
  listarItemsCatalogo,
  listarPaisesAdmin,
  listarPartidas,
  listarRestricciones,
  opcionesParaPartida,
  type ItemCatalogoAdmin,
  type PartidaAdmin,
  type RestriccionAdmin,
} from '@/server/politicas/administracion-catalogos';
import type { OpcionesPartida } from '@/server/politicas/administracion-catalogos';
import { SinPermiso } from '@/componentes/ui/pantallas';
import { contextoAdmin, param } from '../_contexto';

export const metadata: Metadata = { title: 'Catálogos · Descripciones mínimas' };

type Clave = 'unidades' | 'aspecto' | 'paises' | 'tipos' | 'restricciones' | 'partidas';

const SECCIONES: ReadonlyArray<{ id: Clave; etiqueta: string }> = [
  { id: 'unidades', etiqueta: 'Unidades de medida' },
  { id: 'aspecto', etiqueta: 'Aspecto físico' },
  { id: 'paises', etiqueta: 'Países' },
  { id: 'tipos', etiqueta: 'Tipos de producto' },
  { id: 'restricciones', etiqueta: 'Restricciones' },
  { id: 'partidas', etiqueta: 'Partidas arancelarias' },
];

const LISTAS = {
  unidades: {
    catalogo: 'unidad_medida' as const,
    titulo: 'Unidades de medida',
    descripcion: 'Las que se ofrecen en el campo «Unidad de medida» de la ficha. Solo la unidad, no el empaque.',
    ejemplo: 'Ejemplo: Metros',
    singular: 'unidad',
  },
  aspecto: {
    catalogo: 'aspecto_fisico' as const,
    titulo: 'Aspecto físico',
    descripcion: 'Las opciones del campo «Aspecto físico» de la ficha.',
    ejemplo: 'Ejemplo: Granulado',
    singular: 'aspecto',
  },
};

function ListaDeValores({ clave, items }: { clave: keyof typeof LISTAS; items: ItemCatalogoAdmin[] }) {
  const cfg = LISTAS[clave];
  const activos = items.filter((i) => i.activo).length;
  return (
    <div className="space-y-6">
      <Seccion id="agregar" titulo={`Agregar ${cfg.singular}`} descripcion={cfg.descripcion}>
        <FormularioAccion accion={guardarItemCatalogoAccion} enviar="Agregar al final de la lista" enviando="Agregando…" reiniciar className="max-w-xl">
          <input type="hidden" name="catalogo" value={cfg.catalogo} />
          <CampoAdmin nombre="valor" etiqueta="Valor" ayuda={`${cfg.ejemplo}. Si ya existe, lo dejamos activo en vez de repetirlo.`} required maxLength={100} />
        </FormularioAccion>
      </Seccion>

      <Seccion
        id="valores"
        titulo={cfg.titulo}
        descripcion={`${activos} de ${items.length} activos. Un valor inactivo deja de ofrecerse, pero se sigue mostrando en las referencias que ya lo usaron.`}
        sinPadding
      >
        {items.length === 0 ? (
          <div className="p-5">
            <EstadoVacio compacto titulo="La lista está vacía" descripcion="Agrega el primer valor con el formulario de arriba." />
          </div>
        ) : (
          <ol className="divide-y divide-borde-suave">
            {items.map((it, i) => (
              <li key={it.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                <div className="flex gap-0.5">
                  <BotonAccion accion={moverItemCatalogoAccion} campos={{ id: it.id, direccion: 'arriba' }} variante="terciario" tamano="icono-sm" etiquetaAria={`Subir ${it.valor}`} deshabilitado={i === 0}>
                    <ArrowUp aria-hidden className="size-4" />
                  </BotonAccion>
                  <BotonAccion accion={moverItemCatalogoAccion} campos={{ id: it.id, direccion: 'abajo' }} variante="terciario" tamano="icono-sm" etiquetaAria={`Bajar ${it.valor}`} deshabilitado={i === items.length - 1}>
                    <ArrowDown aria-hidden className="size-4" />
                  </BotonAccion>
                </div>
                <div className="min-w-0 flex-1 basis-48">
                  <p className={it.activo ? 'text-base font-semibold text-tinta' : 'text-base font-semibold text-tinta-suave line-through decoration-1'}>{it.valor}</p>
                  <p className="text-sm text-tinta-suave">{it.usos === 0 ? 'Sin usar todavía' : `En ${plural(it.usos, 'referencia', 'referencias')}`}</p>
                </div>
                {it.activo ? <Insignia variante="azul">Activo</Insignia> : <Insignia variante="neutra">Inactivo</Insignia>}
                <BotonAccion
                  accion={activarItemCatalogoAccion}
                  campos={{ id: it.id, activo: it.activo ? 'no' : 'si' }}
                  etiquetaAria={`${it.activo ? 'Desactivar' : 'Activar'} ${it.valor}`}
                >
                  {it.activo ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                  {it.activo ? 'Desactivar' : 'Activar'}
                </BotonAccion>
              </li>
            ))}
          </ol>
        )}
      </Seccion>
    </div>
  );
}

function FormularioRestriccion({ r }: { r?: RestriccionAdmin }) {
  return (
    <FormularioAccion
      accion={guardarRestriccionAccion}
      enviar={r ? 'Guardar restricción' : 'Crear restricción'}
      enviando="Guardando…"
      variante={r ? 'secundario' : 'primario'}
      reiniciar={!r}
      className="space-y-4"
    >
      {r ? <input type="hidden" name="id" value={r.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <CampoAdmin nombre="codigo" etiqueta="Código" ayuda={r ? 'No cambia una vez creado.' : 'Ejemplo: RES-8501.31.20.00'} defaultValue={r?.codigo ?? ''} readOnly={!!r} required maxLength={40} mono />
        {r ? (
          <CampoAdmin nombre="activa" etiqueta="Estado" control="seleccion" defaultValue={r.activa ? 'si' : 'no'}>
            <option value="si">Activa</option>
            <option value="no">Inactiva</option>
          </CampoAdmin>
        ) : null}
      </div>
      <CampoAdmin
        nombre="texto"
        etiqueta="Texto de la restricción"
        ayuda="Es el texto normativo que se copia a la referencia. Cambiarlo vale para las referencias nuevas; las que ya lo copiaron no se tocan."
        control="area"
        defaultValue={r?.texto ?? ''}
        rows={5}
        required
        maxLength={4000}
      />
    </FormularioAccion>
  );
}

function ListaRestricciones({ restricciones }: { restricciones: RestriccionAdmin[] }) {
  return (
    <div className="space-y-6">
      <Seccion id="nueva-restriccion" titulo="Nueva restricción" descripcion="Texto normativo que la aduana aplica según la partida (RETIE, RAEE, RPCAEE…).">
        <FormularioRestriccion />
      </Seccion>
      <Seccion id="restricciones" titulo="Restricciones" descripcion={`${plural(restricciones.length, 'restricción', 'restricciones')}.`} sinPadding>
        {restricciones.length === 0 ? (
          <div className="p-5">
            <EstadoVacio compacto titulo="Aún no hay restricciones" descripcion="Crea la primera con el formulario de arriba." />
          </div>
        ) : (
          <ul className="divide-y divide-borde-suave">
            {restricciones.map((r) => (
              <li key={r.id} className="space-y-3 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-sm font-bold text-azul-900">{r.codigo}</p>
                  {r.activa ? <Insignia variante="azul">Activa</Insignia> : <Insignia variante="neutra">Inactiva</Insignia>}
                  <span className="text-sm text-tinta-suave">{r.partidas === 0 ? 'Ninguna partida la usa' : `La usa${r.partidas === 1 ? '' : 'n'} ${plural(r.partidas, 'partida', 'partidas')}`}</span>
                </div>
                <p className="line-clamp-3 max-w-[75ch] whitespace-pre-line text-base text-tinta">{r.texto}</p>
                <Desplegable
                  resumen={
                    <>
                      <Pencil aria-hidden className="size-4" />
                      Editar {r.codigo}
                    </>
                  }
                >
                  <FormularioRestriccion r={r} />
                </Desplegable>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  );
}

function FormularioPartida({ p, opciones }: { p?: PartidaAdmin; opciones: OpcionesPartida }) {
  return (
    <FormularioAccion
      accion={guardarPartidaAccion}
      enviar={p ? 'Guardar partida' : 'Crear partida'}
      enviando="Guardando…"
      variante={p ? 'secundario' : 'primario'}
      reiniciar={!p}
      className="space-y-4"
    >
      <input type="hidden" name="modo" value={p ? 'editar' : 'crear'} />
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoAdmin nombre="codigo" etiqueta="Partida" ayuda={p ? 'No cambia una vez creada.' : 'Diez dígitos. Ejemplo: 8466.92.00.00'} defaultValue={p?.codigo ?? ''} readOnly={!!p} required control="numerico" maxLength={20} mono />
        <CampoAdmin nombre="descripcion" etiqueta="Descripción" opcional defaultValue={p?.descripcion ?? ''} maxLength={300} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CampoAdmin nombre="restriccionId" etiqueta="Restricción" opcional control="seleccion" defaultValue={p?.restriccionId ?? ''}>
          <option value="">Ninguna</option>
          {opciones.restricciones.map((r) => (
            <option key={r.id} value={r.id}>
              {r.codigo}
            </option>
          ))}
        </CampoAdmin>
        {p ? (
          <CampoAdmin nombre="activa" etiqueta="Estado" control="seleccion" defaultValue={p.activa ? 'si' : 'no'}>
            <option value="si">Activa</option>
            <option value="no">Inactiva</option>
          </CampoAdmin>
        ) : null}
      </div>
    </FormularioAccion>
  );
}

export default async function AdminCatalogos({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await contextoAdmin();
  if (!ctx) return <SinPermiso />;
  const sp = await searchParams;
  const activa: Clave = SECCIONES.find((s) => s.id === param(sp.seccion))?.id ?? 'unidades';
  const q = param(sp.q);

  const pestanas = SECCIONES.map((s) => ({ id: s.id, etiqueta: s.etiqueta, href: s.id === 'unidades' ? '/admin/catalogos' : `/admin/catalogos?seccion=${s.id}` }));

  let contenido: ReactNode;
  if (activa === 'unidades' || activa === 'aspecto') {
    const items = await listarItemsCatalogo(ctx.db, ctx.actor, LISTAS[activa].catalogo);
    contenido = <ListaDeValores clave={activa} items={items} />;
  } else if (activa === 'paises') {
    const { principales, todos } = await listarPaisesAdmin(ctx.db, ctx.actor);
    contenido = (
      <div className="space-y-6">
        <Seccion
          id="principales"
          titulo="Principales"
          descripcion="Salen primero al elegir el país de origen. Son los más usados en la base; mientras no haya datos, Francia y China."
        >
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {principales.map((p) => (
              <li key={p.codigo} className="flex items-baseline justify-between gap-3 border-b border-borde-suave py-2">
                <span className="text-base font-semibold text-tinta">{p.nombre}</span>
                <span className="text-sm tabular-nums text-tinta-suave">{p.usos === 0 ? 'sin usar' : plural(p.usos, 'referencia', 'referencias')}</span>
              </li>
            ))}
          </ul>
        </Seccion>
        <Seccion id="todos" titulo="Todos los países" descripcion={`Lista oficial de ${todos.length} países y territorios (ISO 3166). No se edita.`}>
          <Desplegable resumen={<>Ver los {todos.length} países</>}>
            <ul className="columns-1 gap-8 text-sm sm:columns-2 lg:columns-3">
              {todos.map((p) => (
                <li key={p.codigo} className="break-inside-avoid py-0.5 text-tinta">
                  {p.nombre} <span className="font-mono text-xs text-tinta-suave">{p.codigo}</span>
                </li>
              ))}
            </ul>
          </Desplegable>
        </Seccion>
      </div>
    );
  } else if (activa === 'tipos') {
    contenido = (
      <Seccion id="tipos" titulo="Tipos de producto" descripcion="Son cuatro y no se editan aquí: agregar uno cambia qué campos pide la ficha, y eso se hace con un despliegue." sinPadding>
        <ul className="divide-y divide-borde-suave">
          {TIPOS_PRODUCTO.map((t) => (
            <li key={t} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <span className="text-base font-semibold text-tinta">{ETIQUETA_TIPO[t]}</span>
              <Insignia variante="contorno">Fijo</Insignia>
            </li>
          ))}
        </ul>
      </Seccion>
    );
  } else if (activa === 'restricciones') {
    contenido = <ListaRestricciones restricciones={await listarRestricciones(ctx.db, ctx.actor)} />;
  } else {
    const [partidas, opciones] = await Promise.all([listarPartidas(ctx.db, ctx.actor, { q }), opcionesParaPartida(ctx.db, ctx.actor)]);
    contenido = (
      <div className="space-y-6">
        <Seccion id="nueva-partida" titulo="Nueva partida" descripcion="La aduana la escribe en la referencia; aquí se define qué restricción se copia a la referencia al elegirla.">
          <FormularioPartida opciones={opciones} />
        </Seccion>
        <Seccion
          id="partidas"
          titulo="Partidas"
          descripcion={`${plural(partidas.length, 'partida', 'partidas')}${q ? ` para «${q}»` : ''}.`}
          acciones={
            <form method="get" action="/admin/catalogos" role="search" aria-label="Buscar partidas" className="flex items-center gap-2">
              <input type="hidden" name="seccion" value="partidas" />
              <div className="relative">
                <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tinta-suave" />
                <Campo name="q" type="search" defaultValue={q ?? ''} placeholder="Partida o descripción" aria-label="Buscar partida" className="min-h-10 w-56 pl-9" autoComplete="off" />
              </div>
              <Boton type="submit" variante="secundario" tamano="sm">
                Buscar
              </Boton>
            </form>
          }
          sinPadding
        >
          {partidas.length === 0 ? (
            <div className="p-5">
              <EstadoVacio compacto icono={Plus} titulo={q ? 'No encontramos esa partida' : 'Aún no hay partidas'} descripcion={q ? 'Revisa los dígitos o crea la partida con el formulario de arriba.' : 'Crea la primera con el formulario de arriba.'} />
            </div>
          ) : (
            <ul className="divide-y divide-borde-suave">
              {partidas.map((p) => (
                <li key={p.codigo} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="font-mono text-base font-bold text-azul-900">{p.codigo}</p>
                    {p.activa ? <Insignia variante="azul">Activa</Insignia> : <Insignia variante="neutra">Inactiva</Insignia>}
                    <span className="text-sm text-tinta-suave">{p.fichas === 0 ? 'Sin referencias' : plural(p.fichas, 'referencia', 'referencias')}</span>
                  </div>
                  <p className="text-sm text-tinta-suave">
                    {p.descripcion ? `${p.descripcion} · ` : ''}
                    Restricción: {p.restriccionCodigo ?? 'ninguna'}
                  </p>
                  <Desplegable
                    resumen={
                      <>
                        <Pencil aria-hidden className="size-4" />
                        Editar {p.codigo}
                      </>
                    }
                  >
                    <FormularioPartida p={p} opciones={opciones} />
                  </Desplegable>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    );
  }

  return (
    <>
      <EncabezadoPagina titulo="Catálogos" descripcion="Las listas que ofrece la ficha, los textos normativos y las partidas con su cuestionario. Nada se borra: se desactiva." />
      <PestanasEnlace etiqueta="Catálogos" items={pestanas} activa={activa} />
      {contenido}
    </>
  );
}
