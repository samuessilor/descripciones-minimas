'use client';

/**
 * Piezas visuales y de logica compartidas por los bloques de la zona de la aduana.
 * Todo usa el vocabulario de `docs/UI-GUIA.md`: azul para estructura y acciones, amarillo/verde solo para el estado.
 */
import { Check, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Boton } from '@/componentes/ui/button';
import { CampoFormulario, TextoError } from '@/componentes/ui/campo-formulario';
import { Campo } from '@/componentes/ui/input';
import type { Resultado } from '@/server/acciones/resultado';
import type { CampoAduanaVista } from '@/server/politicas/aduana';
import { nombreVisible } from '@/componentes/ui/avatar';
import { cn } from '@/lib/utils';

export function fechaCorta(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}

export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' }).format(new Date(iso));
}

export const sinTexto = (v: unknown): string => (typeof v === 'string' ? v : '');

/** El valor vigente es la marca «No aplica» (cuenta como diligenciado). */
export const esNoAplica = (v: unknown): boolean => typeof v === 'object' && v !== null && (v as { no_aplica?: unknown }).no_aplica === true;

/** Hay valor: texto o «No aplica». */
export const diligenciado = (v: unknown): boolean => esNoAplica(v) || sinTexto(v).trim() !== '';

/** Mensaje de un resultado fallido, listo para mostrar. */
export function mensajeDe<T>(r: Resultado<T>, porDefecto = 'Algo salió mal de nuestro lado. Intenta de nuevo; si sigue, avisa al administrador.'): string {
  return r.ok ? '' : r.mensaje || porDefecto;
}

// ---- Encabezado de cada bloque de la zona --------------------------------------------------------------

/**
 * Cabecera de un paso de la zona: icono en circulo (azul; con check cuando el paso esta hecho), titulo, una linea
 * de ayuda y, a la derecha, una acción o contador. El check es AZUL: el verde es solo de la referencia clasificada.
 */
export function EncabezadoPaso({
  icono: Icono,
  titulo,
  ayuda,
  hecho = false,
  derecha,
  id,
}: {
  icono: LucideIcon;
  titulo: string;
  ayuda?: ReactNode;
  hecho?: boolean;
  derecha?: ReactNode;
  id: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5">
      <span
        aria-hidden
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
          hecho ? 'border-azul-700 bg-azul-700 text-white' : 'border-azul-300 bg-azul-50 text-azul-700',
        )}
      >
        {hecho ? <Check className="size-5" strokeWidth={2.75} /> : <Icono className="size-5" strokeWidth={1.9} />}
      </span>
      <div className="min-w-[11rem] flex-1">
        <h3 id={id} className="font-display text-lg font-extrabold leading-tight tracking-tight text-tinta">
          {titulo}
          {hecho ? <span className="sr-solo"> (listo)</span> : null}
        </h3>
        {ayuda ? <p className="mt-0.5 text-sm text-tinta-suave">{ayuda}</p> : null}
      </div>
      {derecha ? <div className="shrink-0 max-sm:basis-full max-sm:pl-[3.375rem]">{derecha}</div> : null}
    </div>
  );
}

/** Autor y fecha bajo un valor: «Brian · 20 oct, 10:12» (texto, no color). */
export function Autoria({ campo, className }: { campo: Pick<CampoAduanaVista, 'autor' | 'instante' | 'propio'> | null; className?: string }) {
  if (!campo) return null;
  return (
    <p className={cn('text-sm text-tinta-suave', className)}>
      {campo.propio ? 'Tú' : nombreVisible(campo.autor)} · {fechaCorta(campo.instante)}
    </p>
  );
}

export function IndicadorGuardado({ estado, className }: { estado: EstadoGuardado; className?: string }) {
  if (estado === 'guardando') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-1.5 text-sm text-tinta-suave', className)}>
        <LoaderCircle aria-hidden className="size-3.5 animate-girar" /> Guardando…
      </span>
    );
  }
  if (estado === 'guardado') {
    return (
      <span role="status" className={cn('inline-flex items-center gap-1.5 text-sm font-medium text-azul-700', className)}>
        <Check aria-hidden className="size-3.5" strokeWidth={2.75} /> Guardado
      </span>
    );
  }
  return null;
}

// ---- Edicion de un campo con historial, motivo y conflicto ---------------------------------------------

export type EstadoGuardado = 'quieto' | 'guardando' | 'guardado' | 'error' | 'motivo' | 'conflicto';

interface DetalleConflicto {
  vigente: { valor: unknown; version: number; autor: string; instante: string };
}

export interface OpcionesGuardable {
  /** Valor vigente del campo (autor, version); `null` si nadie lo ha escrito. */
  campo: CampoAduanaVista | null;
  /** Texto con que se muestra el valor vigente. */
  textoVigente: string;
  /** Texto digitado -> valor a enviar (`null` = vaciar). */
  aEntrada: (texto: string) => unknown;
  guardar: (p: { valor: unknown; versionEsperada: number; motivo?: string }) => Promise<Resultado<unknown>>;
  /** Resuelve un choque: `dejar` conserva lo ajeno, `usar_mio`/`combinar` guardan lo propio con motivo. */
  resolver: (p: { opcion: 'dejar' | 'usar_mio' | 'combinar'; valor: unknown; motivo?: string; versionVigente: number }) => Promise<Resultado<unknown>>;
  alGuardar: () => void;
  /** Texto con que se muestra lo que otra persona guardo en un conflicto. */
  textoDe?: (valor: unknown) => string;
}

/**
 * Maquina de un campo editable (SPEC 9, 10.2): guarda al salir del campo; si el valor vigente es de OTRA persona
 * pide el motivo en linea («Este valor lo puso Brian. Cuéntale por qué lo cambias») y avisa; si alguien guardo
 * mientras tanto, ofrece dejar lo suyo, usar lo mio (con motivo) o combinar. Nunca pierde el texto digitado.
 */
export function useCampoGuardable(o: OpcionesGuardable) {
  const [texto, setTexto] = useState(o.textoVigente);
  const [version, setVersion] = useState(o.campo?.version ?? 0);
  const [estado, setEstado] = useState<EstadoGuardado>('quieto');
  const [mensaje, setMensaje] = useState('');
  const [motivo, setMotivo] = useState('');
  const [conflicto, setConflicto] = useState<DetalleConflicto['vigente'] | null>(null);
  const sucio = useRef(false);
  // Un valor que no sale del texto (la casilla «No aplica»): se envia en lugar del texto hasta que se guarde o se cancele.
  const valorFijo = useRef<{ v: unknown } | null>(null);
  const textoRef = useRef(texto);
  const versionRef = useRef(version);
  useEffect(() => {
    textoRef.current = texto;
    versionRef.current = version;
  });
  const oRef = useRef(o);
  useEffect(() => {
    oRef.current = o;
  });

  // Si el valor vigente cambia desde fuera (otra persona, otra pestana) y no estoy editando, lo sigo.
  const vigenteVersion = o.campo?.version ?? 0;
  useEffect(() => {
    if (!sucio.current && estado !== 'conflicto') {
      setTexto(o.textoVigente);
      setVersion(vigenteVersion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vigenteVersion, o.textoVigente]);

  useEffect(() => {
    if (estado !== 'guardado') return;
    const t = setTimeout(() => setEstado((e) => (e === 'guardado' ? 'quieto' : e)), 2500);
    return () => clearTimeout(t);
  }, [estado]);

  const ajeno = !!o.campo && !o.campo.propio && o.textoVigente.trim() !== '';

  const terminar = useCallback((versionNueva?: number) => {
    sucio.current = false;
    valorFijo.current = null;
    setMotivo('');
    setConflicto(null);
    setMensaje('');
    setEstado('guardado');
    if (versionNueva !== undefined) setVersion(versionNueva);
    oRef.current.alGuardar();
  }, []);

  const enviar = useCallback(
    async (motivoUsado?: string) => {
      const cfg = oRef.current;
      setEstado('guardando');
      const valor = valorFijo.current ? valorFijo.current.v : cfg.aEntrada(textoRef.current);
      const r = await cfg.guardar({ valor, versionEsperada: versionRef.current, ...(motivoUsado ? { motivo: motivoUsado } : {}) });
      if (r.ok) {
        const v = (r.data as { version?: number } | null)?.version;
        terminar(v);
        return;
      }
      if (r.codigo === 'CONFLICTO') {
        setConflicto((r.detalle as DetalleConflicto).vigente);
        setMensaje(r.mensaje);
        setEstado('conflicto');
      } else if (r.codigo === 'FALTA_MOTIVO') {
        setMensaje(r.mensaje);
        setEstado('motivo');
      } else {
        setMensaje(r.mensaje);
        setEstado('error');
      }
    },
    [terminar],
  );

  /** Al salir del campo: guarda si cambio. */
  const alSalir = useCallback(() => {
    const cfg = oRef.current;
    if (textoRef.current.trim() === cfg.textoVigente.trim()) {
      sucio.current = false;
      if (estado !== 'conflicto' && estado !== 'motivo') setEstado('quieto');
      return;
    }
    if (estado === 'conflicto') return;
    const necesitaMotivo = !!cfg.campo && !cfg.campo.propio && cfg.textoVigente.trim() !== '';
    if (necesitaMotivo && motivo.trim() === '') {
      setEstado('motivo');
      setMensaje('');
      return;
    }
    void enviar(motivo.trim() || undefined);
  }, [enviar, estado, motivo]);

  const cambiar = useCallback((nuevo: string) => {
    sucio.current = true;
    valorFijo.current = null;
    setTexto(nuevo);
    setEstado((e) => (e === 'guardado' || e === 'error' ? 'quieto' : e));
  }, []);

  const cancelar = useCallback(() => {
    sucio.current = false;
    valorFijo.current = null;
    setTexto(oRef.current.textoVigente);
    setMotivo('');
    setMensaje('');
    setConflicto(null);
    setEstado('quieto');
  }, []);

  const confirmarMotivo = useCallback(() => {
    void enviar(motivo.trim());
  }, [enviar, motivo]);

  const resolver = useCallback(
    async (opcion: 'dejar' | 'usar_mio' | 'combinar') => {
      const cfg = oRef.current;
      if (!conflicto) return;
      setEstado('guardando');
      const r = await cfg.resolver({
        opcion,
        valor: cfg.aEntrada(textoRef.current) ?? '',
        versionVigente: conflicto.version,
        ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
      });
      if (r.ok) {
        if (opcion === 'dejar') {
          sucio.current = false;
          setTexto(cfg.textoDe ? cfg.textoDe(conflicto.valor) : sinTexto(conflicto.valor));
          setVersion(conflicto.version);
          setConflicto(null);
          setMotivo('');
          setEstado('quieto');
          cfg.alGuardar();
        } else {
          terminar((r.data as { version?: number } | null)?.version);
        }
        return;
      }
      setMensaje(r.mensaje);
      setEstado(r.codigo === 'FALTA_MOTIVO' ? 'conflicto' : 'error');
    },
    [conflicto, motivo, terminar],
  );

  const combinar = useCallback(() => {
    if (!conflicto) return;
    const suyo = o.textoDe ? o.textoDe(conflicto.valor) : sinTexto(conflicto.valor);
    sucio.current = true;
    setTexto((t) => `${suyo}\n${t}`.trim());
    setVersion(conflicto.version);
    setConflicto(null);
    setMensaje('');
    setEstado('quieto');
  }, [conflicto, o]);

  /** Guarda ya un valor que no sale del texto (marcar o desmarcar «No aplica»); pide motivo si el servidor lo exige. */
  const fijar = useCallback(
    (valor: unknown) => {
      valorFijo.current = { v: valor };
      setTexto('');
      void enviar(motivo.trim() || undefined);
    },
    [enviar, motivo],
  );

  return { texto, cambiar, estado, mensaje, motivo, setMotivo, conflicto, alSalir, cancelar, confirmarMotivo, resolver, combinar, ajeno, enviar, fijar, version };
}

// ---- Franja de motivo / conflicto (en linea, sin ventana flotante) ----------------------------------------

export function FranjaMotivo({
  autor: autorCrudo,
  motivo,
  onMotivo,
  onConfirmar,
  onCancelar,
  mensaje,
  cargando,
}: {
  autor: string;
  motivo: string;
  onMotivo: (v: string) => void;
  onConfirmar: () => void;
  onCancelar: () => void;
  mensaje?: string;
  cargando?: boolean;
}) {
  const autor = nombreVisible(autorCrudo);
  return (
    <div className="space-y-3 rounded-lg border border-azul-300 bg-azul-50 p-3.5" data-franja="motivo">
      <CampoFormulario
        etiqueta={`Este valor lo puso ${autor}`}
        ayuda={`Cuéntale por qué lo cambias; ${autor === 'Alguien' ? 'esa persona' : autor} recibirá un aviso.`}
        error={mensaje}
      >
        {(p) => <Campo {...p} value={motivo} onChange={(e) => onMotivo(e.target.value)} maxLength={1000} data-autofocus />}
      </CampoFormulario>
      <div className="flex flex-wrap gap-2">
        <Boton tamano="sm" onClick={onConfirmar} disabled={motivo.trim() === ''} cargando={cargando}>
          Guardar cambio
        </Boton>
        <Boton tamano="sm" variante="terciario" onClick={onCancelar} disabled={cargando}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}

export function FranjaConflicto({
  autor: autorCrudo,
  vigente,
  esTexto,
  motivo,
  onMotivo,
  onResolver,
  onCombinar,
  mensaje,
  cargando,
}: {
  autor: string;
  vigente: string;
  esTexto: boolean;
  motivo: string;
  onMotivo: (v: string) => void;
  onResolver: (o: 'dejar' | 'usar_mio') => void;
  onCombinar: () => void;
  mensaje?: string;
  cargando?: boolean;
}) {
  const autor = nombreVisible(autorCrudo);
  return (
    <div className="space-y-3 rounded-lg border border-borde-fuerte bg-superficie-2 p-3.5" role="group" aria-label="Alguien guardó antes que tú" data-franja="conflicto">
      <p className="text-sm font-semibold text-tinta">
        {autor} ya guardó este campo. Tu texto no se perdió: puedes dejar el suyo, usar el tuyo o combinarlos.
      </p>
      <blockquote className="whitespace-pre-wrap rounded-md border border-borde-suave bg-superficie px-3 py-2 text-sm text-tinta">{vigente || '(vacío)'}</blockquote>
      <CampoFormulario etiqueta="Motivo (para usar el tuyo)" ayuda={`${autor} recibirá un aviso.`} error={mensaje}>
        {(p) => <Campo {...p} value={motivo} onChange={(e) => onMotivo(e.target.value)} maxLength={1000} />}
      </CampoFormulario>
      <div className="flex flex-wrap gap-2">
        <Boton tamano="sm" onClick={() => onResolver('usar_mio')} disabled={motivo.trim() === ''} cargando={cargando}>
          Usar el mío
        </Boton>
        <Boton tamano="sm" variante="secundario" onClick={() => onResolver('dejar')} disabled={cargando}>
          Dejar el suyo
        </Boton>
        {esTexto ? (
          <Boton tamano="sm" variante="secundario" onClick={onCombinar} disabled={cargando}>
            Combinar
          </Boton>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorEnLinea({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  return (
    <div className="space-y-1.5">
      <TextoError>{mensaje}</TextoError>
      {onReintentar ? (
        <Boton tamano="sm" variante="secundario" onClick={onReintentar}>
          Reintentar
        </Boton>
      ) : null}
    </div>
  );
}

