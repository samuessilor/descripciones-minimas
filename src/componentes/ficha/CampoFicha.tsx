'use client';

import { CircleAlert, Lock, LoaderCircle, Check, Pencil } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { presente } from '@/componentes/colaboracion/presencia';
import { LATIDO_EDICION_MS, LATIDO_PRIMERO_MS } from '@/componentes/colaboracion/sondeo';
import { nombreVisible } from '@/componentes/ui/avatar';
import { Boton } from '@/componentes/ui/button';
import { Combobox } from '@/componentes/ui/combobox';
import { DialogoConfirmacion } from '@/componentes/ui/dialogo';
import { AreaTexto, Campo, Seleccion } from '@/componentes/ui/input';
import { Etiqueta } from '@/componentes/ui/etiqueta';
import { HistorialCampo } from '@/componentes/slots/HistorialCampo';
import { AREAS, esArea } from '@/dominio/areas';
import { parsearCantidad, parsearValorUnitario } from '@/dominio/cantidad';
import { ETIQUETA_TIPO, TIPOS_PRODUCTO, ayudaPara, type CampoDef, type TipoProducto } from '@/dominio/campos';
import { PAIS_NO_SE_CONOCE, nombrePais, type Pais } from '@/dominio/paises';
import { formatearPartida } from '@/dominio/partida';
import type { CampoVista } from '@/server/politicas/referencias';
import { cn } from '@/lib/utils';
import { enviarLatido, guardarCampoApi, resolverConflictoApi, terminarLatido } from './api-cliente';
import type { GuardadoCampo } from './guardado-local';
import { EntradaComposicion } from './EntradaComposicion';
import {
  BORRADOR_VACIO,
  borradorAEntrada,
  borradoresIguales,
  combinarTextos,
  fechaCorta,
  mostrarValor,
  valorABorrador,
  type Borrador,
} from './formato';

export interface OpcionesCatalogo {
  unidad_medida: string[];
  aspecto_fisico: string[];
}

export type FaseCampo = 'limpio' | 'sin_guardar' | 'guardando' | 'guardado' | 'error' | 'falta_motivo' | 'conflicto';

/** Fases en las que hay texto de la persona que NO esta guardado todavia (nunca se debe perder). */
export const FASES_PENDIENTES: readonly FaseCampo[] = ['sin_guardar', 'guardando', 'error', 'falta_motivo', 'conflicto'];

interface Vigente {
  valor: unknown;
  version: number;
  autor: string;
  instante: string;
  propio: boolean;
}

export interface PropsCampo {
  referenciaId: string;
  def: CampoDef;
  tipo: TipoProducto;
  vista: CampoVista | undefined;
  /** El actor puede escribir este campo en esta ficha. */
  puedeEditar: boolean;
  /** Por que es de solo lectura (se muestra con candado). */
  razonSoloLectura: string | null;
  catalogos: OpcionesCatalogo;
  paises: readonly Pais[];
  /** Otra persona lo esta escribiendo ahora (presencia). */
  editandoPor: string | null;
  /** Valores vigentes de toda la ficha (para «Igual que la marca» y «El proveedor es el mismo fabricante»). */
  valores: Record<string, unknown>;
  /** Campos con valor que dejarian de mostrarse si el tipo cambiara a otro (solo `tipo_producto`). */
  ocultosAlCambiarTipo?: (nuevo: TipoProducto) => string[];
  alCambiarFase: (clave: string, fase: FaseCampo, etiqueta: string) => void;
  /**
   * Se guardo algo: la ficha actualiza semaforo y progreso. Recibe lo que respondio el servidor para aplicarlo sin
   * releer; sin el (un choque que resulto ser el mismo texto, una ficha ya cerrada) la ficha se relee.
   */
  alGuardar: (guardado?: GuardadoCampo) => void;
}

const LATIDO_MS = LATIDO_EDICION_MS;
const ESPERAS_REINTENTO = [3_000, 6_000, 12_000, 20_000, 30_000];

const claveBorrador = (referenciaId: string, campo: string) => `dm-borrador:${referenciaId}:${campo}`;

function leerBorrador(referenciaId: string, campo: string): Borrador | null {
  try {
    const t = window.sessionStorage.getItem(claveBorrador(referenciaId, campo));
    // Un borrador guardado antes de que existieran las casillas nuevas se completa con sus valores por defecto.
    return t ? { ...BORRADOR_VACIO, ...(JSON.parse(t) as Partial<Borrador>) } : null;
  } catch {
    return null;
  }
}
function guardarBorradorLocal(referenciaId: string, campo: string, b: Borrador | null): void {
  try {
    if (b) window.sessionStorage.setItem(claveBorrador(referenciaId, campo), JSON.stringify(b));
    else window.sessionStorage.removeItem(claveBorrador(referenciaId, campo));
  } catch {
    /* sin almacenamiento: el texto sigue en pantalla */
  }
}

export function CampoFicha(props: PropsCampo) {
  const {
    referenciaId,
    def,
    tipo,
    vista,
    puedeEditar,
    razonSoloLectura,
    catalogos,
    paises,
    editandoPor,
    valores,
    ocultosAlCambiarTipo,
    alCambiarFase,
    alGuardar,
  } = props;

  const generado = useId().replace(/:/g, '');
  const id = `campo-${def.clave}`;
  const idEstado = `${id}-estado-${generado}`;

  const [vigente, setVigente] = useState<Vigente>({
    valor: vista?.valor ?? null,
    version: vista?.version ?? 0,
    autor: vista?.autor ?? '',
    instante: vista?.instante ?? '',
    propio: vista?.propio ?? true,
  });
  const [borrador, setBorrador] = useState<Borrador>(valorABorrador(def, vista?.valor ?? null));
  const [fase, setFaseInterna] = useState<FaseCampo>('limpio');
  const [mensaje, setMensaje] = useState('');
  const [motivo, setMotivo] = useState('');
  const [conflicto, setConflicto] = useState<{ valor: unknown; version: number; autor: string } | null>(null);
  const [errorConflicto, setErrorConflicto] = useState('');
  const [ambiguo, setAmbiguo] = useState<Array<{ clave: 'decimal' | 'entero'; texto: string }> | null>(null);
  // «Reintentar ahora» solo tiene sentido si el fallo fue de red o del servidor; un valor invalido falla igual.
  const [reintentable, setReintentable] = useState(true);
  const [recuperado, setRecuperado] = useState(false);
  const [confirmarTipo, setConfirmarTipo] = useState<{ nuevo: TipoProducto; ocultos: string[] } | null>(null);

  // Espejo para los temporizadores y eventos del documento (evita cierres con estado viejo).
  const ref = useRef({ vigente, borrador, motivo, fase });
  useEffect(() => {
    ref.current = { vigente, borrador, motivo, fase };
  });
  const tipoConfirmado = useRef(false);
  const guardandoAhora = useRef(false);
  const guardarRef = useRef<((b: Borrador, o?: { desambiguar?: 'decimal' | 'entero' }) => Promise<void>) | null>(null);
  const intentos = useRef(0);
  const temporizadorReintento = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporizadorGuardado = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latido = useRef<ReturnType<typeof setInterval> | null>(null);
  /** El primer latido espera un momento tras el foco: quien solo pasa de largo no avisa a nadie. */
  const primerLatido = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ya se envio algun latido en este foco: solo entonces hace falta avisar que se dejo el campo. */
  const latidoEnviado = useRef(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const zonaEdicion = useRef<HTMLDivElement>(null);

  const setFase = useCallback(
    (f: FaseCampo) => {
      setFaseInterna(f);
      alCambiarFase(def.clave, f, def.etiqueta);
    },
    [alCambiarFase, def.clave, def.etiqueta],
  );

  const sucio = FASES_PENDIENTES.includes(fase);

  // Adopta lo que llega del servidor (sondeo) si la persona no esta editando este campo.
  // Patron de React para estado derivado de props: se ajusta durante el render, sin efecto.
  const [versionVista, setVersionVista] = useState(vista?.version ?? 0);
  if (vista && vista.version !== versionVista) {
    setVersionVista(vista.version);
    if (!sucio && vista.version !== vigente.version) {
      setVigente({ valor: vista.valor, version: vista.version, autor: vista.autor, instante: vista.instante, propio: vista.propio });
      setBorrador(valorABorrador(def, vista.valor));
      setFaseInterna('limpio');
    }
  }

  const hayValor = vigente.version > 0 && vigente.valor !== null;
  const pideMotivo = hayValor && !vigente.propio;

  const guardar = useCallback(
    async (b: Borrador, opciones: { desambiguar?: 'decimal' | 'entero' } = {}) => {
      const act = ref.current;
      if (guardandoAhora.current) return; // un guardado ya va en camino (p. ej. salir del texto y luego del campo)
      if (temporizadorReintento.current) {
        clearTimeout(temporizadorReintento.current);
        temporizadorReintento.current = null;
      }
      const entrada = borradorAEntrada(def, b);
      if (borradoresIguales(b, valorABorrador(def, act.vigente.valor))) {
        setFase('limpio');
        guardarBorradorLocal(referenciaId, def.clave, null);
        return;
      }
      const necesitaMotivo = act.vigente.version > 0 && act.vigente.valor !== null && !act.vigente.propio;
      if (necesitaMotivo && act.motivo.trim() === '') {
        setFase('falta_motivo');
        setMensaje('Escribe el motivo para guardar. La persona que puso este valor recibirá un aviso.');
        return;
      }
      // Numeros: se validan aqui con la misma regla del servidor; un valor invalido no viaja ni bloquea el campo.
      if ((def.tipoDato === 'valor_unitario' || def.tipoDato === 'cantidad') && b.texto.trim() !== '') {
        const n =
          def.tipoDato === 'valor_unitario'
            ? parsearValorUnitario(b.texto, { desambiguar: opciones.desambiguar })
            : parsearCantidad(b.texto, { desambiguar: opciones.desambiguar });
        if (!n.ok) {
          if (n.codigo === 'AMBIGUO' && n.opciones) setAmbiguo(n.opciones);
          setReintentable(false);
          setFase('error');
          setMensaje(n.mensaje);
          return;
        }
      }
      setFase('guardando');
      setMensaje('');
      setReintentable(true);
      const valor = opciones.desambiguar && typeof entrada === 'string' ? { texto: entrada, desambiguar: opciones.desambiguar } : entrada;
      let r;
      guardandoAhora.current = true;
      try {
        r = await guardarCampoApi(referenciaId, {
          campo: def.clave,
          valor,
          versionEsperada: act.vigente.version,
          ...(act.motivo.trim() ? { motivo: act.motivo } : {}),
        });
      } catch {
        // Sin red: el texto sigue en pantalla y se reintenta solo mientras la pestana este abierta (SPEC 10.2).
        setFase('error');
        const espera = ESPERAS_REINTENTO[Math.min(intentos.current, ESPERAS_REINTENTO.length - 1)] ?? 30_000;
        intentos.current += 1;
        setMensaje('No se guardó. No cierres esta página: reintentamos solos.');
        temporizadorReintento.current = setTimeout(() => {
          void guardarRef.current?.(ref.current.borrador, opciones);
        }, espera);
        return;
      } finally {
        guardandoAhora.current = false;
      }
      intentos.current = 0;
      if (r.ok) {
        setVigente({ valor: r.data.valor, version: r.data.version, autor: 'Tú', instante: new Date().toISOString(), propio: true });
        setMotivo('');
        setAmbiguo(null);
        setRecuperado(false);
        setBorrador(valorABorrador(def, r.data.valor));
        setFase('guardado');
        guardarBorradorLocal(referenciaId, def.clave, null);
        if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
        temporizadorGuardado.current = setTimeout(() => setFaseInterna((f) => (f === 'guardado' ? 'limpio' : f)), 4_000);
        alGuardar({ campo: def.clave, ...r.data });
        return;
      }
      if (r.codigo === 'CONFLICTO') {
        const v = (r.detalle as { vigente: { valor: unknown; version: number; autor: string; instante?: string } }).vigente;
        // Un guardado cortado por tiempo pudo llegar al servidor: si lo vigente ya es lo escrito, no es un choque.
        if (borradoresIguales(b, valorABorrador(def, v.valor))) {
          setVigente({ valor: v.valor, version: v.version, autor: 'Tú', instante: v.instante ?? new Date().toISOString(), propio: true });
          setMotivo('');
          setRecuperado(false);
          setFase('guardado');
          guardarBorradorLocal(referenciaId, def.clave, null);
          alGuardar();
          return;
        }
        setConflicto(v);
        setFase('conflicto');
        setMensaje(r.mensaje);
        return;
      }
      if (r.codigo === 'FALTA_MOTIVO') {
        setFase('falta_motivo');
        setMensaje('Escribe el motivo para guardar. La persona que puso este valor recibirá un aviso.');
        return;
      }
      const numero = (r.detalle as { numero?: { codigo?: string; opciones?: Array<{ clave: 'decimal' | 'entero'; texto: string }> } } | undefined)?.numero;
      if (numero?.codigo === 'AMBIGUO' && numero.opciones) {
        setAmbiguo(numero.opciones);
        setFase('error');
        setMensaje(r.mensaje);
        return;
      }
      setFase('error');
      setReintentable(r.codigo !== 'VALIDACION' && r.codigo !== 'FICHA_CERRADA');
      if ((r.detalle as { sesionVencida?: boolean } | undefined)?.sesionVencida) {
        setMensaje('Tu sesión venció. Entra de nuevo en otra pestaña; tu texto sigue aquí y se guardará al volver a esta.');
      } else if (r.codigo === 'LIMITE_TASA') {
        setMensaje('Vas muy rápido. Espera unos segundos y se guarda.');
      } else {
        setMensaje(r.mensaje);
      }
      if (r.codigo === 'FICHA_CERRADA') alGuardar();
    },
    [def, referenciaId, setFase, alGuardar],
  );

  useEffect(() => {
    guardarRef.current = guardar;
  }, [guardar]);

  // Recupera lo que se estaba escribiendo si la pagina se recargo antes de guardar (nunca se pierde el texto).
  useEffect(() => {
    if (!puedeEditar) return;
    // El borrador vive en el navegador (sessionStorage): se lee despues del primer pintado.
    const t = setTimeout(() => {
      const guardado = leerBorrador(referenciaId, def.clave);
      if (!guardado) return;
      if (borradoresIguales(guardado, valorABorrador(def, ref.current.vigente.valor))) {
        guardarBorradorLocal(referenciaId, def.clave, null);
        return;
      }
      setBorrador(guardado);
      setRecuperado(true);
      setFase('sin_guardar');
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  function cambiar(nuevo: Borrador, guardarYa = false) {
    setBorrador(nuevo);
    setFase('sin_guardar');
    setMensaje('');
    setAmbiguo(null);
    guardarBorradorLocal(referenciaId, def.clave, nuevo);
    if (guardarYa) void pedirGuardar(nuevo);
  }

  /** Cambiar el tipo con datos que dejarian de verse pide confirmar (nada se borra, 4.4). */
  function pedirGuardar(b: Borrador) {
    if (def.clave === 'tipo_producto' && ocultosAlCambiarTipo) {
      const nuevo = b.texto as TipoProducto;
      const ocultos = ocultosAlCambiarTipo(nuevo);
      if (ocultos.length > 0) {
        setConfirmarTipo({ nuevo, ocultos });
        return;
      }
    }
    return guardar(b);
  }

  // ---- Presencia (D-17): «estoy escribiendo aqui» mientras el campo tiene el foco (tiempos en sondeo.ts).
  function alEnfocar() {
    if (!puedeEditar || primerLatido.current || latido.current) return;
    primerLatido.current = setTimeout(() => {
      primerLatido.current = null;
      // El foco se fue antes de tiempo (tabulador, clic de paso): no hay nada que avisar.
      if (!contenedor.current?.contains(document.activeElement)) return;
      if (presente()) {
        latidoEnviado.current = true;
        void enviarLatido(referenciaId, def.clave).catch(() => undefined);
      }
      latido.current ??= setInterval(() => {
        // Si el campo ya no tiene el foco (p. ej. se quito del DOM la franja donde estaba), no se sigue avisando.
        if (!contenedor.current?.contains(document.activeElement)) {
          if (latido.current) clearInterval(latido.current);
          latido.current = null;
          if (latidoEnviado.current) void terminarLatido(referenciaId, def.clave).catch(() => undefined);
          latidoEnviado.current = false;
          return;
        }
        // Una ficha desatendida (PC bloqueado con el cursor en el campo) no avisa ni mantiene viva la sesion: el aviso vence solo.
        if (!presente()) return;
        latidoEnviado.current = true;
        void enviarLatido(referenciaId, def.clave).catch(() => undefined);
      }, LATIDO_MS);
    }, LATIDO_PRIMERO_MS);
  }
  function detenerLatido() {
    if (primerLatido.current) clearTimeout(primerLatido.current);
    primerLatido.current = null;
    if (latido.current) clearInterval(latido.current);
    latido.current = null;
  }
  function alDesenfocar(e: React.FocusEvent<HTMLDivElement>) {
    const hacia = e.relatedTarget as Node | null;
    if (zonaEdicion.current?.contains(hacia)) return; // sigue editando este campo (control, motivo, choque)
    const salioDelCampo = !contenedor.current?.contains(hacia);
    const avisoPresencia = latidoEnviado.current;
    if (salioDelCampo) {
      detenerLatido();
      latidoEnviado.current = false;
    }
    if (ref.current.fase === 'sin_guardar') {
      // Guardar ya retira la marca de «escribiendo» (en la misma transaccion): no hace falta otra llamada.
      void pedirGuardar(ref.current.borrador);
    } else if (salioDelCampo && puedeEditar && avisoPresencia) {
      // Solo si algun latido llego a salir: quien paso de largo antes de tiempo no dejo marca que retirar.
      void terminarLatido(referenciaId, def.clave).catch(() => undefined);
    }
  }

  useEffect(() => {
    // Al cambiar de pestana o cerrar, mejor esfuerzo: guarda lo pendiente (SPEC 10.2, D-33).
    const alOcultar = () => {
      if (document.visibilityState === 'hidden' && ref.current.fase === 'sin_guardar') void guardar(ref.current.borrador);
    };
    document.addEventListener('visibilitychange', alOcultar);
    return () => {
      document.removeEventListener('visibilitychange', alOcultar);
      if (primerLatido.current) clearTimeout(primerLatido.current);
      if (latido.current) clearInterval(latido.current);
      if (temporizadorReintento.current) clearTimeout(temporizadorReintento.current);
      if (temporizadorGuardado.current) clearTimeout(temporizadorGuardado.current);
    };
  }, [guardar]);

  /** Controles compuestos (texto + casilla): el texto guarda al salir de el, no hace falta recorrer la casilla. */
  function guardarAlSalirDelTexto() {
    if (ref.current.fase === 'sin_guardar') void pedirGuardar(ref.current.borrador);
  }

  async function resolver(opcion: 'dejar' | 'usar_mio' | 'combinar') {
    if (!conflicto) return;
    if (opcion === 'combinar') {
      const combinado = combinarTextos(def, mostrarValor(def, conflicto.valor), borrador.texto);
      setVigente((v) => ({ ...v, valor: conflicto.valor, version: conflicto.version, autor: conflicto.autor, propio: false }));
      setBorrador({ ...borrador, texto: combinado });
      setConflicto(null);
      setFase('sin_guardar');
      setMensaje('Juntamos los dos textos. Edítalos como quieras y guarda; vas a necesitar un motivo.');
      return;
    }
    setErrorConflicto('');
    const entrada = borradorAEntrada(def, borrador);
    let r;
    try {
      r = await resolverConflictoApi(referenciaId, {
        campo: def.clave,
        opcion,
        valor: entrada,
        ...(motivo.trim() ? { motivo } : {}),
      });
    } catch {
      setErrorConflicto('No pudimos conectar. Tu texto sigue aquí; intenta de nuevo.');
      return;
    }
    if (r.ok && opcion === 'dejar') {
      setVigente((v) => ({ ...v, valor: conflicto.valor, version: conflicto.version, autor: conflicto.autor, propio: false }));
      setBorrador(valorABorrador(def, conflicto.valor));
      setConflicto(null);
      setFase('guardado');
      setMensaje('Tu texto quedó guardado en el historial del campo, en «Ver mi texto descartado».');
      guardarBorradorLocal(referenciaId, def.clave, null);
      alGuardar();
    } else if (r.ok) {
      setVigente({ valor: entrada, version: r.data.version, autor: 'Tú', instante: new Date().toISOString(), propio: true });
      setConflicto(null);
      setMotivo('');
      setFase('guardado');
      guardarBorradorLocal(referenciaId, def.clave, null);
      alGuardar();
    } else {
      // El choque sigue abierto: solo falta el motivo (o elegir otra salida).
      setErrorConflicto(r.codigo === 'FALTA_MOTIVO' ? 'Escribe el motivo para usar el tuyo.' : r.mensaje);
    }
  }

  const ayuda = ayudaPara(def, tipo);
  const deshabilitado = !puedeEditar || fase === 'guardando';
  const describe = [ayuda ? `${id}-ayuda` : null, idEstado].filter(Boolean).join(' ');

  // Interpretacion de numeros y operaciones (SPEC 6.3): «= 156», «= 1,374 USD». Si el valor ya esta guardado se
  // muestra lo guardado (un `1,374` guardado ya no vuelve a preguntar «¿1,374 o 1374?»); si se esta editando, lo escrito.
  const interpretacion = useMemo(() => {
    if (def.tipoDato !== 'valor_unitario' && def.tipoDato !== 'cantidad') return null;
    if (!sucio && vigente.valor !== null && vigente.valor !== undefined) {
      const guardado = def.tipoDato === 'cantidad' ? (vigente.valor as { valor?: unknown }).valor : vigente.valor;
      if (typeof guardado === 'string' || typeof guardado === 'number') {
        // Una cantidad escrita como numero solo («25») no repite «= 25» debajo.
        const expresion = (vigente.valor as { expresion?: unknown }).expresion;
        if (def.tipoDato === 'cantidad' && typeof expresion === 'string' && Number(expresion.trim().replace(',', '.')) === Number(guardado)) return null;
        const t = String(guardado).replace('.', ',');
        return { ok: true as const, texto: def.tipoDato === 'valor_unitario' ? `= ${t} USD` : `= ${t}`, ambiguo: false };
      }
    }
    if (borrador.texto.trim() === '') return null;
    const r = def.tipoDato === 'valor_unitario' ? parsearValorUnitario(borrador.texto) : parsearCantidad(borrador.texto);
    return r.ok ? { ok: true as const, texto: r.interpretacion, ambiguo: false } : { ok: false as const, texto: r.mensaje, ambiguo: r.codigo === 'AMBIGUO' };
  }, [def.tipoDato, borrador.texto, vigente.valor, sucio]);

  function control(): ReactNode {
    const comun = { id, disabled: deshabilitado, 'aria-describedby': describe };
    switch (def.tipoDato) {
      case 'texto':
        if (def.noAplica) {
          return (
            <div className="space-y-1">
              <Campo
                {...comun}
                maxLength={def.maximo}
                value={borrador.texto}
                disabled={comun.disabled || borrador.noAplica}
                onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
                onBlur={guardarAlSalirDelTexto}
                autoComplete="off"
              />
              <Casilla
                etiqueta={def.noAplica}
                deshabilitada={comun.disabled}
                marcada={borrador.noAplica}
                alCambiar={(v) => cambiar({ ...BORRADOR_VACIO, noAplica: v }, true)}
              />
            </div>
          );
        }
        return (
          <Campo
            {...comun}
            maxLength={def.maximo}
            value={borrador.texto}
            onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
            autoComplete="off"
          />
        );
      case 'proveedor': {
        // Vinculado al fabricante, no copiado: si el fabricante cambia, el proveedor lo sigue.
        const fabricante = typeof valores.fabricante === 'string' ? valores.fabricante : '';
        return (
          <div className="space-y-1">
            <Campo
              {...comun}
              maxLength={def.maximo}
              value={borrador.mismoFabricante ? fabricante : borrador.texto}
              placeholder={borrador.mismoFabricante && !fabricante ? 'Escribe el fabricante arriba' : undefined}
              disabled={comun.disabled || borrador.mismoFabricante}
              onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
              onBlur={guardarAlSalirDelTexto}
              autoComplete="off"
            />
            <Casilla
              etiqueta="El proveedor es el mismo fabricante"
              deshabilitada={comun.disabled}
              marcada={borrador.mismoFabricante}
              alCambiar={(v) => cambiar({ ...BORRADOR_VACIO, mismoFabricante: v }, true)}
            />
          </div>
        );
      }
      case 'texto_largo':
        if (def.clave === 'materia_constitutiva' && tipo === 'INSUMO') {
          return (
            <EntradaComposicion
              id={id}
              valor={borrador.texto}
              deshabilitado={deshabilitado}
              maximo={def.maximo ?? 2000}
              descritoPor={describe}
              onCambio={(texto) => cambiar({ ...borrador, texto })}
              alSalir={() => {
                if (ref.current.fase === 'sin_guardar') void pedirGuardar(ref.current.borrador);
              }}
            />
          );
        }
        return (
          <AreaTexto
            {...comun}
            rows={3}
            maxLength={def.maximo}
            className="field-sizing-content min-h-20"
            value={borrador.texto}
            onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
          />
        );
      case 'lista': {
        const opts = def.opciones ? [...def.opciones] : def.catalogo ? catalogos[def.catalogo] : [];
        const lista = opts.includes(borrador.texto) || borrador.texto === '' ? opts : [borrador.texto, ...opts];
        if (def.catalogo === 'unidad_medida') {
          return (
            <Combobox
              id={id}
              deshabilitado={deshabilitado}
              aria-describedby={describe}
              placeholder="Elige o escribe: litros, kilogramos…"
              opciones={lista.map((o) => ({ valor: o, etiqueta: o }))}
              valor={borrador.texto || null}
              onCambio={(v) => cambiar({ ...borrador, texto: v ?? '' }, true)}
            />
          );
        }
        // «No aplica» es una opcion mas de la lista y cuenta como diligenciado; volver a «Elige una opción» lo deja pendiente.
        return (
          <Seleccion
            {...comun}
            value={borrador.noAplica ? OPCION_NO_APLICA : borrador.texto}
            onChange={(e) =>
              cambiar(e.target.value === OPCION_NO_APLICA ? { ...BORRADOR_VACIO, noAplica: true } : { ...BORRADOR_VACIO, texto: e.target.value }, true)
            }
          >
            <option value="">Elige una opción</option>
            {lista.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {def.noAplica ? <option value={OPCION_NO_APLICA}>{def.noAplica}</option> : null}
          </Seleccion>
        );
      }
      case 'tipo_producto':
        return (
          <Seleccion {...comun} value={borrador.texto} onChange={(e) => cambiar({ ...borrador, texto: e.target.value }, true)}>
            {TIPOS_PRODUCTO.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO[t]}
              </option>
            ))}
          </Seleccion>
        );
      case 'area':
        // Un valor fuera del catalogo (no deberia haberlo) se sigue mostrando para no perderlo de vista.
        return (
          <Seleccion {...comun} value={borrador.texto} onChange={(e) => cambiar({ ...borrador, texto: e.target.value }, true)}>
            <option value="">Elige el área</option>
            {(borrador.texto === '' || esArea(borrador.texto) ? AREAS : [borrador.texto, ...AREAS]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Seleccion>
        );
      case 'si_no':
        return (
          <Seleccion {...comun} value={borrador.texto} onChange={(e) => cambiar({ ...borrador, texto: e.target.value }, true)}>
            <option value="">Elige una opción</option>
            <option value="SI">Sí</option>
            <option value="NO">No</option>
          </Seleccion>
        );
      case 'pais': {
        const opciones = [
          { valor: PAIS_NO_SE_CONOCE, etiqueta: 'No se conoce' },
          ...paises.map((p, i) => ({ valor: p.codigo, etiqueta: p.nombre, detalle: i < 5 ? 'frecuente' : p.codigo })),
        ];
        // Un pais ya guardado que no es de los frecuentes se sigue mostrando.
        const actual = borrador.texto;
        if (actual && !opciones.some((o) => o.valor === actual)) {
          opciones.push({ valor: actual, etiqueta: nombrePais(actual), detalle: actual });
        }
        return (
          <Combobox
            id={id}
            deshabilitado={deshabilitado}
            aria-describedby={describe}
            placeholder="Escribe para buscar: «col», «fran»…"
            opciones={opciones}
            valor={borrador.texto || null}
            onCambio={(v) => cambiar({ ...borrador, texto: v ?? '' }, true)}
          />
        );
      }
      case 'marca':
        return (
          <div className="space-y-1">
            <Campo
              {...comun}
              maxLength={def.maximo}
              value={borrador.texto}
              disabled={comun.disabled || borrador.sinMarca}
              onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
              onBlur={guardarAlSalirDelTexto}
              autoComplete="off"
            />
            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 rounded-md px-1 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                type="checkbox"
                className="casilla"
                disabled={comun.disabled}
                checked={borrador.sinMarca}
                onChange={(e) => cambiar({ ...borrador, sinMarca: e.target.checked, texto: e.target.checked ? '' : borrador.texto }, true)}
              />
              No tiene marca
            </label>
          </div>
        );
      case 'valor_unitario':
        return (
          <div className="relative max-w-xs">
            <Campo
              {...comun}
              inputMode="decimal"
              autoComplete="off"
              className="pr-14 tabular-nums"
              value={borrador.texto}
              onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
            />
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-tinta-suave">
              USD
            </span>
          </div>
        );
      case 'cantidad':
        return (
          <Campo
            {...comun}
            inputMode="decimal"
            autoComplete="off"
            className="max-w-xs tabular-nums"
            value={borrador.texto}
            onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
          />
        );
      case 'fecha':
        return (
          <Campo
            {...comun}
            type="date"
            className="max-w-xs"
            value={borrador.texto}
            onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
          />
        );
      case 'fecha_fabricacion':
        return (
          <div className="space-y-1">
            <Campo
              {...comun}
              type="date"
              className="max-w-xs"
              value={borrador.texto}
              disabled={comun.disabled || borrador.porConfirmar}
              onChange={(e) => cambiar({ ...borrador, texto: e.target.value })}
            />
            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 rounded-md px-1 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
              <input
                type="checkbox"
                className="casilla"
                disabled={comun.disabled}
                checked={borrador.porConfirmar}
                onChange={(e) => cambiar({ ...borrador, porConfirmar: e.target.checked, texto: '' }, e.target.checked)}
              />
              Por confirmar
            </label>
            {borrador.porConfirmar ? (
              <Campo
                aria-label="Nota sobre la fecha por confirmar"
                placeholder="Nota. Ej.: confirmar en la pre-inspección"
                maxLength={500}
                disabled={comun.disabled}
                value={borrador.nota}
                onChange={(e) => cambiar({ ...borrador, nota: e.target.value })}
                onBlur={guardarAlSalirDelTexto}
              />
            ) : null}
          </div>
        );
      case 'partida':
        return (
          <Campo
            {...comun}
            className="max-w-xs font-mono tabular-nums"
            inputMode="numeric"
            placeholder="0000.00.00.00"
            value={borrador.texto}
            onChange={(e) => cambiar({ ...borrador, texto: formatearPartida(e.target.value) })}
          />
        );
      default:
        return <p className="rounded-md bg-muted px-3 py-2 text-sm">{mostrarValor(def, vigente.valor)}</p>;
    }
  }

  const accionLabel =
    def.clave === 'fabricante' && puedeEditar && typeof (valores.marca as { texto?: unknown } | undefined)?.texto === 'string' ? (
      <button
        type="button"
        onClick={() => cambiar({ ...borrador, texto: String((valores.marca as { texto: string }).texto) }, true)}
        className="min-h-8 shrink-0 text-sm font-semibold text-azul-500 underline-offset-2 hover:underline"
      >
        Igual que la marca
      </button>
    ) : null;

  const maximo = def.maximo;
  const usados = [...(def.tipoDato === 'marca' || def.tipoDato === 'texto' || def.tipoDato === 'texto_largo' || def.tipoDato === 'proveedor' ? borrador.texto : '')].length;
  const mostrarContador =
    !!maximo &&
    puedeEditar &&
    !borrador.noAplica &&
    !borrador.mismoFabricante &&
    (def.tipoDato === 'texto_largo' || def.tipoDato === 'texto' || def.tipoDato === 'proveedor') &&
    !(def.clave === 'materia_constitutiva' && tipo === 'INSUMO');

  // Solo lectura: el valor como texto, con el motivo.
  if (!puedeEditar) {
    const vacio = vigente.valor === null || vigente.version === 0;
    return (
      <div className="-m-2 space-y-1.5 p-2" data-campo={def.clave} data-solo-lectura="true">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-tinta">{def.etiqueta}</span>
          {razonSoloLectura ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-tinta-suave">
              <Lock aria-hidden className="size-3.5" />
              {razonSoloLectura}
            </span>
          ) : null}
        </div>
        <div className={cn('rounded-md border border-borde-suave bg-superficie-2 px-3 py-2.5 text-base', vacio && 'text-tinta-suave')}>
          {vacio ? 'Sin valor todavía' : <span className="whitespace-pre-line break-words">{mostrarValor(def, vigente.valor)}</span>}
        </div>
        {!vacio ? (
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-tinta-suave">
            <span>
              {nombreVisible(vigente.autor)} · {vigente.instante ? fechaCorta(vigente.instante) : ''}
            </span>
            <HistorialCampo referenciaId={referenciaId} campo={def.clave} />
          </p>
        ) : null}
      </div>
    );
  }

  const enEdicionAjena = !!editandoPor;
  return (
    <div
      ref={contenedor}
      data-campo={def.clave}
      data-fase={fase}
      className={cn(
        'space-y-1.5 rounded-lg border border-transparent p-2 -m-2 transition-colors duration-150',
        enEdicionAjena && 'border-dashed border-azul-500 bg-azul-50/50',
        (fase === 'error' || fase === 'falta_motivo') && 'border-error/50',
      )}
      onFocus={alEnfocar}
      onBlur={alDesenfocar}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          void pedirGuardar(ref.current.borrador);
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Etiqueta htmlFor={id}>
          {def.etiqueta}
        </Etiqueta>
        {accionLabel}
      </div>
      {ayuda ? (
        <p id={`${id}-ayuda`} className="text-sm text-tinta-suave">
          {ayuda}
        </p>
      ) : null}

      {/* Zona de edicion: control, franja de motivo, choque y aclaraciones. Moverse dentro de ella NO guarda. */}
      <div ref={zonaEdicion} className="space-y-1.5">
        {control()}

        {interpretacion ? (
          <p className={cn('text-sm', interpretacion.ok ? 'font-medium tabular-nums text-tinta' : interpretacion.ambiguo ? 'text-tinta-suave' : 'text-tinta-suave')}>
            {interpretacion.ok ? interpretacion.texto : interpretacion.texto}
          </p>
        ) : null}

        {enEdicionAjena ? (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-azul-700">
            <Pencil aria-hidden className="size-3.5" />
            {nombreVisible(editandoPor)} está escribiendo… Tú también puedes escribir; si guardan a la vez, te avisamos.
          </p>
        ) : null}

        {recuperado && fase === 'sin_guardar' ? (
          <p className="text-sm text-tinta-suave">Recuperamos lo que estabas escribiendo y no se había guardado. Se guarda al salir del campo.</p>
        ) : null}

        {pideMotivo && (fase === 'sin_guardar' || fase === 'falta_motivo') ? (
          <div className="space-y-2 rounded-md border border-azul-200 bg-azul-50 p-3" data-franja-motivo>
            <p className="text-sm text-tinta">
              Este valor lo puso <strong>{nombreVisible(vigente.autor)}</strong>. Cuéntale por qué lo cambias; recibirá un aviso.
            </p>
            <Campo
              aria-label="Motivo del cambio"
              aria-invalid={fase === 'falta_motivo' ? true : undefined}
              placeholder="Ej.: así aparece en la factura"
              maxLength={1000}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            {fase === 'falta_motivo' ? (
              <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-error">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                Escribe el motivo para guardar. Tu texto sigue aquí.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Boton variante="primario" tamano="sm" onClick={() => void pedirGuardar(borrador)}>
                Guardar cambio
              </Boton>
              <Boton
                variante="secundario"
                tamano="sm"
                onClick={() => {
                  setBorrador(valorABorrador(def, vigente.valor));
                  setMotivo('');
                  setMensaje('');
                  setFase('limpio');
                  guardarBorradorLocal(referenciaId, def.clave, null);
                }}
              >
                Cancelar
              </Boton>
            </div>
          </div>
        ) : null}

        {fase === 'conflicto' && conflicto ? (
          <div className="space-y-3 rounded-md border border-azul-500 bg-azul-50 p-3" role="alert" data-conflicto>
            <p className="text-sm font-medium text-tinta">
              <strong>{nombreVisible(conflicto.autor)}</strong> ya guardó este campo. Tu texto no se perdió.
            </p>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded border border-borde-suave bg-superficie p-2">
                <p className="mb-0.5 font-semibold text-tinta-suave">Quedó guardado</p>
                <p className="whitespace-pre-line break-words">{mostrarValor(def, conflicto.valor)}</p>
              </div>
              <details open className="rounded border border-borde-suave bg-superficie p-2">
                <summary className="cursor-pointer font-semibold text-tinta-suave">Ver mi texto</summary>
                <p className="mt-0.5 whitespace-pre-line break-words">{mostrarValor(def, borradorAEntrada(def, borrador))}</p>
              </details>
            </div>
            <label className="block text-sm">
              <span className="font-semibold">Motivo</span> <span className="text-tinta-suave">(solo para «Usar el mío»)</span>
              <Campo className="mt-1" value={motivo} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} />
            </label>
            {errorConflicto ? (
              <p role="alert" className="text-sm font-semibold text-error">
                {errorConflicto}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Boton variante="secundario" tamano="sm" onClick={() => void resolver('dejar')}>
                Dejar el de {nombreVisible(conflicto.autor).split(' ')[0]}
              </Boton>
              <Boton variante="primario" tamano="sm" onClick={() => void resolver('usar_mio')}>
                Usar el mío
              </Boton>
              {def.tipoDato === 'texto' || def.tipoDato === 'texto_largo' ? (
                <Boton variante="secundario" tamano="sm" onClick={() => void resolver('combinar')}>
                  Combinar
                </Boton>
              ) : null}
            </div>
          </div>
        ) : null}

        {ambiguo ? (
          <div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
            <span className="font-medium">¿Qué quisiste decir?</span>
            {ambiguo.map((o) => (
              <Boton key={o.clave} variante="secundario" tamano="sm" onClick={() => void guardar(borrador, { desambiguar: o.clave })}>
                {o.texto}
              </Boton>
            ))}
          </div>
        ) : null}
      </div>

      <div id={idEstado} className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tinta-suave">
        {fase === 'guardando' ? (
          <span className="inline-flex items-center gap-1.5">
            <LoaderCircle aria-hidden className="size-3.5 animate-girar" />
            Guardando…
          </span>
        ) : null}
        {fase === 'sin_guardar' ? <span>Sin guardar</span> : null}
        {fase === 'guardado' ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-azul-700">
            <Check aria-hidden className="size-3.5" />
            Guardado
          </span>
        ) : null}
        {fase === 'error' ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-error">
            <CircleAlert aria-hidden className="size-3.5" />
            No se guardó
          </span>
        ) : null}
        {hayValor && fase !== 'conflicto' ? (
          <span>
            {vigente.propio ? 'Tú' : nombreVisible(vigente.autor)} · {vigente.instante ? fechaCorta(vigente.instante) : ''}
          </span>
        ) : null}
        <HistorialCampo referenciaId={referenciaId} campo={def.clave} />
        {mostrarContador ? (
          <span className="ml-auto tabular-nums" aria-label={`${usados} de ${maximo} caracteres`}>
            {usados} / {maximo}
          </span>
        ) : null}
      </div>

      {fase === 'error' && !ambiguo ? (
        <div role="alert" className="space-y-1.5 text-sm font-medium text-error">
          <p className="flex items-start gap-1.5">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{mensaje}</span>
          </p>
          {reintentable ? (
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => void guardar(borrador)}
            >
              Reintentar ahora
            </Boton>
          ) : null}
        </div>
      ) : null}
      {fase === 'falta_motivo' && !pideMotivo && mensaje ? <p className="text-sm font-medium text-error">{mensaje}</p> : null}
      {fase === 'guardado' && mensaje ? <p className="text-sm text-tinta-suave">{mensaje}</p> : null}

      {confirmarTipo ? (
        <DialogoConfirmacion
          abierto
          titulo={`Cambiar a ${ETIQUETA_TIPO[confirmarTipo.nuevo]}`}
          descripcion={`Con este tipo ya no pedimos: ${confirmarTipo.ocultos.join(', ')}. Lo escrito se conserva en el historial.`}
          confirmar="Cambiar tipo"
          cancelar="Todavía no"
          pedirMotivo={pideMotivo}
          etiquetaMotivo="Motivo del cambio"
          ayudaMotivo={pideMotivo ? `Este valor lo puso ${nombreVisible(vigente.autor)}. Recibirá un aviso.` : undefined}
          onCerrar={() => {
            if (tipoConfirmado.current) {
              tipoConfirmado.current = false;
              return;
            }
            setBorrador(valorABorrador(def, vigente.valor));
            setFase('limpio');
            setConfirmarTipo(null);
          }}
          onConfirmar={async (m) => {
            tipoConfirmado.current = true;
            ref.current.motivo = m;
            setMotivo(m);
            setConfirmarTipo(null);
            await guardar({ ...ref.current.borrador, texto: confirmarTipo.nuevo });
          }}
        />
      ) : null}
    </div>
  );
}

const OPCION_NO_APLICA = '__no_aplica__';

/** Casilla de un campo compuesto («No aplica», «El proveedor es el mismo fabricante»). */
function Casilla({
  etiqueta,
  marcada,
  deshabilitada,
  alCambiar,
}: {
  etiqueta: string;
  marcada: boolean;
  deshabilitada: boolean;
  alCambiar: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 rounded-md px-1 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <input type="checkbox" className="casilla" disabled={deshabilitada} checked={marcada} onChange={(e) => alCambiar(e.target.checked)} />
      {etiqueta}
    </label>
  );
}
