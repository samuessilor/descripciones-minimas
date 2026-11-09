/**
 * Ayudas de las pruebas de integracion: una instancia PGlite EN MEMORIA por archivo de prueba
 * (D-30), con migraciones y datos maestros, y un escenario de organizaciones y usuarios.
 * PGlite es de una sola conexion: aqui se prueba LOGICA, no carreras reales (RV-24); las
 * pruebas de concurrencia real viven en tests/db-real.
 */
import { eq } from 'drizzle-orm';
import { asignacion, organizacion, referencia, usuario } from '@/db/esquema';
import { crearConexion, type Conexion } from '@/db/conexion';
import { migrar } from '@/db/migrar';
import { sembrarDatosMaestros } from '@/db/semillas/datos-maestros';
import type { Db } from '@/db/tipos';
import type { Rol } from '@/dominio/permisos';
import type { TipoProducto } from '@/dominio/campos';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { cargarActorPorId, type Actor, type Contexto } from '@/server/politicas/actor';

export async function nuevaBd(): Promise<Conexion> {
  const c = crearConexion({ pgliteDir: 'memory://' });
  await migrar(c);
  await sembrarDatosMaestros(c.db);
  return c;
}

export interface Escenario {
  c: Conexion;
  db: Db;
  orgInterna: string;
  orgA: string;
  orgB: string;
  admin: Actor;
  edward: Actor; // solicitante
  charles: Actor; // solicitante
  lector: Actor;
  brian: Actor; // aduana, agencia A
  brianB: Actor; // aduana, agencia B
  ctx(actor: Actor, ahora?: Date): Contexto;
}

async function crearUsuario(db: Db, nombre: string, email: string, rol: Rol, orgId: string, tipo: 'interna' | 'agencia') {
  const [u] = await db
    .insert(usuario)
    .values({ nombre, email, rol, organizacionId: orgId, organizacionTipo: tipo })
    .returning({ id: usuario.id });
  const a = await cargarActorPorId(db, (u as { id: string }).id);
  if (!a) throw new Error('actor no cargado');
  return a;
}

export async function nuevoEscenario(): Promise<Escenario> {
  const c = await nuevaBd();
  const db = c.db;
  const orgs = await db
    .insert(organizacion)
    .values([
      { nombre: 'Interna', tipo: 'interna' },
      { nombre: 'Agencia A', tipo: 'agencia' },
      { nombre: 'Agencia B', tipo: 'agencia' },
    ])
    .returning();
  const interna = orgs.find((o) => o.nombre === 'Interna')!;
  const a = orgs.find((o) => o.nombre === 'Agencia A')!;
  const b = orgs.find((o) => o.nombre === 'Agencia B')!;

  const admin = await crearUsuario(db, 'Ana Admin', 'ana@prueba.invalid', 'admin', interna.id, 'interna');
  const edward = await crearUsuario(db, 'Edward', 'edward@prueba.invalid', 'solicitante', interna.id, 'interna');
  const charles = await crearUsuario(db, 'Charles', 'charles@prueba.invalid', 'solicitante', interna.id, 'interna');
  const lector = await crearUsuario(db, 'Lucia Lectora', 'lucia@prueba.invalid', 'lector', interna.id, 'interna');
  const brian = await crearUsuario(db, 'Brian', 'brian@prueba.invalid', 'aduana', a.id, 'agencia');
  const brianB = await crearUsuario(db, 'Brenda', 'brenda@prueba.invalid', 'aduana', b.id, 'agencia');

  return {
    c,
    db,
    orgInterna: interna.id,
    orgA: a.id,
    orgB: b.id,
    admin,
    edward,
    charles,
    lector,
    brian,
    brianB,
    ctx: (actor, ahora) => ({ db, actor, ...(ahora ? { ahora } : {}) }),
  };
}

let contador = 0;

/** Crea una ficha (como `edward` por defecto) y devuelve su id. */
export async function nuevaFicha(
  e: Escenario,
  opciones: { tipo?: TipoProducto; actor?: Actor; codigo?: string; nombre?: string } = {},
): Promise<string> {
  contador += 1;
  const r = await crearReferencia(e.ctx(opciones.actor ?? e.edward), {
    codigo: opciones.codigo ?? `TEST-${String(contador).padStart(4, '0')}`,
    nombreProducto: opciones.nombre ?? `Producto de prueba ${contador}`,
    tipoProducto: opciones.tipo ?? 'INSUMO',
  });
  return r.id;
}

/** Envia la ficha a una persona de aduana (asignacion directa; `enviarA` llega en H3). */
export async function asignarAAduana(e: Escenario, referenciaId: string, a: Actor, de: Actor = e.edward): Promise<void> {
  await e.db.update(referencia).set({ estado: 'EN_GESTION' }).where(eq(referencia.id, referenciaId));
  await e.db.insert(asignacion).values({
    referenciaId,
    deUsuarioId: de.usuarioId,
    aUsuarioId: a.usuarioId,
    pedido: 'clasificar',
    estado: 'pendiente',
  });
}

export async function versionDe(db: Db, referenciaId: string, campo: string): Promise<number> {
  const [f] = await db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, referenciaId)).limit(1);
  return f?.datos?.[campo]?.n ?? 0;
}

/** Cadena completa de mensajes de un error (Drizzle envuelve el error real en `cause`). */
export function mensajeCompleto(err: unknown): string {
  const partes: string[] = [];
  let actual: unknown = err;
  for (let i = 0; i < 6 && actual; i++) {
    const x = actual as { message?: string; cause?: unknown };
    if (x.message) partes.push(x.message);
    actual = x.cause;
  }
  return partes.join(' | ');
}

/** Espera que la promesa falle y que algun mensaje de la cadena cumpla el patron. */
export async function rechazaCon(promesa: PromiseLike<unknown>, patron: RegExp): Promise<void> {
  let fallo: unknown;
  try {
    await promesa;
  } catch (e) {
    fallo = e;
  }
  if (fallo === undefined) throw new Error(`se esperaba un error que cumpliera ${patron} y no fallo`);
  const msg = mensajeCompleto(fallo);
  if (!patron.test(msg)) throw new Error(`el error no cumple ${patron}: ${msg}`);
}
