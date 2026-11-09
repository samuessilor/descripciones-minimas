/**
 * Datos maestros: siempre se cargan (SPEC 6.3 "Semillas", Apendice A). Son DATOS DE REFERENCIA,
 * no datos de producto, y pueden versionarse: provienen del formato F-ADI-30 v1.0 (partidas y
 * restricciones `IC!O`, con sus errores de origen) y de los catalogos de la reunion. Las descripciones
 * minimas NO se siembran: la aduana las escribe en cada referencia (DESVIACIONES, 2026-10-27).
 * Idempotente: se puede ejecutar varias veces.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { catalogoItem, partidaArancelaria, restriccionPlantilla } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

/** «Unidad» paso a «Unidades» y se agrego «Paquete» (reunion con el area, 2026-10-29). */
export const UNIDADES_MEDIDA = ['Litros', 'Kilogramos', 'Galones', 'Gramos', 'Unidades', 'Paquete'] as const;
export const ASPECTOS_FISICOS = ['Líquido', 'Sólido', 'Polvo', 'Gel', 'Pasta', 'Gas', 'Otro'] as const;
export const SUGERENCIAS_EMPAQUE = ['Bidón', 'Galón', 'Bolsa'] as const;

const TEXTO_SIN_RESTRICCION =
  'Sin Restricciones\n(Siempre y cuando la mercancía sea nueva, no sea saldo ni presente condiciones especiales de mercado)';

export const RESTRICCIONES: ReadonlyArray<{ codigo: string; texto: string }> = [
  { codigo: 'RES-SIN', texto: TEXTO_SIN_RESTRICCION },
  {
    codigo: 'RES-8537.10.10.00',
    texto:
      'Para está subpartida no aplica el umbral en unidades para el sistema de recolección y gestión de RAEE vigilado por la ANLA.\n\nRETIE no aplica al PLC. No aplica cuando se fabriquen o importen exclusivamente para incorporados como parte integral de automotores, navíos, aeronaves, electrodomésticos, equipos de electromedicina, elementos para señales de telecomunicaciones, sistemas de radio y demás aparatos, máquinas y herramientas.',
  },
  {
    codigo: 'RES-8504.40.90.90',
    texto:
      'El Registro de productores y comercializadores de aparatos eléctricos y electrónicos (RPCAEE) es obligatorio a partir de 1.000 unidades. \n\nExcluido de RETIE y RETILAP ya que el uso de este elemento no esta contemplado en dichos reglamentos para control.',
  },
  {
    codigo: 'RES-8501.31.20.00',
    texto:
      'Para está subpartida no aplica el umbral en unidades para el sistema de recolección y gestión de RAEE vigilado por la ANLA.\n\nSe excluyen de RETIE los motores de tensiones menores o iguales a 25 V c.a. y 50 V c.c. (Nota marginal de partida tabla 2.1.2.1.b res. 40284/2026).\n\nExcluído de RETIQ  ya que este tipo de motor de corriente continua no se encuentra en la lista de dispositivos (Motores eléctricos monofásicos/trifasicos de inducción tipo jaula de ardilla, de corriente alterna -tabla 3.1.a) que debe cumplir con este reglamento.',
  },
];

/**
 * Partida -> restriccion (Apendice A; 7 partidas verificadas contra IC!M15:O24). La descripcion es la familia de
 * mercancia del F-ADI-30 y sirve para buscar la partida por palabra.
 */
export const PARTIDAS: ReadonlyArray<{ codigo: string; descripcion: string; restriccion: string }> = [
  { codigo: '8421.39.90.00', descripcion: 'Filtros y equipos de filtrado', restriccion: 'RES-SIN' },
  { codigo: '8479.90.00.00', descripcion: 'Partes y piezas de máquinas', restriccion: 'RES-SIN' },
  { codigo: '8466.92.00.00', descripcion: 'Partes y piezas de máquinas', restriccion: 'RES-SIN' },
  { codigo: '8466.20.00.00', descripcion: 'Partes y piezas de máquinas', restriccion: 'RES-SIN' },
  { codigo: '8537.10.10.00', descripcion: 'Aparatos eléctricos con tensión', restriccion: 'RES-8537.10.10.00' },
  { codigo: '8504.40.90.90', descripcion: 'Aparatos eléctricos genéricos', restriccion: 'RES-8504.40.90.90' },
  { codigo: '8501.31.20.00', descripcion: 'Motores eléctricos', restriccion: 'RES-8501.31.20.00' },
];

export async function sembrarDatosMaestros(ej: Ejecutor): Promise<void> {
  // Catalogos
  const items = [
    ...UNIDADES_MEDIDA.map((valor, i) => ({ catalogo: 'unidad_medida', valor, orden: i })),
    ...ASPECTOS_FISICOS.map((valor, i) => ({ catalogo: 'aspecto_fisico', valor, orden: i })),
    ...SUGERENCIAS_EMPAQUE.map((valor, i) => ({ catalogo: 'sugerencia_empaque', valor, orden: i })),
  ];
  const nuevos = await ej.insert(catalogoItem).values(items).onConflictDoNothing().returning({ catalogo: catalogoItem.catalogo, valor: catalogoItem.valor });
  // Una base sembrada antes tenia «Unidad»: al aparecer «Unidades» por primera vez, «Unidad» deja de ofrecerse. Las fichas
  // que ya la tenian la conservan (un valor guardado sigue siendo valido aunque salga de la lista) y el admin la puede
  // reactivar en Catalogos.
  if (nuevos.some((n) => n.catalogo === 'unidad_medida' && n.valor === 'Unidades')) {
    await ej
      .update(catalogoItem)
      .set({ activo: false })
      .where(and(eq(catalogoItem.catalogo, 'unidad_medida'), eq(catalogoItem.valor, 'Unidad')));
  }

  // Restricciones
  await ej.insert(restriccionPlantilla).values(RESTRICCIONES.map((r) => ({ codigo: r.codigo, texto: r.texto }))).onConflictDoNothing();
  const restricciones = await ej.select().from(restriccionPlantilla).where(inArray(restriccionPlantilla.codigo, RESTRICCIONES.map((r) => r.codigo)));
  const restriccionId = new Map(restricciones.map((r) => [r.codigo, r.id]));

  // Partidas
  await ej
    .insert(partidaArancelaria)
    .values(
      PARTIDAS.map((p) => ({
        codigo: p.codigo,
        descripcion: p.descripcion,
        restriccionId: restriccionId.get(p.restriccion) as string,
        origen: 'semilla',
      })),
    )
    .onConflictDoNothing();
}

/** Para pruebas: confirma que los datos maestros estan cargados. */
export async function datosMaestrosCargados(ej: Ejecutor): Promise<boolean> {
  const r = await ej.select({ id: catalogoItem.id }).from(catalogoItem).where(eq(catalogoItem.catalogo, 'unidad_medida')).limit(1);
  return r.length > 0;
}
