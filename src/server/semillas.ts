/**
 * Semillas de DESARROLLO (solo con NODE_ENV=development o pruebas): organizaciones, usuarios y
 * referencias de ejemplo CLARAMENTE MARCADOS como `[DESARROLLO]`. Los correos usan el TLD
 * reservado `.invalid`, asi nada sale a una persona real. Todas comparten la contrasena `CLAVE_DESARROLLO`.
 *
 * Datos SINTETICOS (D-24, A9): las referencias estan inspiradas en la estructura de los
 * ejemplos de la reunion (un insumo tipo "NSR E1" y un repuesto tipo "motor Panasonic serie E
 * 400 W") pero con codigos `TEST-000n` y valores inventados; no se copia ningun dato de los Excel.
 */
import { and, eq } from 'drizzle-orm';
import { account, asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import { sembrarDatosMaestros } from '@/db/semillas/datos-maestros';
import type { Db } from '@/db/tipos';
import { AREAS } from '@/dominio/areas';
import { normalizarTexto } from '@/dominio/normalizacion';
import type { Rol } from '@/dominio/permisos';
import { hashearClave } from './claves';
import { CLAVE_DESARROLLO } from './cuentas-demo';
import { cargarActorPorId, type Actor } from './politicas/actor';
import { crearReferencia } from './acciones/crear-referencia';
import { guardarCampo } from './acciones/guardar-campo';
import { sembrarEjemplos } from './semillas-ejemplos';

export const ORG_INTERNA = 'EssilorLuxottica [DESARROLLO]';
export const ORG_AGENCIA_A = 'Agencia Demo A [DESARROLLO]';
export const ORG_AGENCIA_B = 'Agencia Demo B [DESARROLLO]';

export const USUARIOS_DESARROLLO: ReadonlyArray<{
  email: string;
  nombre: string;
  rol: Rol;
  org: string;
  area?: string;
}> = [
  { email: 'admin@desarrollo.invalid', nombre: 'Samuel Galeano [DESARROLLO]', rol: 'admin', org: ORG_INTERNA },
  { email: 'supervisor@desarrollo.invalid', nombre: 'Angie Supervisora [DESARROLLO]', rol: 'supervisor', org: ORG_INTERNA },
  { email: 'solicitante@desarrollo.invalid', nombre: 'Edgar Solicitante [DESARROLLO]', rol: 'solicitante', org: ORG_INTERNA, area: 'Consumibles' },
  { email: 'solicitante2@desarrollo.invalid', nombre: 'Carla Solicitante [DESARROLLO]', rol: 'solicitante', org: ORG_INTERNA, area: 'Mantenimiento' },
  { email: 'lector@desarrollo.invalid', nombre: 'Lucía Lectora [DESARROLLO]', rol: 'lector', org: ORG_INTERNA },
  // Una cuenta general por empresa de aduana (C3): la de cada agencia demo.
  { email: 'aduana-a@desarrollo.invalid', nombre: 'Andrés Aduana A [DESARROLLO]', rol: 'aduana', org: ORG_AGENCIA_A },
  { email: 'aduana-b@desarrollo.invalid', nombre: 'Beatriz Aduana B [DESARROLLO]', rol: 'aduana', org: ORG_AGENCIA_B },
  // Una cuenta general por area (C1): ven en «Para mí» lo de su area aunque nadie se lo haya enviado.
  ...AREAS.map((area) => ({
    email: `${normalizarTexto(area)}@desarrollo.invalid`,
    nombre: `${area} [DESARROLLO]`,
    rol: 'solicitante' as const,
    org: ORG_INTERNA,
    area,
  })),
];

async function actorPorEmail(db: Db, email: string): Promise<Actor> {
  const [u] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, email)).limit(1);
  if (!u) throw new Error(`Semilla: no existe el usuario ${email}`);
  const a = await cargarActorPorId(db, u.id);
  if (!a) throw new Error(`Semilla: el usuario ${email} no esta activo`);
  return a;
}

async function escribir(db: Db, actor: Actor, referenciaId: string, campo: string, valor: unknown): Promise<void> {
  const [f] = await db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, referenciaId)).limit(1);
  const version = f?.datos?.[campo]?.n ?? 0;
  await guardarCampo({ db, actor }, { referenciaId, campo, valor, versionEsperada: version });
}

/** Crea organizaciones, usuarios y 3 referencias de ejemplo. Idempotente. */
export async function sembrarDesarrollo(db: Db): Promise<void> {
  const [existe] = await db.select({ id: organizacion.id }).from(organizacion).where(eq(organizacion.nombre, ORG_INTERNA)).limit(1);
  if (existe) return;

  const orgs = await db
    .insert(organizacion)
    .values([
      { nombre: ORG_INTERNA, tipo: 'interna' },
      { nombre: ORG_AGENCIA_A, tipo: 'agencia' },
      { nombre: ORG_AGENCIA_B, tipo: 'agencia' },
    ])
    .returning();
  const org = new Map(orgs.map((o) => [o.nombre, o]));

  const creados = await db
    .insert(usuario)
    .values(
      USUARIOS_DESARROLLO.map((u) => {
        const o = org.get(u.org);
        if (!o) throw new Error(`Semilla: falta la organizacion ${u.org}`);
        return {
          nombre: u.nombre,
          // Se entra con el usuario (`consumibles`, `aduana-a`, ...) y la contrasena de ejemplo.
          username: u.email.split('@')[0] as string,
          email: u.email,
          organizacionId: o.id,
          organizacionTipo: o.tipo,
          rol: u.rol,
          area: u.area ?? null,
        };
      }),
    )
    .returning({ id: usuario.id });
  // Un solo hash para todas: cada hash ya lleva su propia sal y las cuentas de ejemplo comparten contrasena a proposito.
  const hash = await hashearClave(CLAVE_DESARROLLO);
  await db.insert(account).values(creados.map((c) => ({ accountId: c.id, providerId: 'credential', userId: c.id, password: hash })));

  const solicitante = await actorPorEmail(db, 'solicitante@desarrollo.invalid');
  const solicitante2 = await actorPorEmail(db, 'solicitante2@desarrollo.invalid');
  const aduanaA = await actorPorEmail(db, 'aduana-a@desarrollo.invalid');

  // 1) Insumo de ejemplo (estilo "NSR E1"): casi completo, amarillo.
  const insumo = await crearReferencia(
    { db, actor: solicitante },
    { codigo: 'TEST-0001', nombreProducto: 'NSR E1 (ejemplo)', tipoProducto: 'INSUMO' },
  );
  const datosInsumo: Array<[string, unknown]> = [
    ['descripcion_factura', 'LIMPIADOR DE SUPERFICIES (ejemplo)'],
    ['uso', 'Preparar la superficie del lente antes del recubrimiento (ejemplo).'],
    ['funciones', 'Retira residuos de la superficie (ejemplo).'],
    ['unidad_medida', 'Kilogramos'],
    ['materia_constitutiva', 'Mezcla de alcoholes y tensioactivos (ejemplo)\nAgua'],
    ['aspecto_fisico', 'Líquido'],
    ['marca', { texto: 'MARCA-DEMO' }],
    ['pais_origen', 'FR'],
    ['fabricante', 'Fabricante Demo SA'],
    ['proveedor', 'Proveedor Demo SA'],
    ['tipo_empaque', 'Bidón'],
    ['cantidad_empaque', '20 kg'],
    ['informacion_adicional', 'PRUEBA: datos de ejemplo, no representan una mercancía real.'],
  ];
  for (const [campo, valor] of datosInsumo) await escribir(db, solicitante, insumo.id, campo, valor);
  // El RIM lo responde la aduana al clasificar (reunion 2026-11): el solicitante no lo escribe; la semilla lo pone con el admin.
  await escribir(db, await actorPorEmail(db, 'admin@desarrollo.invalid'), insumo.id, 'requiere_rim', 'SI');

  // 2) Repuesto de ejemplo (estilo "motor serie E 400 W") enviado a la Agencia A: la agencia B no lo ve.
  const repuesto = await crearReferencia(
    { db, actor: solicitante2 },
    { codigo: 'TEST-0002', nombreProducto: 'Motor serie E 400 W (ejemplo)', tipoProducto: 'REPUESTO' },
  );
  const datosRepuesto: Array<[string, unknown]> = [
    ['descripcion_factura', 'MOTOR SERIE E 400 W SIN FRENO (ejemplo)'],
    ['uso', 'Mover el eje de una máquina de ejemplo.'],
    ['funciones', 'Gira el eje (ejemplo).'],
    ['maquina_destino', 'Máquina demo 641'],
    ['materia_constitutiva', 'Aluminio, cobre (ejemplo)'],
    ['marca', { texto: 'MARCA-DEMO' }],
    ['informacion_adicional', 'PRUEBA: la partida y la clasificación de este ejemplo no representan una clasificación real.'],
  ];
  for (const [campo, valor] of datosRepuesto) await escribir(db, solicitante2, repuesto.id, campo, valor);

  // Semilla minima (la que esperan las pruebas): la asignacion se siembra directa, sin aviso. Las referencias EJ-*
  // (`semillas-ejemplos.ts`) si pasan por `enviarA`.
  await db.update(referencia).set({ estado: 'EN_GESTION' }).where(eq(referencia.id, repuesto.id));
  await db.insert(asignacion).values({
    referenciaId: repuesto.id,
    deUsuarioId: solicitante2.usuarioId,
    aUsuarioId: aduanaA.usuarioId,
    pedido: 'clasificar',
    mensaje: '[DESARROLLO] asignación de ejemplo',
    estado: 'pendiente',
  });

  // 3) Borrador de ejemplo, recien creado.
  await crearReferencia(
    { db, actor: solicitante },
    { codigo: 'TEST-0003', nombreProducto: 'Filtro de aire (ejemplo)', tipoProducto: 'REPUESTO' },
  );

  // Marca para consultas rapidas: la asignacion existe.
  const [a] = await db
    .select({ id: asignacion.id })
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, repuesto.id), eq(asignacion.aUsuarioId, aduanaA.usuarioId)))
    .limit(1);
  if (!a) throw new Error('Semilla: no se creo la asignacion de ejemplo');
}

/**
 * `desarrollo`: usuarios y las 3 referencias TEST-*. `ejemplos` (por defecto si): ademas las 12 referencias EJ-* con
 * historial, comentarios y avisos. Las pruebas E2E piden `ejemplos: false` (se escribieron contra la semilla minima).
 */
export async function sembrarTodo(db: Db, opciones: { desarrollo: boolean; ejemplos?: boolean }): Promise<void> {
  await sembrarDatosMaestros(db);
  if (opciones.desarrollo) {
    await sembrarDesarrollo(db);
    if (opciones.ejemplos ?? true) await sembrarEjemplos(db);
  }
}
