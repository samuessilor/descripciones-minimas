/**
 * Referencias de EJEMPLO para desarrollo (solo `NODE_ENV=development`; nunca en produccion): una planta optica
 * inventada con 12 fichas en estados distintos, varios autores, comentarios, historial con ediciones de personas
 * distintas, pendientes para cada rol y avisos. Sirve para abrir la aplicacion y verla con vida.
 *
 * Todo pasa por las MISMAS acciones que usa la interfaz (crear, guardar campo, enviar a, partida, solicitud de
 * informacion de la aduana y respuesta del area, cerrar, reabrir, pedir reapertura, comentar): asi el historial y los avisos quedan coherentes y
 * cualquier regla nueva se respeta tambien aqui. Los valores son inventados (codigos `EJ-0001`...), correos
 * `@desarrollo.invalid`; no hay ningun dato de los Excel de trabajo.
 */
import { eq, sql } from 'drizzle-orm';
import { asignacion, referencia, usuario } from '@/db/esquema';
import type { Db } from '@/db/tipos';
import type { Area } from '@/dominio/areas';
import { getCampo } from '@/dominio/campos';
import { cargarActorPorId, type Actor } from './politicas/actor';
import { enviarA } from './acciones/asignaciones';
import { finalizar, reabrir, solicitarReapertura } from './acciones/cierre';
import { comentar } from './acciones/comentarios-y-bandeja';
import { crearReferencia } from './acciones/crear-referencia';
import { guardarCampo } from './acciones/guardar-campo';
import { fijarPartida } from './acciones/partida';

type Tipo = 'INSUMO' | 'REPUESTO' | 'EQUIPO' | 'ACCESORIO' | 'MONTURA';
type Pares = Array<[string, unknown]>;

interface Ficha {
  codigo: string;
  nombre: string;
  tipo: Tipo;
  /** Area responsable; sin ella, la del area de quien la crea. */
  area?: Area;
  datos: Pares;
}

const ADICIONAL = 'EJEMPLO inventado para desarrollo: no representa una mercancía real.';

/**
 * Campos comunes de «producto» y del RIM de una ficha casi completa. `rim` es la cantidad si requiere registro de
 * importacion, o `null` si no lo requiere.
 */
function producto(desc: string, uso: string, funciones: string, rim: string | null, unidad = 'Unidades'): Pares {
  return [
    ['descripcion_factura', desc],
    ['uso', uso],
    ['funciones', funciones],
    ['unidad_medida', unidad],
    ['reembolsable', 'No'],
    ['requiere_rim', rim === null ? 'NO' : 'SI'],
    ['informacion_adicional', ADICIONAL],
  ];
}

/** Detalle de un insumo (materia, aspecto, marca, origen, proveedor...). */
function detalleInsumo(materia: string, aspecto: string, empaque: string, origen: string): Pares {
  return [
    ['materia_constitutiva', materia],
    ['aspecto_fisico', aspecto],
    ['marca', { texto: 'MARCA-EJEMPLO' }],
    ['pais_origen', origen],
    ['fabricante', 'Química Ejemplo SA'],
    ['proveedor', 'Distribuciones Ejemplo SAS'],
    ['tipo_empaque', empaque.startsWith('Bidón') ? 'Bidón' : 'Paquete'],
    ['cantidad_empaque', empaque.replace(/^\S+ (de )?/, '')],
  ];
}

/** Detalle de un repuesto o accesorio (sin empaque propio: «Unidad»; el proveedor es el mismo fabricante). */
function detalleMaquina(maquina: string, materia: string, origen: string): Pares {
  return [
    ['maquina_destino', maquina],
    ['materia_constitutiva', materia],
    ['aspecto_fisico', 'Sólido'],
    ['marca', { texto: 'MARCA-EJEMPLO' }],
    ['pais_origen', origen],
    ['fabricante', 'Industrias Ejemplo SA'],
    ['proveedor', { mismo_fabricante: true }],
    ['tipo_empaque', 'Unidad'],
  ];
}

/** Detalle de un equipo o maquina completa (no lleva «maquina donde se instala», pero si fecha de fabricacion). */
function detalleEquipo(materia: string, origen: string, fabricacion: string): Pares {
  return [
    ['materia_constitutiva', materia],
    ['aspecto_fisico', 'Sólido'],
    ['marca', { texto: 'MARCA-EJEMPLO' }],
    ['pais_origen', origen],
    ['fabricante', 'Industrias Ejemplo SA'],
    ['proveedor', 'Suministros Ejemplo SAS'],
    ['tipo_empaque', 'Unidad'],
    ['fecha_fabricacion', { fecha: fabricacion }],
  ];
}

const FICHAS = {
  resina: {
    codigo: 'EJ-0001',
    nombre: 'Resina epóxica para recubrimiento de lentes',
    tipo: 'INSUMO',
    datos: [
      ...producto(
        'RESINA EPOXICA DE DOS COMPONENTES PARA RECUBRIMIENTO',
        'Recubrir la cara externa de lentes semiterminados en la línea de tratamiento duro.',
        'Forma una capa transparente resistente a rayones sobre el lente.',
        '12x20',
        'Kilogramos',
      ),
      ...detalleInsumo('Resina epóxica 78 %\nEndurecedor amínico 20 %\nAditivos 2 %', 'Líquido', 'Paquete de 20 kg', 'DE'),
    ],
  },
  filtroAire: {
    codigo: 'EJ-0002',
    nombre: 'Filtro de aire comprimido 5 micras',
    tipo: 'REPUESTO',
    // Un repuesto que es de Consumibles: el area no se deriva del tipo (P4).
    area: 'Consumibles',
    datos: [
      ...producto(
        'ELEMENTO FILTRANTE DE AIRE COMPRIMIDO 5 MICRAS',
        'Retener partículas y aceite del aire comprimido que alimenta las pulidoras de lentes.',
        'Filtra el aire de la línea neumática antes de llegar a la máquina.',
        null,
      ),
      ...detalleMaquina('Pulidora de lentes línea 3', 'Carcasa de aluminio, elemento de celulosa', 'IT'),
    ],
  },
  motor: {
    codigo: 'EJ-0003',
    nombre: 'Motor trifásico 1,5 kW con freno',
    tipo: 'REPUESTO',
    datos: [
      ...producto(
        'MOTOR ELECTRICO TRIFASICO 1,5 KW CON FRENO',
        'Mover el eje de la banda de transporte de bandejas de lentes.',
        'Convierte energía eléctrica en giro del eje.',
        '4',
      ),
      ...detalleMaquina('Transportador de bandejas T-12', 'Aluminio, cobre, acero', 'CN'),
    ],
  },
  sensor: {
    codigo: 'EJ-0004',
    nombre: 'Sensor de proximidad inductivo M12',
    tipo: 'REPUESTO',
    datos: [
      ...producto(
        'SENSOR DE PROXIMIDAD INDUCTIVO M12 24 VDC',
        'Detectar la presencia de la bandeja de lentes en la estación de carga.',
        'Emite una señal cuando un objeto metálico se acerca.',
        null,
      ),
      ...detalleMaquina('Estación de carga E-04', 'Latón niquelado, cable de PVC', 'DE'),
    ],
  },
  cinta: {
    codigo: 'EJ-0005',
    nombre: 'Cinta adhesiva de enmascarar de baja adherencia',
    tipo: 'INSUMO',
    datos: [
      ['descripcion_factura', 'CINTA ADHESIVA DE ENMASCARAR 24 MM X 50 M'],
      ['uso', 'Proteger bordes de las bandejas durante el recubrimiento.'],
      ['unidad_medida', 'Unidades'],
      ['marca', { texto: 'MARCA-EJEMPLO' }],
    ],
  },
  montura: {
    codigo: 'EJ-0006',
    nombre: 'Montura oftálmica de acetato para exhibidor',
    tipo: 'MONTURA',
    area: 'Marketing',
    datos: [],
  },
  lampara: {
    codigo: 'EJ-0007',
    nombre: 'Lámpara UV de curado 365 nm',
    tipo: 'EQUIPO',
    area: 'Instrumentos',
    datos: [
      ['descripcion_factura', 'LAMPARA UV DE CURADO 365 NM'],
      ['uso', 'Curar el recubrimiento de lentes en la cámara de curado.'],
      ['funciones', 'Emite luz ultravioleta que endurece la resina.'],
      ['unidad_medida', 'Unidades'],
      ['marca', { texto: 'MARCA-EJEMPLO' }],
      ['pais_origen', 'US'],
      ['requiere_rim', 'SI'],
      ['fecha_fabricacion', { por_confirmar: true, nota: 'Pendiente de confirmar con el proveedor.' }],
    ],
  },
  bomba: {
    codigo: 'EJ-0008',
    nombre: 'Bomba de vacío de paletas',
    tipo: 'EQUIPO',
    datos: [
      ...producto(
        'BOMBA DE VACIO DE PALETAS ROTATIVAS 10 M3/H',
        'Generar vacío para sujetar los lentes en la mesa de deposición.',
        'Extrae el aire de la cámara hasta el nivel de vacío requerido.',
        '1',
      ),
      ...detalleEquipo('Hierro fundido, aluminio, aceite mineral', 'DE', '2025-11-03'),
    ],
  },
  disolvente: {
    codigo: 'EJ-0009',
    nombre: 'Disolvente isopropílico grado técnico',
    tipo: 'INSUMO',
    datos: [
      ...producto(
        'ALCOHOL ISOPROPILICO GRADO TECNICO 99 %',
        'Limpiar lentes y bandejas antes del recubrimiento.',
        'Disuelve grasas y residuos de la superficie.',
        null,
        'Litros',
      ),
      ...detalleInsumo('Alcohol isopropílico 99 %\nAgua 1 %', 'Líquido', 'Bidón de 200 L', 'US'),
    ],
  },
  plc: {
    codigo: 'EJ-0010',
    nombre: 'Controlador lógico programable compacto',
    tipo: 'REPUESTO',
    datos: [
      ...producto(
        'CONTROLADOR LOGICO PROGRAMABLE COMPACTO 24 VDC 16 E/S',
        'Controlar la secuencia de la estación de inspección automática.',
        'Ejecuta el programa que activa los actuadores según las señales de los sensores.',
        '2',
      ),
      ...detalleMaquina('Estación de inspección I-01', 'Plástico ABS, circuitos electrónicos', 'JP'),
    ],
  },
  rodamiento: {
    codigo: 'EJ-0011',
    nombre: 'Rodamiento de bolas 6204 2RS',
    tipo: 'REPUESTO',
    datos: [
      ['descripcion_factura', 'RODAMIENTO RIGIDO DE BOLAS 6204 2RS'],
      ['uso', 'Soportar el giro del eje del mezclador de resinas.'],
      ['funciones', 'Reduce la fricción entre el eje y su alojamiento.'],
      ['maquina_destino', 'Mezclador de resinas M-07'],
      ['materia_constitutiva', 'Acero cromado, sellos de caucho'],
      ['marca', { texto: 'MARCA-EJEMPLO' }],
    ],
  },
  carbon: {
    codigo: 'EJ-0012',
    nombre: 'Filtro de carbón activado para extracción',
    tipo: 'ACCESORIO',
    datos: [
      ...producto(
        'FILTRO DE CARBON ACTIVADO PARA CAMPANA DE EXTRACCION',
        'Retener vapores de solventes en la campana de la sala de mezclas.',
        'Adsorbe los vapores orgánicos del aire extraído.',
        null,
      ),
      ...detalleMaquina('Campana de extracción C-03', 'Carbón activado, marco de acero galvanizado', 'ES'),
    ],
  },
} satisfies Record<string, Ficha>;

async function actorPorEmail(db: Db, email: string): Promise<Actor> {
  const [u] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, email)).limit(1);
  const a = u ? await cargarActorPorId(db, u.id) : null;
  if (!a) throw new Error(`Semilla de ejemplos: no existe o no esta activo ${email}`);
  return a;
}

async function versionDe(db: Db, id: string, campo: string): Promise<number> {
  const [f] = await db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, id)).limit(1);
  return f?.datos?.[campo]?.n ?? 0;
}

async function guardar(db: Db, actor: Actor, id: string, campo: string, valor: unknown, motivo?: string): Promise<void> {
  const versionEsperada = await versionDe(db, id, campo);
  await guardarCampo({ db, actor }, { referenciaId: id, campo, valor, versionEsperada, ...(motivo ? { motivo } : {}) });
}

async function crear(db: Db, actor: Actor, f: Ficha): Promise<string> {
  const r = await crearReferencia(
    { db, actor },
    { codigo: f.codigo, nombreProducto: f.nombre, tipoProducto: f.tipo, ...(f.area ? { areaResponsable: f.area } : {}) },
  );
  // Los campos de la aduana (hoy, el RIM) no los escribe el solicitante: la semilla los pone con el admin.
  const admin = await actorPorEmail(db, 'admin@desarrollo.invalid');
  for (const [campo, valor] of f.datos) await guardar(db, getCampo(campo)?.grupo === 'A' ? admin : actor, r.id, campo, valor);
  return r.id;
}

async function enviar(
  db: Db,
  de: Actor,
  id: string,
  para: Actor,
  mensaje?: string,
  pedido?: 'completar' | 'clasificar' | 'responder' | 'revisar',
  secciones?: Array<'producto' | 'detalle' | 'especificaciones'>,
): Promise<void> {
  await enviarA(
    { db, actor: de },
    {
      referenciaId: id,
      destinatarios: [{ usuarioId: para.usuarioId, ...(pedido ? { pedido } : {}), ...(secciones ? { secciones } : {}) }],
      ...(mensaje ? { mensaje } : {}),
    },
  );
}

async function partida(db: Db, aduana: Actor, id: string, codigo: string): Promise<void> {
  await fijarPartida({ db, actor: aduana }, { referenciaId: id, partida: codigo, versionEsperada: await versionDe(db, id, 'partida_arancelaria') });
}

/**
 * Lo que la aduana pide saber del producto (descripciones minimas adicionales). Inventado para desarrollo: al guardarlo,
 * el area recibe un pendiente «Responder».
 */
const SOLICITUDES = {
  motor: '¿Cuál es la tensión, la corriente y la velocidad que dice la placa de datos del motor?',
  bomba: '¿Cuál es el caudal nominal (m³/h) y qué tipo de aceite usa la bomba?',
  plc: '¿El controlador trae fuente de alimentación incorporada? ¿Cuántas entradas son analógicas?',
} satisfies Partial<Record<keyof typeof FICHAS, string>>;

async function pedirInformacion(db: Db, aduana: Actor, id: string, solicitud: string): Promise<void> {
  await guardar(db, aduana, id, 'descripciones_minimas', solicitud);
}

/** La aduana no necesita nada mas: elige arancel e IVA, marca «No es necesario por ahora / no aplica», escribe la restriccion y cierra. */
async function cerrar(db: Db, aduana: Actor, id: string, partidaCodigo: string): Promise<void> {
  await partida(db, aduana, id, partidaCodigo);
  await guardar(db, aduana, id, 'arancel', '5%');
  await guardar(db, aduana, id, 'iva', '19%');
  await guardar(db, aduana, id, 'descripciones_minimas', { no_aplica: true });
  await guardar(db, aduana, id, 'restricciones', 'Sin restricciones (siempre que la mercancía sea nueva).');
  await guardar(db, aduana, id, 'observaciones_aduana', { no_aplica: true });
  await finalizar(
    { db, actor: aduana },
    { referenciaId: id, motivoCerrarDeTodosModos: 'Cierre de ejemplo para desarrollo, con lo disponible.' },
  );
}

/** Crea las 12 referencias de ejemplo. Idempotente: si `EJ-0001` ya existe no hace nada. */
export async function sembrarEjemplos(db: Db): Promise<void> {
  const [ya] = await db.select({ id: referencia.id }).from(referencia).where(eq(referencia.codigo, FICHAS.resina.codigo)).limit(1);
  if (ya) return;

  const edgar = await actorPorEmail(db, 'solicitante@desarrollo.invalid');
  const carla = await actorPorEmail(db, 'solicitante2@desarrollo.invalid');
  const ana = await actorPorEmail(db, 'admin@desarrollo.invalid');
  const aduanaA = await actorPorEmail(db, 'aduana-a@desarrollo.invalid');
  const aduanaB = await actorPorEmail(db, 'aduana-b@desarrollo.invalid');
  const f = FICHAS;

  // 1) Clasificada (verde) por la Agencia A: una resina sin partida en el catalogo, cerrada con lo disponible.
  const resina = await crear(db, edgar, f.resina);
  await enviar(db, edgar, resina, aduanaA, 'Resina nueva del proveedor europeo. ¿La clasificas esta semana?');
  await cerrar(db, aduanaA, resina, '3907.30.00.00');

  // 2) Clasificada (verde) por la Agencia A con una partida del catalogo; luego Carla pide reabrirla (pendiente para el admin).
  const filtro = await crear(db, carla, f.filtroAire);
  await enviar(db, carla, filtro, aduanaA);
  await cerrar(db, aduanaA, filtro, '8421.39.90.00');
  await solicitarReapertura({ db, actor: carla }, { referenciaId: filtro, motivo: 'El proveedor corrigió el material del elemento filtrante; hay que revisar la descripción.' });

  // 3) La Agencia B puso la partida y pide un dato en «Descripciones mínimas adicionales»: a las cuentas del area
  //    responsable (Consumibles: Edgar y la cuenta general) les llega un pendiente «Responder» y la parte de la aduana
  //    queda esperando su respuesta.
  const motor = await crear(db, edgar, f.motor);
  await enviar(db, edgar, motor, aduanaB, 'Motor para el transportador T-12. Dime qué más necesitas.');
  await partida(db, aduanaB, motor, '8501.31.20.00');
  await pedirInformacion(db, aduanaB, motor, SOLICITUDES.motor);
  await comentar({ db, actor: edgar }, { referenciaId: motor, texto: 'Mañana la fotografío en la planta y la subo.', visibilidad: 'todos' });

  // 4) En espera de la Agencia A (sin partida todavia).
  const sensor = await crear(db, carla, f.sensor);
  await enviar(db, carla, sensor, aduanaA);

  // 5) Borrador a medias de Edgar.
  await crear(db, edgar, f.cinta);

  // 6) Borrador recien creado por la administradora: una montura (sin «Máquina donde se instala»).
  await crear(db, ana, f.montura);

  // 7) En gestion con Carla (pendiente «completar» para ella) + historial con ediciones de dos personas.
  const lampara = await crear(db, edgar, f.lampara);
  await guardar(
    db,
    carla,
    lampara,
    'uso',
    'Curar el recubrimiento de lentes en la cámara de curado de la línea 2 (después del secado).',
    'Precisión: la lámpara va en la línea 2, no en la 1.',
  );
  await guardar(db, edgar, lampara, 'funciones', 'Emite luz ultravioleta de 365 nm que endurece el recubrimiento.', 'Dato exacto de la ficha del fabricante.');
  await enviar(db, edgar, lampara, carla, 'Faltan fabricante, proveedor y materia. ¿Los completas tú?', 'completar', ['producto', 'detalle']);
  // Las partes quedan repartidas: Detalle para Carla y Especificaciones para la administradora.
  // Requiere RIM pero aun no tiene la cantidad: Especificaciones queda pendiente.
  await enviar(db, edgar, lampara, ana, 'Tú revisa las especificaciones: falta la cantidad del RIM.', 'completar', ['especificaciones']);
  await comentar({ db, actor: edgar }, { referenciaId: lampara, campo: 'fecha_fabricacion', texto: 'El proveedor confirma la fecha la próxima semana.', visibilidad: 'todos' });

  // 8) En gestion con la Agencia A: la aduana pidio dos datos al area Mantenimiento; Carla respondio en «Respuesta del área»: su
  //    pendiente «Responder» quedo hecho y la agencia recibio el aviso para seguir clasificando.
  const bomba = await crear(db, carla, f.bomba);
  await enviar(db, carla, bomba, aduanaA);
  await partida(db, aduanaA, bomba, '8479.90.00.00');
  await pedirInformacion(db, aduanaA, bomba, SOLICITUDES.bomba);
  await guardar(db, carla, bomba, 'respuesta_area', 'Caudal nominal: 10 m³/h. Aceite mineral para bombas de vacío (ISO VG 100).');
  await comentar({ db, actor: aduanaA }, { referenciaId: bomba, texto: 'Gracias, con eso termino la clasificación esta semana.', visibilidad: 'todos' });

  // 9) Clasificada (verde) por la Agencia B.
  const disolvente = await crear(db, carla, f.disolvente);
  await enviar(db, carla, disolvente, aduanaB);
  await cerrar(db, aduanaB, disolvente, '2905.12.00.00');

  // 10) En gestion con la Agencia B (partida de tension/controlador puesta y una solicitud de informacion para el area
  //     Consumibles).
  const plc = await crear(db, edgar, f.plc);
  await enviar(db, edgar, plc, aduanaB, 'Controlador de la estación de inspección. Urgente: la línea está parada.');
  await partida(db, aduanaB, plc, '8537.10.10.00');
  await pedirInformacion(db, aduanaB, plc, SOLICITUDES.plc);
  await enviar(db, edgar, plc, ana, 'Revisa la ficha antes de aprobar la compra.', 'revisar');

  // 11) Pendiente para Edgar: Carla se la envia para que complete el detalle.
  const rodamiento = await crear(db, carla, f.rodamiento);
  await enviar(db, carla, rodamiento, edgar, 'Falta el fabricante y el país de origen; tú conoces al proveedor.', 'completar', ['producto', 'detalle']);

  // 12) Clasificada y luego reabierta por la aduana (en gestion, etiqueta «Reabierta», pendiente para ella).
  const carbon = await crear(db, edgar, f.carbon);
  await enviar(db, edgar, carbon, aduanaA);
  await cerrar(db, aduanaA, carbon, '8421.39.90.00');
  await reabrir({ db, actor: aduanaA }, { referenciaId: carbon, motivo: 'El fabricante cambió el medio filtrante; hay que actualizar la descripción.' });
  await envejecer(db, [
    // Detenidas y antiguas, para que el Resumen muestre «sin moverse» y los dias de espera de cada persona.
    { id: lampara, solicitada: 9, movida: 6 },
    { id: bomba, solicitada: 12, movida: 7 },
    { id: rodamiento, solicitada: 4, movida: 3 },
    { id: plc, solicitada: 2, movida: 1 },
    // Cerradas: dias en gestion distintos de cero.
    { id: resina, solicitada: 14, movida: 5, clasificada: 5 },
    { id: filtro, solicitada: 20, movida: 12, clasificada: 12 },
    { id: disolvente, solicitada: 8, movida: 2, clasificada: 2 },
  ]);
}

/** Solo semilla de ejemplos: corre hacia atras las fechas de algunas fichas para que el tablero se vea como en uso real. */
async function envejecer(db: Db, filas: Array<{ id: string; solicitada: number; movida: number; clasificada?: number }>): Promise<void> {
  const dias = (n: number) => sql`now() - make_interval(days => ${n}::int)`;
  for (const f of filas) {
    await db
      .update(referencia)
      .set({
        fechaSolicitud: sql`((now() at time zone 'America/Bogota')::date - ${f.solicitada}::int)`,
        actualizadaEn: dias(f.movida),
        ...(f.clasificada !== undefined ? { clasificadaEn: dias(f.clasificada) } : {}),
      })
      .where(eq(referencia.id, f.id));
    await db.update(asignacion).set({ creadaEn: dias(f.movida) }).where(eq(asignacion.referenciaId, f.id));
  }
}
