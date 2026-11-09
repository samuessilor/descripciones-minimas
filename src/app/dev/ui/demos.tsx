'use client';

import { Bell, Download, FileStack, Plus, Search, Send, SearchX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Logo } from '@/componentes/Logo';
import { EstadoChip, textoFaltan } from '@/componentes/ui/estado-chip';
import { Aviso } from '@/componentes/ui/aviso';
import { Avatar, Persona } from '@/componentes/ui/avatar';
import { Boton, EnlaceBoton } from '@/componentes/ui/button';
import { CampoFormulario } from '@/componentes/ui/campo-formulario';
import { Casilla, GrupoRadios, Interruptor } from '@/componentes/ui/casilla';
import { Combobox } from '@/componentes/ui/combobox';
import { Cajon, Dialogo, DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { EstadoVacio } from '@/componentes/ui/estado-vacio';
import { Esqueleto, EsqueletoFilas } from '@/componentes/ui/esqueleto';
import { AreaTexto, Campo, Seleccion } from '@/componentes/ui/input';
import { Contador, Insignia, Tecla } from '@/componentes/ui/insignia';
import { ItemMenu, MenuDesplegable, SeparadorMenu } from '@/componentes/ui/menu-desplegable';
import { EncabezadoPagina, Migas } from '@/componentes/ui/pagina';
import { Paginacion } from '@/componentes/ui/paginacion';
import { PantallaEstado } from '@/componentes/ui/pantalla-estado';
import { Pestanas } from '@/componentes/ui/pestanas';
import { Popover } from '@/componentes/ui/popover';
import { BarraProgreso } from '@/componentes/ui/progreso';
import { SeccionFicha, Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/componentes/ui/tarjeta';
import { TablaDatos } from '@/componentes/ui/tabla';
import { useAvisos } from '@/componentes/ui/toast';
import { Tooltip } from '@/componentes/ui/tooltip';

const INDICE = [
  ['marca', 'Marca y logo'],
  ['color', 'Color'],
  ['tipografia', 'Tipografía'],
  ['botones', 'Botones'],
  ['estado', 'Estado e insignias'],
  ['formulario', 'Formulario'],
  ['ficha', 'Sección de la ficha'],
  ['avisos', 'Avisos'],
  ['capas', 'Diálogo, cajón y popover'],
  ['navegacion', 'Pestañas y migas'],
  ['tabla', 'Tabla y tarjetas'],
  ['carga', 'Carga y vacíos'],
] as const;

function Bloque({ id, titulo, descripcion, children }: { id: string; titulo: string; descripcion?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-28 space-y-5 border-t border-borde-suave pt-8">
      <div>
        <h2 id={`${id}-t`} className="font-display text-2xl font-extrabold tracking-tight">
          {titulo}
        </h2>
        {descripcion ? <p className="mt-1 max-w-[65ch] text-tinta-suave">{descripcion}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Muestra({ etiqueta, children, oscuro = false }: { etiqueta?: string; children: ReactNode; oscuro?: boolean }) {
  return (
    <div className="space-y-2">
      {etiqueta ? <p className="text-sm font-semibold text-tinta-suave">{etiqueta}</p> : null}
      <div className={oscuro ? 'superficie-oscura fondo-azul flex flex-wrap items-center gap-3 rounded-xl p-5' : 'flex flex-wrap items-center gap-3'}>{children}</div>
    </div>
  );
}

const COLORES: { nombre: string; token: string; hex: string; uso: string; sobre?: string; contraste?: string }[] = [
  { nombre: 'azul-900', token: '--azul-900', hex: '#071F4A', uso: 'Barra superior, panel de entrada', sobre: 'text-white', contraste: '16,11:1 con blanco' },
  { nombre: 'azul-700', token: '--azul-700', hex: '#0B2F6B', uso: 'MARCA provisional (PA-15), botón primario', sobre: 'text-white', contraste: '12,86:1 con blanco' },
  { nombre: 'azul-600', token: '--azul-600', hex: '#1B4A99', uso: 'Hover del primario, progreso', sobre: 'text-white', contraste: '8,45:1 con blanco' },
  { nombre: 'azul-500', token: '--azul-500', hex: '#0B5FD0', uso: 'Enlaces en texto', sobre: 'text-white', contraste: '5,90:1 sobre blanco' },
  { nombre: 'azul-200', token: '--azul-200', hex: '#BCD3F5', uso: 'Bordes azules, texto claro sobre azul-900', sobre: 'text-azul-900', contraste: '10,56:1 sobre azul-900' },
  { nombre: 'azul-50', token: '--azul-50', hex: '#EEF4FC', uso: 'Fondos de hover y selección', sobre: 'text-azul-900', contraste: '11,62:1 con azul-700' },
  { nombre: 'tinta', token: '--tinta', hex: '#0F1B2D', uso: 'Texto principal', sobre: 'text-white', contraste: '15,71:1 sobre el fondo' },
  { nombre: 'tinta-suave', token: '--tinta-suave', hex: '#4A5A70', uso: 'Ayudas y texto secundario', sobre: 'text-white', contraste: '7,03:1 blanco · 6,39:1 fondo' },
  { nombre: 'borde-campo', token: '--borde-campo', hex: '#6B7C93', uso: 'Borde de controles (≥ 3:1)', sobre: 'text-white', contraste: '4,26:1 sobre blanco' },
  { nombre: 'fondo', token: '--fondo', hex: '#F5F4F1', uso: 'Fondo de página (neutro cálido)', sobre: 'text-tinta' },
  { nombre: 'amarillo-fondo', token: '--amarillo-fondo', hex: '#FFF4CC', uso: 'ESTADO pendiente (texto #5C4300)', sobre: 'text-amarillo-texto', contraste: '8,44:1' },
  { nombre: 'verde-fondo', token: '--verde-fondo', hex: '#DDF3E4', uso: 'ESTADO completa/clasificada (texto #0D4F2B)', sobre: 'text-verde-texto', contraste: '8,30:1' },
  { nombre: 'error', token: '--error', hex: '#A4262C', uso: 'Solo errores (nunca estado)', sobre: 'text-white', contraste: '7,26:1 blanco · 6,36:1 error-fondo' },
];

type FilaDemo = { id: string; estado: 'amarillo' | 'verde'; codigo: string; nombre: string; tipo: string; partida: string; dias: number; espera: string };
const FILAS: FilaDemo[] = [
  { id: '1', estado: 'amarillo', codigo: 'TEST-0001', nombre: 'Limpiador alcalino (ejemplo)', tipo: 'Insumo', partida: '—', dias: 12, espera: 'Brian' },
  { id: '2', estado: 'verde', codigo: 'TEST-0002', nombre: 'Motor trifásico (ejemplo)', tipo: 'Equipo / Máquina', partida: '8501.52.00.00', dias: 31, espera: '—' },
  { id: '3', estado: 'amarillo', codigo: 'TEST-0003', nombre: 'Filtro de aire (ejemplo)', tipo: 'Repuesto', partida: '—', dias: 3, espera: 'Charles' },
];

export function Demos({ paises }: { paises: { codigo: string; nombre: string }[] }) {
  const { avisar } = useAvisos();
  const [dialogo, setDialogo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [cajon, setCajon] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [pais, setPais] = useState<string | null>('CO');
  const [abiertaB, setAbiertaB] = useState(true);

  return (
    <div className="min-h-dvh bg-fondo">
      <header className="superficie-oscura sticky top-0 z-10 border-b border-white/10 bg-azul-900 text-white">
        <div className="mx-auto flex min-h-14 max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
          <Logo alto={18} />
          <span aria-hidden className="h-5 w-px bg-white/25" />
          <p className="font-display font-bold">Biblioteca de componentes</p>
          <Insignia variante="oscura" className="border-white/30 bg-white/10 sm:ml-auto">
            Solo desarrollo
          </Insignia>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Secciones" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex flex-wrap gap-1 lg:flex-col">
            {INDICE.map(([id, nombre]) => (
              <li key={id}>
                <a href={`#${id}`} className="inline-flex min-h-9 items-center rounded-md px-2.5 text-sm font-semibold text-tinta-suave hover:bg-azul-50 hover:text-azul-900">
                  {nombre}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="contenido" tabIndex={-1} className="min-w-0 space-y-12 outline-none">
          <header className="space-y-2">
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Sistema visual «Laboratorio ordenado»</h1>
            <p className="max-w-[65ch] text-lg text-tinta-suave">
              Azul profundo para estructura y acciones. Amarillo y verde son solo del estado de la referencia. Todo lo de esta página
              vive en <code className="font-mono text-base">src/componentes/ui/</code> y está documentado en <code className="font-mono text-base">docs/UI-GUIA.md</code>.
            </p>
          </header>

          <Bloque id="marca" titulo="Marca y logo" descripcion="Archivos reales de EssilorLuxottica (agregador, no el kit oficial: PA-15). Nunca se deforman ni se recolorean.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Muestra etiqueta="Sobre fondo oscuro (wordmark blanco)" oscuro>
                <Logo alto={28} />
              </Muestra>
              <Muestra etiqueta="Sobre fondo claro (wordmark negro)">
                <div className="rounded-xl border border-borde-suave bg-white p-5">
                  <Logo alto={28} fondo="claro" />
                </div>
              </Muestra>
              <Muestra etiqueta="Símbolo (dos lentes)">
                <div className="rounded-xl border border-borde-suave bg-white p-5">
                  <Logo variante="simbolo" fondo="claro" alto={36} />
                </div>
              </Muestra>
            </div>
          </Bloque>

          <Bloque id="color" titulo="Color" descripcion="Contrastes WCAG 2.x calculados. Estado: icono de forma distinta + palabra; nunca solo color.">
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {COLORES.map((c) => (
                <li key={c.nombre} className="overflow-hidden rounded-xl border border-borde-suave bg-superficie">
                  <div className={`flex h-16 items-end px-3 pb-2 font-mono text-sm font-semibold ${c.sobre ?? ''}`} style={{ background: `var(${c.token})` }}>
                    <span className="rounded bg-white/95 px-1.5 py-0.5 text-tinta">{c.nombre}</span>
                  </div>
                  <div className="space-y-0.5 px-3 py-2 text-sm">
                    <p className="font-mono text-xs text-tinta-suave">{c.hex}</p>
                    <p>{c.uso}</p>
                    {c.contraste ? <p className="text-xs text-tinta-suave">{c.contraste}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          </Bloque>

          <Bloque id="tipografia" titulo="Tipografía" descripcion="Manrope para títulos y cifras; Source Sans 3 para la interfaz; monoespaciada para códigos y partidas. Escala 1,2 sobre 16 px.">
            <Tarjeta>
              <TarjetaCuerpo className="space-y-3">
                <p className="font-display text-4xl font-extrabold tracking-tight">44 · Titular de entrada</p>
                <p className="font-display text-3xl font-extrabold tracking-tight">36 · Título de pantalla pública</p>
                <p className="font-display text-2xl font-extrabold tracking-tight">28 · Título de página</p>
                <p className="font-display text-xl font-extrabold tracking-tight">23 · Título de sección</p>
                <p className="font-display text-lg font-bold">19 · Subtítulo</p>
                <p className="text-base">16 · Texto base y campos. Descripción según factura, tal cual aparece.</p>
                <p className="text-sm text-tinta-suave">14 · Ayudas, tablas densas, datos secundarios.</p>
                <p className="text-xs text-tinta-suave">12 · Autor y fecha bajo un campo: Edward · 20 oct, 10:12</p>
                <p className="font-mono text-base">8501.52.00.00 · TEST-0002</p>
              </TarjetaCuerpo>
            </Tarjeta>
          </Bloque>

          <Bloque id="botones" titulo="Botones" descripcion="Un solo primario por vista. Ninguno es verde ni amarillo. 44 px (48 en móvil).">
            <Muestra etiqueta="Variantes">
              <Boton>Nueva referencia</Boton>
              <Boton variante="secundario">Enviar a…</Boton>
              <Boton variante="terciario">Cancelar</Boton>
              <Boton variante="peligro">Retirar acceso</Boton>
              <Boton disabled>Deshabilitado</Boton>
            </Muestra>
            <Muestra etiqueta="Tamaños e iconos">
              <Boton tamano="sm">Pequeño</Boton>
              <Boton>Mediano</Boton>
              <Boton tamano="lg">Grande</Boton>
              <Boton tamano="icono" variante="secundario" aria-label="Buscar">
                <Search aria-hidden className="size-5" />
              </Boton>
              <Boton>
                <Plus aria-hidden className="size-4" />
                Con icono
              </Boton>
              <EnlaceBoton href="/dev/ui#botones" variante="secundario">
                Enlace con forma de botón
              </EnlaceBoton>
            </Muestra>
            <Muestra etiqueta="Cargando (con texto de «en curso»)">
              <Boton
                cargando={cargando}
                onClick={() => {
                  setCargando(true);
                  setTimeout(() => setCargando(false), 1800);
                }}
              >
                {cargando ? 'Guardando…' : 'Guardar cambios'}
              </Boton>
            </Muestra>
            <Muestra etiqueta="Sobre azul (foco blanco con anillo doble)" oscuro>
              <Boton variante="claro">Entrar</Boton>
              <Boton variante="fantasma-claro">Ver historial</Boton>
              <Boton variante="fantasma-claro" tamano="icono" aria-label="Notificaciones">
                <Bell aria-hidden className="size-5" />
              </Boton>
            </Muestra>
          </Bloque>

          <Bloque id="estado" titulo="Estado e insignias" descripcion="EstadoChip es EL semáforo: dos colores, dos íconos (triángulo / círculo con check) y una palabra.">
            <Muestra etiqueta="EstadoChip · sm / md / lg">
              <EstadoChip color="amarillo" texto="Pendiente" tamano="sm" />
              <EstadoChip color="amarillo" texto="Pendiente" />
              <EstadoChip color="amarillo" texto="Pendiente" tamano="lg" />
              <EstadoChip color="verde" texto="Completa" tamano="sm" />
              <EstadoChip color="verde" texto="Clasificada" />
              <EstadoChip color="verde" texto="Clasificada" tamano="lg" pulso />
              <EstadoChip color="amarillo" texto={textoFaltan(3, 8)} />
            </Muestra>
            <Muestra etiqueta="Insignias, contador, teclas">
              <Insignia>Insumo</Insignia>
              <Insignia variante="azul">Administrador</Insignia>
              <Insignia variante="contorno">Agencia de aduana</Insignia>
              <Insignia variante="oscura">Nuevo</Insignia>
              <Insignia variante="error">Correo inválido</Insignia>
              <span className="inline-flex items-center gap-2 text-sm font-semibold">
                Avisos <Contador valor={3} etiquetaAria="3 avisos sin leer" />
              </span>
              <span className="inline-flex items-center gap-1 text-sm">
                Buscar: <Tecla>Ctrl</Tecla> + <Tecla>K</Tecla>
              </span>
            </Muestra>
            <Muestra etiqueta="Avatar y persona (con organización)">
              <Avatar nombre="Edward Insumos" />
              <Avatar nombre="Brian Aduana" tamano="lg" />
              <Persona nombre="Brian Aduana" organizacion="Magnum" esExterno detalle="Aduana" />
              <Persona nombre="Charles Mantenimiento" organizacion="Mantenimiento" />
            </Muestra>
            <Muestra etiqueta="Barra de progreso (azul a propósito: el verde significa «clasificada»)">
              <div className="w-full max-w-md">
                <BarraProgreso completados={9} total={17} />
              </div>
            </Muestra>
          </Bloque>

          <Bloque id="formulario" titulo="Formulario" descripcion="Una columna. Etiqueta arriba, ayuda con ejemplo real, opcionales marcados, error debajo con salida.">
            <Tarjeta>
              <TarjetaCuerpo className="mx-auto max-w-[45rem] space-y-5">
                <CampoFormulario etiqueta="Descripción según factura" ayuda="Escríbela tal cual aparece en la factura. Ej.: «Limpiador alcalino NSR».">
                  {(p) => <Campo {...p} defaultValue="Limpiador alcalino (ejemplo)" />}
                </CampoFormulario>
                <CampoFormulario etiqueta="Uso" ayuda="¿Para qué se usa? Ej.: «Limpiar lentes antes del recubrimiento».">
                  {(p) => <AreaTexto {...p} rows={3} />}
                </CampoFormulario>
                <CampoFormulario etiqueta="Tipo de producto">
                  {(p) => (
                    <Seleccion {...p} defaultValue="insumo">
                      <option value="insumo">Insumo</option>
                      <option value="repuesto">Repuesto</option>
                      <option value="equipo">Equipo / Máquina</option>
                      <option value="accesorio">Accesorio</option>
                    </Seleccion>
                  )}
                </CampoFormulario>
                <CampoFormulario etiqueta="País de origen" ayuda="Escribe para buscar: «col», «fran»…">
                  {(p) => <Combobox {...p} nombre="pais" opciones={paises.map((x) => ({ valor: x.codigo, etiqueta: x.nombre, detalle: x.codigo }))} valor={pais} onCambio={setPais} />}
                </CampoFormulario>
                <div className="grid gap-5 sm:grid-cols-2">
                  <CampoFormulario etiqueta="Valor unitario" ayuda="Ej.: 137,74" opcional>
                    {(p) => <Campo {...p} inputMode="decimal" />}
                  </CampoFormulario>
                  <CampoFormulario etiqueta="Partida arancelaria" ayuda="Diez dígitos. Ej.: 8466.92.00.00" error="La partida lleva 10 dígitos. Ejemplo: 8466.92.00.00">
                    {(p) => <Campo {...p} defaultValue="8466.92" className="font-mono" />}
                  </CampoFormulario>
                </div>
                <CampoFormulario etiqueta="Campo bloqueado por rol">
                  {(p) => <Campo {...p} value="Lo completa la aduana" readOnly disabled />}
                </CampoFormulario>
                <GrupoRadios
                  leyenda="¿Con qué frecuencia quieres los avisos?"
                  nombre="frecuencia"
                  valorInicial="inmediato"
                  opciones={[
                    { valor: 'inmediato', etiqueta: 'Un correo por cada aviso' },
                    { valor: 'resumen', etiqueta: 'Un resumen diario', descripcion: 'Llega a las 8 a. m.' },
                    { valor: 'plataforma', etiqueta: 'Solo en la plataforma' },
                  ]}
                />
                <div>
                  <Casilla etiqueta="Incluir referencias archivadas" />
                  <Casilla etiqueta="Solo las que esperan por mí" defaultChecked />
                  <Interruptor etiqueta="Atajo «/» para buscar" descripcion="Se desactiva si interfiere con tu lector de pantalla." defaultChecked />
                </div>
              </TarjetaCuerpo>
            </Tarjeta>
          </Bloque>

          <Bloque id="ficha" titulo="Sección de la ficha con semáforo" descripcion="Número, título, sello y contador. El encabezado pliega y despliega; en móvil las completas pueden abrir plegadas.">
            <div className="mx-auto max-w-[45rem] space-y-4">
              <SeccionFicha id="demo-producto" numero={1} titulo="Producto" color="verde" estadoTexto="Completa" resumen="7 de 7 campos" defaultAbierta={false}>
                <p className="text-tinta-suave">Contenido de la sección Producto.</p>
              </SeccionFicha>
              <SeccionFicha id="demo-detalle" numero={2} titulo="Detalle" color="amarillo" estadoTexto={textoFaltan(3, 8)} resumen="5 de 8 campos" abierta={abiertaB} onAlternar={setAbiertaB}>
                <div className="space-y-4">
                  <CampoFormulario etiqueta="Marca">{(p) => <Campo {...p} />}</CampoFormulario>
                  <CampoFormulario etiqueta="Fabricante" acciones={<button type="button" className="text-sm font-semibold text-azul-500 underline">Igual que la marca</button>}>
                    {(p) => <Campo {...p} />}
                  </CampoFormulario>
                </div>
              </SeccionFicha>
            </div>
          </Bloque>

          <Bloque id="avisos" titulo="Avisos" descripcion="En línea: info, éxito, aviso, error. Efímeros (toast): éxito e info se van solos; los errores se quedan y ofrecen salida.">
            <div className="grid gap-3 md:grid-cols-2">
              <Aviso tipo="info" titulo="Le llegará un aviso">Con el enlace directo a esta referencia. No necesitas escribir un correo.</Aviso>
              <Aviso tipo="exito">Enviamos el aviso a Brian.</Aviso>
              <Aviso tipo="aviso" titulo="Las descripciones mínimas están vacías">Puedes cerrar de todos modos, pero queda registrado.</Aviso>
              <Aviso tipo="error" titulo="No pudimos enviar el aviso" accion={<Boton tamano="sm" variante="secundario">Reintentar</Boton>}>
                La referencia sigue guardada.
              </Aviso>
            </div>
            <Muestra etiqueta="Toasts">
              <Boton variante="secundario" onClick={() => avisar({ tipo: 'exito', titulo: 'Enviamos el aviso a Brian' })}>
                Éxito
              </Boton>
              <Boton variante="secundario" onClick={() => avisar({ tipo: 'info', titulo: 'Guardado hace unos segundos', descripcion: 'Todo queda en el historial.' })}>
                Info
              </Boton>
              <Boton
                variante="secundario"
                onClick={() => avisar({ tipo: 'error', titulo: 'No pudimos enviar el aviso', descripcion: 'La referencia sigue guardada.', accion: { etiqueta: 'Reintentar', onClick: () => avisar({ tipo: 'exito', titulo: 'Listo, reintentamos' }) } })}
              >
                Error (no se va solo)
              </Boton>
            </Muestra>
          </Bloque>

          <Bloque id="capas" titulo="Diálogo, cajón, popover, menú y tooltip" descripcion="Todos sobre elementos nativos (dialog / popover): foco atrapado o devuelto, Esc, capa superior sin z-index.">
            <Muestra>
              <Boton variante="secundario" onClick={() => setDialogo(true)}>
                Abrir diálogo
              </Boton>
              <Boton variante="secundario" onClick={() => setConfirmar(true)}>
                Confirmar con motivo
              </Boton>
              <Boton variante="secundario" onClick={() => setCajon(true)}>
                Abrir cajón
              </Boton>
              <Popover
                etiqueta="Ejemplo de popover"
                disparador={(p) => (
                  <Boton variante="secundario" {...p}>
                    Popover
                  </Boton>
                )}
                className="w-72 p-4"
              >
                {({ cerrar }) => (
                  <div className="space-y-3">
                    <p className="font-semibold">Contenido libre</p>
                    <p className="text-sm text-tinta-suave">Cierra con Esc, al pulsar fuera o con el botón.</p>
                    <Boton tamano="sm" onClick={cerrar}>
                      Entendido
                    </Boton>
                  </div>
                )}
              </Popover>
              <MenuDesplegable
                etiqueta="Descargar Excel"
                disparador={(p) => (
                  <Boton variante="secundario" {...p}>
                    <Download aria-hidden className="size-4" />
                    Descargar Excel
                  </Boton>
                )}
              >
                <ItemMenu onClick={() => avisar({ tipo: 'info', titulo: 'Lo que veo (25 filas)' })}>Lo que veo (25 filas)</ItemMenu>
                <ItemMenu onClick={() => avisar({ tipo: 'info', titulo: 'Toda la base' })}>Toda la base</ItemMenu>
                <SeparadorMenu />
                <ItemMenu href="/dev/ui#capas">Ir a esta sección</ItemMenu>
              </MenuDesplegable>
              <Tooltip contenido="Enviar a otra persona">
                <Boton tamano="icono" variante="secundario" aria-label="Enviar a otra persona">
                  <Send aria-hidden className="size-5" />
                </Boton>
              </Tooltip>
            </Muestra>

            <Dialogo
              abierto={dialogo}
              onCerrar={() => setDialogo(false)}
              titulo="Enviar TEST-0001 a…"
              descripcion="Le llegará un aviso con el enlace directo a esta referencia. No necesitas escribir un correo."
              pie={
                <>
                  <Boton variante="secundario" onClick={() => setDialogo(false)}>
                    Cancelar
                  </Boton>
                  <Boton
                    onClick={() => {
                      setDialogo(false);
                      avisar({ tipo: 'exito', titulo: 'Enviamos el aviso a Brian' });
                    }}
                  >
                    Enviar a Brian
                  </Boton>
                </>
              }
            >
              <CampoFormulario etiqueta="¿A quién?" ayuda="Escribe un nombre.">
                {(p) => <Campo {...p} data-autofocus="" />}
              </CampoFormulario>
              <div className="mt-4">
                <CampoFormulario etiqueta="Mensaje" opcional>
                  {(p) => <AreaTexto {...p} rows={3} />}
                </CampoFormulario>
              </div>
            </Dialogo>

            <DialogoConfirmacion
              abierto={confirmar}
              onCerrar={() => setConfirmar(false)}
              titulo="Reabrir la clasificación"
              descripcion="Vas a reabrir la clasificación de TEST-0002. La partida actual queda en el historial."
              confirmar="Reabrir"
              cancelar="Todavía no"
              pedirMotivo
              etiquetaMotivo="Motivo"
              ayudaMotivo="Cuéntale al administrador por qué hay que reabrirla."
              onConfirmar={async () => {
                await new Promise((r) => setTimeout(r, 700));
                avisar({ tipo: 'exito', titulo: 'Clasificación reabierta' });
              }}
            />

            <Cajon abierto={cajon} onCerrar={() => setCajon(false)} titulo="Historial" descripcion="Nada se borra: cada cambio queda aquí.">
              <ol className="space-y-4">
                {['Edward llenó «Uso»', 'Brian propuso cambiar «Marca»', 'Samuel creó la referencia'].map((t, i) => (
                  <li key={t} className="rounded-lg border border-borde-suave p-3 text-sm">
                    <p className="font-semibold">{t}</p>
                    <p className="text-tinta-suave">Hace {i + 1} h</p>
                  </li>
                ))}
              </ol>
            </Cajon>
          </Bloque>

          <Bloque id="navegacion" titulo="Pestañas y migas" descripcion="Pestañas con flechas, Inicio y Fin. Migas: en móvil se reducen a «‹ Referencias».">
            <Migas items={[{ etiqueta: 'Referencias', href: '/referencias' }, { etiqueta: 'TEST-0001' }]} />
            <Pestanas
              etiqueta="Mis referencias"
              items={[
                { id: 'mias', etiqueta: 'Para mí', contador: 4, contenido: <p className="text-tinta-suave">Aquí van las 4 referencias que te enviaron.</p> },
                { id: 'otros', etiqueta: 'Esperando a otros', contador: 7, contenido: <p className="text-tinta-suave">Las 7 que enviaste y siguen pendientes.</p> },
                { id: 'recientes', etiqueta: 'Recientes', contenido: <p className="text-tinta-suave">Lo último que tocaste.</p> },
              ]}
            />
            <Tarjeta>
              <TarjetaCabecera titulo="Encabezado de tarjeta" descripcion="Con acciones a la derecha" acciones={<Boton tamano="sm" variante="secundario">Acción</Boton>} />
              <TarjetaCuerpo>
                <EncabezadoPagina titulo="Referencias" descripcion="Lo que puedes ver, de más antigua a más reciente." acciones={<Boton>Nueva referencia</Boton>} className="mb-0" />
              </TarjetaCuerpo>
            </Tarjeta>
          </Bloque>

          <Bloque id="tabla" titulo="Tabla que se vuelve tarjetas" descripcion="Desde 600 px es tabla con columnas fijas; debajo, tarjetas. Toda la fila es clicable con un solo enlace.">
            <TablaDatos<FilaDemo>
              etiqueta="Referencias de ejemplo"
              filas={FILAS}
              clave={(f) => f.id}
              hrefFila={(f) => `/dev/ui#tabla-${f.id}`}
              etiquetaEnlace={(f) => `Abrir ${f.codigo}`}
              columnas={[
                { id: 'estado', encabezado: 'Estado', celda: (f) => <EstadoChip color={f.estado} texto={f.estado === 'verde' ? 'Clasificada' : 'Pendiente'} tamano="sm" sinRol /> },
                { id: 'codigo', encabezado: 'Referencia', principal: true, celda: (f) => <span className="font-mono text-sm">{f.codigo}</span>, etiquetaTarjeta: 'Referencia' },
                { id: 'nombre', encabezado: 'Nombre', celda: (f) => f.nombre },
                { id: 'tipo', encabezado: 'Tipo', celda: (f) => f.tipo, ocultarBajo: 'md' },
                { id: 'partida', encabezado: 'Partida', celda: (f) => <span className="font-mono text-sm">{f.partida}</span>, ocultarBajo: 'lg' },
                { id: 'dias', encabezado: 'Días', alinear: 'der', celda: (f) => f.dias },
                { id: 'espera', encabezado: 'En espera de', celda: (f) => f.espera, ocultarBajo: 'md' },
              ]}
            />
            <Paginacion resumen="Mostrando 1–3 de 3" anterior={null} siguiente={{ href: '/dev/ui#tabla' }} />
          </Bloque>

          <Bloque id="carga" titulo="Carga, vacíos y pantallas de estado" descripcion="Esqueleto con la altura final (sin saltos); vacíos que enseñan; pantallas de error con salida.">
            <EsqueletoFilas />
            <div className="flex gap-3">
              <Esqueleto className="h-10 w-40" />
              <Esqueleto className="h-10 w-24" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <EstadoVacio
                icono={FileStack}
                titulo="Estás al día"
                descripcion="No tienes referencias pendientes."
                accion={
                  <>
                    <Boton>Nueva referencia</Boton>
                    <Boton variante="secundario">Buscar una referencia</Boton>
                  </>
                }
              />
              <EstadoVacio icono={SearchX} titulo="No encontramos «NSR X9»" descripcion="Revisa cómo la escribiste o prueba con una parte." accion={<Boton variante="secundario">Limpiar filtros</Boton>} />
            </div>
            <PantallaEstado compacto titulo="Algo salió mal" acciones={<Boton>Reintentar</Boton>}>
              <p>Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.</p>
            </PantallaEstado>
          </Bloque>
        </main>
      </div>
    </div>
  );
}
