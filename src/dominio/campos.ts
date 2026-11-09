/**
 * Catalogo de campos de la ficha (SPEC 6.1 punto 2, SPEC 7). Es DATO declarativo: cambiar una
 * regla de campo es tocar este archivo, no migrar la base (R-06). La tabla de pruebas
 * `tests/fixtures/matriz-spec7.json` transcribe la matriz del SPEC de forma independiente y
 * `tests/unit/campos.test.ts` verifica que ambas coincidan. La reunion con el area (2026-10-29) cambio
 * varias reglas: la matriz las recoge y los comentarios de cada campo dicen por que.
 *
 * Dominio PURO: no importa de `db`, `server` ni Next.
 */

export const TIPOS_PRODUCTO = ['INSUMO', 'REPUESTO', 'EQUIPO', 'ACCESORIO', 'MONTURA'] as const;
export type TipoProducto = (typeof TIPOS_PRODUCTO)[number];

export const ETIQUETA_TIPO: Record<TipoProducto, string> = {
  INSUMO: 'Insumo',
  REPUESTO: 'Repuesto',
  EQUIPO: 'Equipo/Máquina',
  ACCESORIO: 'Accesorio',
  MONTURA: 'Montura',
};

export const SECCIONES = ['producto', 'detalle', 'especificaciones'] as const;
export type Seccion = (typeof SECCIONES)[number];

export const ETIQUETA_SECCION: Record<Seccion, string> = {
  producto: 'Producto',
  detalle: 'Detalle',
  especificaciones: 'Especificaciones',
};

/** C = cliente (escriben solicitante/admin) · A = aduana (escriben aduana/admin) · S = sistema. */
export type Grupo = 'C' | 'A' | 'S';

/** O = obligatorio para verde · P = opcional (visible) · - = oculto. */
export type Obligatoriedad = 'O' | 'P' | '-';

export type TipoDato =
  | 'codigo'
  | 'texto'
  | 'texto_largo'
  | 'lista'
  | 'tipo_producto'
  | 'area'
  | 'pais'
  | 'marca'
  | 'proveedor'
  | 'valor_unitario'
  | 'cantidad'
  | 'fecha'
  | 'fecha_fabricacion'
  | 'partida'
  | 'clasificador'
  | 'si_no'
  | 'respuesta'
  | 'calculado'
  | 'adjuntos';

export interface CampoDef {
  clave: string;
  etiqueta: string;
  seccion: Seccion;
  /** Subbloque "Complementos de la aduana" (D-08): se pinta en la zona de la aduana, no en la seccion. */
  subbloque: 'complementos_aduana' | null;
  grupo: Grupo;
  /** Numero de fila en la matriz del SPEC 7 (30 en adelante: campos de la reunion con el area). */
  fila: number;
  /** F = respaldado por fuente · S = supuesto o decision del arquitecto. */
  confianza: 'F' | 'S';
  tipoDato: TipoDato;
  reglas: Record<TipoProducto, Obligatoriedad>;
  /** Maximo de caracteres para campos de texto. */
  maximo?: number;
  /** Catalogo administrable que alimenta la lista (se valida en el servidor). */
  catalogo?: 'unidad_medida' | 'aspecto_fisico';
  /** Admite la marca «No aplica» (`{ no_aplica: true }`), que cuenta como diligenciado. Es el texto de la casilla. */
  noAplica?: string;
  /** Opciones fijas de una lista (sin catalogo administrable). Se valida en el servidor. */
  opciones?: readonly string[];
  /** Solo se pide si otro campo tiene ese valor (o uno de estos): el contenido, solo si el empaque es bidon o paquete. */
  soloSi?: { clave: string; valor: unknown };
  ayuda: string;
  ayudaPorTipo?: Partial<Record<TipoProducto, string>>;
  /** Se puede escribir con `guardarCampo`. Los calculados y las fotos tienen su propia via. */
  escribible: boolean;
}

/** Reglas por tipo. La montura sigue al accesorio salvo que se diga otra cosa (reunion con el area). */
const r = (
  insumo: Obligatoriedad,
  repuesto: Obligatoriedad,
  equipo: Obligatoriedad,
  accesorio: Obligatoriedad,
  montura: Obligatoriedad = accesorio,
): Record<TipoProducto, Obligatoriedad> => ({ INSUMO: insumo, REPUESTO: repuesto, EQUIPO: equipo, ACCESORIO: accesorio, MONTURA: montura });

const TODOS_O = r('O', 'O', 'O', 'O');
const TODOS_P = r('P', 'P', 'P', 'P');
const NINGUNO = r('-', '-', '-', '-');

export const TEXTO_NO_APLICA = 'No aplica';

/** Tipos de empaque (reunion 2026-11): siempre hay uno; si no viene en empaque, es «Unidad». */
export const EMPAQUES = ['Bidón', 'Paquete', 'Unidad'] as const;
/** Con estos empaques se pide ademas «por cuanto» viene (litros/kilos por bidon, unidades por paquete). */
export const EMPAQUES_CON_CONTENIDO: readonly string[] = ['Bidón', 'Paquete'];

function def(c: Omit<CampoDef, 'subbloque' | 'escribible' | 'ayuda'> & Partial<Pick<CampoDef, 'subbloque' | 'escribible' | 'ayuda'>>): CampoDef {
  return { subbloque: null, escribible: true, ayuda: '', ...c };
}

/** En el orden de la pantalla (REU Estructura + D-08). */
export const CAMPOS: readonly CampoDef[] = [
  // ---- Producto
  def({
    clave: 'codigo', etiqueta: 'Código de referencia', seccion: 'producto', grupo: 'C', fila: 1, confianza: 'F',
    tipoDato: 'codigo', reglas: TODOS_O, maximo: 80, escribible: false,
    ayuda: 'Ej.: 1GA0612A00',
  }),
  def({
    clave: 'nombre_producto', etiqueta: 'Nombre del producto', seccion: 'producto', grupo: 'C', fila: 2, confianza: 'F',
    tipoDato: 'texto', reglas: TODOS_O, maximo: 200, ayuda: 'Ej.: NSR E1',
  }),
  def({
    clave: 'fecha_solicitud', etiqueta: 'Fecha de solicitud', seccion: 'producto', grupo: 'S', fila: 3, confianza: 'F',
    tipoDato: 'fecha', reglas: TODOS_P,
  }),
  def({
    clave: 'dias_gestion', etiqueta: 'Días en gestión', seccion: 'producto', grupo: 'S', fila: 4, confianza: 'F',
    tipoDato: 'calculado', reglas: TODOS_P, escribible: false,
  }),
  def({
    clave: 'tipo_producto', etiqueta: 'Tipo de producto', seccion: 'producto', grupo: 'C', fila: 5, confianza: 'F',
    tipoDato: 'tipo_producto', reglas: TODOS_O,
  }),
  // Area duena de la referencia (catalogo fijo `AREAS`): sus cuentas la ven en «Para mí» y reciben las solicitudes de
  // la aduana. No se deriva del tipo. Obligatoria: se elige al crear y cuenta en «faltan» si queda vacia.
  def({
    clave: 'area_responsable', etiqueta: 'Área responsable', seccion: 'producto', grupo: 'C', fila: 33, confianza: 'F',
    tipoDato: 'area', reglas: TODOS_O,
    ayuda: 'El área a la que le pertenece la referencia. Sus personas la verán en «Para mí».',
  }),
  // Descripcion, uso, funciones y unidad de medida: obligatorios en todos los tipos (reunion con el area).
  def({
    clave: 'descripcion_factura', etiqueta: 'Descripción según factura', seccion: 'producto', grupo: 'C', fila: 6,
    confianza: 'F', tipoDato: 'texto_largo', reglas: TODOS_O, maximo: 500,
    ayuda: 'Ej.: FILTRO ABSOLUTO -AIRE NUEVO',
  }),
  def({
    clave: 'uso', etiqueta: 'Uso', seccion: 'producto', grupo: 'C', fila: 7, confianza: 'F',
    tipoDato: 'texto_largo', reglas: TODOS_O, maximo: 2000,
    ayuda: 'Ej.: preparación de las superficies del lente oftálmico para la aplicación de recubrimientos',
    ayudaPorTipo: {
      REPUESTO: 'Ej.: Máquina: Aspiradora MEI, uso: aspirado de polvo',
      ACCESORIO: 'Ej.: Máquina: Máquina FOG ID, uso: sujetar plantilla de marcado',
      EQUIPO: 'Ej.: Máquina: Aspiradora MEI, uso: aspirado de polvo',
      MONTURA: 'Ej.: montura oftálmica para exhibir en tienda',
    },
  }),
  def({
    clave: 'funciones', etiqueta: 'Funciones', seccion: 'producto', grupo: 'C', fila: 8, confianza: 'F',
    tipoDato: 'texto_largo', reglas: TODOS_O, maximo: 2000,
    ayuda: 'Ej.: Sujetar, fijar el eje Z',
  }),
  def({
    clave: 'unidad_medida', etiqueta: 'Unidad de medida', seccion: 'producto', grupo: 'C', fila: 9, confianza: 'F',
    tipoDato: 'lista', catalogo: 'unidad_medida', reglas: TODOS_O, maximo: 100,
    ayuda: 'Ej.: Kilogramos, Unidades, Paquete',
  }),
  // ---- Detalle
  def({
    clave: 'materia_constitutiva', etiqueta: 'Materia constitutiva', seccion: 'detalle', grupo: 'C',
    fila: 10, confianza: 'S', tipoDato: 'texto_largo', reglas: r('O', 'O', 'P', 'O'), maximo: 2000,
    ayuda: 'Ej.: Tensioactivos aniónicos (3 %), Alcohol etoxilado (85 %), Agua',
  }),
  def({
    clave: 'aspecto_fisico', etiqueta: 'Aspecto físico', seccion: 'detalle', grupo: 'C', fila: 11, confianza: 'F',
    tipoDato: 'lista', catalogo: 'aspecto_fisico', reglas: TODOS_O, maximo: 100, noAplica: TEXTO_NO_APLICA,
  }),
  def({
    clave: 'marca', etiqueta: 'Marca', seccion: 'detalle', grupo: 'C', fila: 12, confianza: 'F', tipoDato: 'marca',
    reglas: TODOS_O, maximo: 200, ayuda: 'Ej.: NAGA',
  }),
  def({
    clave: 'pais_origen', etiqueta: 'País de origen', seccion: 'detalle', grupo: 'C', fila: 13, confianza: 'F',
    tipoDato: 'pais', reglas: TODOS_O, ayuda: 'Ej.: Francia',
  }),
  def({
    clave: 'fabricante', etiqueta: 'Fabricante', seccion: 'detalle', grupo: 'C', fila: 14, confianza: 'F',
    tipoDato: 'texto', reglas: TODOS_O, maximo: 200, ayuda: 'Ej.: NAGA',
  }),
  // Texto, o `{ mismo_fabricante: true }` (casilla «El proveedor es el mismo fabricante»): vinculado, no copiado.
  def({
    clave: 'proveedor', etiqueta: 'Proveedor', seccion: 'detalle', grupo: 'C', fila: 15, confianza: 'F',
    tipoDato: 'proveedor', reglas: TODOS_O, maximo: 200, ayuda: 'Ej.: Essilor International',
  }),
  def({
    clave: 'tipo_empaque', etiqueta: 'Tipo de empaque', seccion: 'detalle', grupo: 'C', fila: 16, confianza: 'F',
    tipoDato: 'lista', opciones: EMPAQUES, reglas: TODOS_O, maximo: 100,
    ayuda: 'Siempre aplica: si no viene en bidón ni en paquete, elige «Unidad».',
  }),
  // «Por cuanto»: aparece solo con bidon o paquete. Ej.: 20 litros, 10 kilos, 10 unidades.
  def({
    clave: 'cantidad_empaque', etiqueta: 'Contenido por empaque', seccion: 'detalle', grupo: 'C', fila: 34, confianza: 'F',
    tipoDato: 'texto', reglas: TODOS_O, maximo: 60, soloSi: { clave: 'tipo_empaque', valor: EMPAQUES_CON_CONTENIDO.join('|') },
    ayuda: 'Bidón: litros o kilos por bidón (ej.: 20 litros). Paquete: unidades por paquete (ej.: 10 unidades).',
  }),
  // Obligatoria donde aplica hoy (repuesto y accesorio); a la montura no le aplica.
  def({
    clave: 'maquina_destino', etiqueta: 'Máquina donde se instala', seccion: 'detalle', grupo: 'C', fila: 17,
    confianza: 'S', tipoDato: 'texto_largo', reglas: r('-', 'O', '-', 'O', '-'), maximo: 500,
    ayuda: 'Ej.: Aspiradora MEI',
  }),
  // Solo para equipos/instrumentos y «si aplica» (reunion 2026-11): opcional, con calendario.
  def({
    clave: 'fecha_fabricacion', etiqueta: 'Fecha de fabricación', seccion: 'detalle', grupo: 'C', fila: 20,
    confianza: 'F', tipoDato: 'fecha_fabricacion', reglas: r('-', '-', 'P', '-'),
    ayuda: 'Si aplica (instrumentos y equipos de medición). Elige la fecha en el calendario.',
  }),
  // ---- Especificaciones
  // Lo sabe el agente aduanero al clasificar (reunion 2026-11); si requiere RIM, Comercio Exterior sigue por fuera.
  def({
    clave: 'requiere_rim', etiqueta: '¿Requiere registro de importación (RIM)?', seccion: 'especificaciones', grupo: 'A',
    fila: 30, confianza: 'F', tipoDato: 'si_no', reglas: TODOS_O,
    ayuda: 'Lo responde la aduana al clasificar. Si es Sí, Comercio Exterior gestiona el registro por fuera de la plataforma.',
  }),
  def({
    clave: 'adjuntos', etiqueta: 'Foto', seccion: 'especificaciones', grupo: 'C', fila: 21, confianza: 'F',
    tipoDato: 'adjuntos', reglas: TODOS_P, escribible: false,
  }),
  def({
    clave: 'partida_arancelaria', etiqueta: 'Partida arancelaria', seccion: 'especificaciones', grupo: 'A', fila: 23,
    confianza: 'F', tipoDato: 'partida', reglas: TODOS_O, ayuda: 'Ej.: 8501.31.20.00',
  }),
  // Lo que a la aduana le falta saber del producto. Si escribe una solicitud, el area la contesta en `respuesta_area`;
  // si no le falta nada, marca «No es necesario por ahora / no aplica».
  def({
    clave: 'descripciones_minimas', etiqueta: 'Descripciones mínimas adicionales', seccion: 'especificaciones', grupo: 'A',
    fila: 24, confianza: 'F', tipoDato: 'texto_largo', reglas: TODOS_O, maximo: 5000,
    noAplica: 'No es necesario por ahora / no aplica',
    ayuda: 'Ej.: ¿El motor es de corriente alterna (AC) o continua (DC)? ¿Cuál es su amperaje?',
  }),
  def({
    clave: 'informacion_adicional', etiqueta: 'Información adicional', seccion: 'especificaciones', grupo: 'C', fila: 22,
    confianza: 'F', tipoDato: 'texto_largo', reglas: TODOS_P, maximo: 2000,
    ayuda: 'Información relevante que el área quiera añadir.',
  }),
  def({
    clave: 'restricciones', etiqueta: 'Restricciones', seccion: 'especificaciones', grupo: 'A', fila: 25, confianza: 'F',
    tipoDato: 'texto_largo', reglas: TODOS_O, maximo: 5000, noAplica: TEXTO_NO_APLICA,
  }),
  def({
    clave: 'clasificacion_finalizada', etiqueta: 'Clasificación finalizada', seccion: 'especificaciones', grupo: 'A',
    fila: 29, confianza: 'F', tipoDato: 'si_no', reglas: TODOS_O,
  }),
  // ---- Complementos de la aduana (D-08): se pintan en la zona de la aduana.
  def({
    clave: 'observaciones_aduana', etiqueta: 'Observaciones de la aduana', seccion: 'especificaciones',
    subbloque: 'complementos_aduana', grupo: 'A', fila: 26, confianza: 'F', tipoDato: 'texto_largo', reglas: TODOS_O,
    maximo: 2000, noAplica: TEXTO_NO_APLICA,
  }),
  // Respuesta del area a la solicitud de la aduana: se exige solo mientras haya una solicitud sin contestar (regla
  // propia en `completitud.ts`, no por `reglas`); por eso es `P` y no entra al contador del area.
  def({
    clave: 'respuesta_area', etiqueta: 'Respuesta del área', seccion: 'especificaciones', subbloque: 'complementos_aduana',
    grupo: 'C', fila: 32, confianza: 'F', tipoDato: 'respuesta', reglas: TODOS_P, maximo: 5000,
  }),
];

/**
 * Campos RETIRADOS (reunion con el area): no se muestran, no se escriben ni cuentan, pero su historial es inmutable y
 * se sigue leyendo con su etiqueta. No van en `CAMPOS`.
 */
export const CAMPOS_RETIRADOS: readonly CampoDef[] = [
  // La cantidad del RIM se gestiona por fuera de la plataforma (reunion 2026-11).
  def({
    clave: 'cantidad_rim', etiqueta: 'Cantidad', seccion: 'especificaciones', grupo: 'C', fila: 31, confianza: 'F',
    tipoDato: 'cantidad', reglas: NINGUNO, escribible: false,
  }),
  def({
    clave: 'valor_unitario', etiqueta: 'Valor unitario (USD)', seccion: 'especificaciones', grupo: 'C', fila: 18,
    confianza: 'F', tipoDato: 'valor_unitario', reglas: NINGUNO, escribible: false,
  }),
  def({
    clave: 'cantidad_a_radicar', etiqueta: 'Cantidad a radicar', seccion: 'especificaciones', grupo: 'C',
    fila: 19, confianza: 'F', tipoDato: 'cantidad', reglas: NINGUNO, escribible: false,
  }),
  def({
    clave: 'primer_clasificador', etiqueta: 'Primer clasificador', seccion: 'especificaciones',
    subbloque: 'complementos_aduana', grupo: 'A', fila: 27, confianza: 'S', tipoDato: 'clasificador', reglas: NINGUNO,
    escribible: false,
  }),
  def({
    clave: 'segundo_clasificador', etiqueta: 'Segundo clasificador', seccion: 'especificaciones',
    subbloque: 'complementos_aduana', grupo: 'A', fila: 28, confianza: 'S', tipoDato: 'clasificador', reglas: NINGUNO,
    escribible: false,
  }),
];

const POR_CLAVE = new Map([...CAMPOS, ...CAMPOS_RETIRADOS].map((c) => [c.clave, c]));

export function getCampo(clave: string): CampoDef | undefined {
  return POR_CLAVE.get(clave);
}

export function esVisible(campo: CampoDef, tipo: TipoProducto): boolean {
  return campo.reglas[tipo] !== '-';
}

/** El campo se pide en esta ficha: visible para el tipo y, si depende de otro, con el valor que lo activa. */
export function aplicaEnFicha(campo: CampoDef, tipo: TipoProducto, valores: Record<string, unknown>): boolean {
  if (!esVisible(campo, tipo)) return false;
  if (!campo.soloSi) return true;
  const actual = valores[campo.soloSi.clave];
  const validos = typeof campo.soloSi.valor === 'string' ? campo.soloSi.valor.split('|') : [campo.soloSi.valor];
  return validos.includes(actual as string);
}

export function obligatoriedadPara(campo: CampoDef, tipo: TipoProducto): Obligatoriedad {
  return campo.reglas[tipo];
}

export function ayudaPara(campo: CampoDef, tipo: TipoProducto): string {
  return campo.ayudaPorTipo?.[tipo] ?? campo.ayuda;
}

/** Campos visibles para un tipo, en el orden de la pantalla. */
export function camposPantalla(tipo: TipoProducto): CampoDef[] {
  return CAMPOS.filter((c) => esVisible(c, tipo));
}

/**
 * Los `O` del grupo cliente: lo que el area debe llenar para ver la seccion en verde (D-26). Con `valores`, solo los
 * que aplican en esa ficha (el contenido por empaque cuenta solo con bidon o paquete).
 */
export function camposObligatoriosCliente(tipo: TipoProducto, seccion?: Seccion, valores?: Record<string, unknown>): CampoDef[] {
  return CAMPOS.filter(
    (c) =>
      c.grupo === 'C' &&
      c.reglas[tipo] === 'O' &&
      c.tipoDato !== 'calculado' &&
      c.tipoDato !== 'adjuntos' &&
      (seccion === undefined || c.seccion === seccion) &&
      (valores === undefined || aplicaEnFicha(c, tipo, valores)),
  );
}

/**
 * Los `O` del grupo aduana: se cuentan aparte (contador "De la aduana"). Partida, descripciones minimas adicionales,
 * restricciones, observaciones y clasificacion finalizada.
 */
export function camposObligatoriosAduana(tipo: TipoProducto): CampoDef[] {
  return CAMPOS.filter((c) => c.grupo === 'A' && c.reglas[tipo] === 'O');
}

/** Columnas promovidas de `referencia` que `aplicarEscritura` mantiene (6.4). */
export const COLUMNA_PROMOVIDA: Readonly<Record<string, 'codigo' | 'nombre_producto' | 'tipo_producto' | 'partida' | 'fecha_solicitud'>> = {
  codigo: 'codigo',
  nombre_producto: 'nombre_producto',
  tipo_producto: 'tipo_producto',
  partida_arancelaria: 'partida',
  fecha_solicitud: 'fecha_solicitud',
};
