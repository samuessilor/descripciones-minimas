/**
 * Columnas de la hoja `Base` (SPEC 15.1) mas la autoria por seccion (se pidio en el encargo; el SPEC la dejaba para la
 * hoja Historial). Los encabezados son legibles, en espanol y con tildes. La reunion con el area (2026-10-29) quito
 * valor unitario, cantidad a radicar y los clasificadores, y agrego el area responsable, el RIM, su cantidad y la respuesta
 * del area.
 */
export type TipoColumna = 'texto' | 'texto_largo' | 'numero' | 'fecha' | 'fechahora' | 'estado';

export interface ColumnaBase {
  clave: string;
  encabezado: string;
  ancho: number;
  tipo: TipoColumna;
}

export const COLUMNAS_BASE: readonly ColumnaBase[] = [
  { clave: 'codigo', encabezado: 'Código', ancho: 18, tipo: 'texto' },
  { clave: 'nombre', encabezado: 'Nombre del producto', ancho: 28, tipo: 'texto' },
  { clave: 'tipo', encabezado: 'Tipo de producto', ancho: 16, tipo: 'texto' },
  { clave: 'area_responsable', encabezado: 'Área responsable', ancho: 16, tipo: 'texto' },
  { clave: 'estado', encabezado: 'Estado', ancho: 15, tipo: 'estado' },
  { clave: 'etiqueta', encabezado: 'Etiqueta de estado', ancho: 24, tipo: 'texto' },
  { clave: 'fecha_solicitud', encabezado: 'Fecha de solicitud', ancho: 16, tipo: 'fecha' },
  { clave: 'dias', encabezado: 'Días en gestión', ancho: 12, tipo: 'numero' },
  { clave: 'creada_por', encabezado: 'Creada por', ancho: 24, tipo: 'texto' },
  { clave: 'descripcion_factura', encabezado: 'Descripción según factura', ancho: 40, tipo: 'texto_largo' },
  { clave: 'uso', encabezado: 'Uso', ancho: 40, tipo: 'texto_largo' },
  { clave: 'funciones', encabezado: 'Funciones', ancho: 40, tipo: 'texto_largo' },
  { clave: 'unidad_medida', encabezado: 'Unidad de medida', ancho: 16, tipo: 'texto' },
  { clave: 'materia_constitutiva', encabezado: 'Materia constitutiva', ancho: 40, tipo: 'texto_largo' },
  { clave: 'aspecto_fisico', encabezado: 'Aspecto físico', ancho: 16, tipo: 'texto' },
  { clave: 'marca', encabezado: 'Marca', ancho: 20, tipo: 'texto' },
  { clave: 'pais_origen', encabezado: 'País de origen', ancho: 18, tipo: 'texto' },
  { clave: 'fabricante', encabezado: 'Fabricante', ancho: 24, tipo: 'texto' },
  { clave: 'proveedor', encabezado: 'Proveedor', ancho: 24, tipo: 'texto' },
  { clave: 'tipo_empaque', encabezado: 'Tipo de empaque', ancho: 20, tipo: 'texto' },
  { clave: 'cantidad_empaque', encabezado: 'Contenido por empaque', ancho: 22, tipo: 'texto' },
  { clave: 'maquina_destino', encabezado: 'Máquina de destino', ancho: 26, tipo: 'texto_largo' },
  { clave: 'requiere_rim', encabezado: 'Requiere RIM', ancho: 12, tipo: 'texto' },
  { clave: 'fecha_fabricacion', encabezado: 'Fecha de fabricación', ancho: 20, tipo: 'fecha' },
  { clave: 'fotos', encabezado: 'Fotos', ancho: 10, tipo: 'texto' },
  { clave: 'informacion_adicional', encabezado: 'Información adicional', ancho: 40, tipo: 'texto_largo' },
  // Partida, descripciones minimas y restricciones en el orden del F-ADI-30.
  // Solo la partida FINAL (ficha clasificada), igual que el listado (L1); en las pendientes queda en blanco.
  { clave: 'partida', encabezado: 'Partida arancelaria final', ancho: 18, tipo: 'texto' },
  { clave: 'descripciones_minimas', encabezado: 'Descripciones mínimas adicionales', ancho: 60, tipo: 'texto_largo' },
  { clave: 'respuesta_area', encabezado: 'Respuesta del área', ancho: 50, tipo: 'texto_largo' },
  { clave: 'restricciones', encabezado: 'Restricciones', ancho: 50, tipo: 'texto_largo' },
  { clave: 'observaciones_aduana', encabezado: 'Observaciones de la aduana', ancho: 36, tipo: 'texto_largo' },
  { clave: 'finalizada', encabezado: 'Clasificación finalizada', ancho: 14, tipo: 'texto' },
  { clave: 'fecha_clasificacion', encabezado: 'Fecha de clasificación', ancho: 18, tipo: 'fecha' },
  { clave: 'pendiente_con', encabezado: 'Pendiente con', ancho: 26, tipo: 'texto' },
  { clave: 'actualizada', encabezado: 'Última actualización', ancho: 20, tipo: 'fechahora' },
  { clave: 'producto_por', encabezado: 'Producto: última edición por', ancho: 24, tipo: 'texto' },
  { clave: 'producto_en', encabezado: 'Producto: fecha de última edición', ancho: 20, tipo: 'fechahora' },
  { clave: 'detalle_por', encabezado: 'Detalle: última edición por', ancho: 24, tipo: 'texto' },
  { clave: 'detalle_en', encabezado: 'Detalle: fecha de última edición', ancho: 20, tipo: 'fechahora' },
  { clave: 'especificaciones_por', encabezado: 'Especificaciones: última edición por', ancho: 24, tipo: 'texto' },
  { clave: 'especificaciones_en', encabezado: 'Especificaciones: fecha de última edición', ancho: 20, tipo: 'fechahora' },
];

/** Colores de la columna Estado (SPEC 15.1): el amarillo del formato de la agencia y el verde de Excel (S-17). */
export const RELLENO_AMARILLO = 'FFFFFFA6';
export const RELLENO_VERDE = 'FFC6EFCE';

/**
 * Hoja `Resumen de estado`: una fila por referencia con lo que importa para seguirla (estado, dias en gestion, que tan
 * completa va cada parte y de quien falta). Las claves `resumen_*` las calcula `filas.ts`; el resto son las mismas de `Base`.
 */
export const COLUMNAS_RESUMEN: readonly ColumnaBase[] = [
  { clave: 'codigo', encabezado: 'Código', ancho: 18, tipo: 'texto' },
  { clave: 'nombre', encabezado: 'Nombre del producto', ancho: 30, tipo: 'texto' },
  { clave: 'tipo', encabezado: 'Tipo de producto', ancho: 16, tipo: 'texto' },
  { clave: 'area_responsable', encabezado: 'Área responsable', ancho: 16, tipo: 'texto' },
  { clave: 'estado', encabezado: 'Estado', ancho: 15, tipo: 'estado' },
  { clave: 'etiqueta', encabezado: 'Etiqueta de estado', ancho: 24, tipo: 'texto' },
  { clave: 'fecha_solicitud', encabezado: 'Fecha de solicitud', ancho: 16, tipo: 'fecha' },
  { clave: 'dias', encabezado: 'Días en gestión', ancho: 12, tipo: 'numero' },
  { clave: 'resumen_producto', encabezado: 'Producto', ancho: 14, tipo: 'texto' },
  { clave: 'resumen_detalle', encabezado: 'Detalle', ancho: 14, tipo: 'texto' },
  { clave: 'resumen_especificaciones', encabezado: 'Especificaciones', ancho: 20, tipo: 'texto' },
  { clave: 'resumen_aduana', encabezado: 'Aduana', ancho: 14, tipo: 'texto' },
  { clave: 'resumen_faltan_area', encabezado: 'Campos que faltan del área', ancho: 16, tipo: 'numero' },
  { clave: 'resumen_faltan_aduana', encabezado: 'Campos que faltan de la aduana', ancho: 18, tipo: 'numero' },
  { clave: 'pendiente_con', encabezado: 'Pendiente con (de quién falta)', ancho: 30, tipo: 'texto' },
  { clave: 'actualizada', encabezado: 'Última actualización', ancho: 20, tipo: 'fechahora' },
];

/** Hoja `Historial`: un cambio de campo por fila (ver `historial.ts`). La fecha va en hora de Bogota. */
export const COLUMNAS_HISTORIAL: readonly ColumnaBase[] = [
  { clave: 'codigo', encabezado: 'Código', ancho: 18, tipo: 'texto' },
  { clave: 'nombre', encabezado: 'Nombre del producto', ancho: 28, tipo: 'texto' },
  { clave: 'campo', encabezado: 'Campo', ancho: 28, tipo: 'texto' },
  { clave: 'evento', encabezado: 'Evento', ancho: 14, tipo: 'texto' },
  { clave: 'anterior', encabezado: 'Valor anterior', ancho: 40, tipo: 'texto_largo' },
  { clave: 'nuevo', encabezado: 'Valor nuevo', ancho: 40, tipo: 'texto_largo' },
  { clave: 'quien', encabezado: 'Quién', ancho: 24, tipo: 'texto' },
  { clave: 'cuando', encabezado: 'Fecha y hora (Bogotá)', ancho: 20, tipo: 'fechahora' },
  { clave: 'motivo', encabezado: 'Motivo', ancho: 36, tipo: 'texto_largo' },
];
