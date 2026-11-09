/**
 * SOLO DESARROLLO: prepara una referencia de ejemplo para las pruebas E2E del lado aduana: la crea como el
 * solicitante de desarrollo, la llena (datos inventados, marcados como ejemplo) y la envia a la agencia A
 * (`enviarA` es del hito H3; aqui se siembra la asignacion directa igual que hacen las semillas).
 *
 * Cuerpo: `{ codigo, nombre?, tipo?, llena?, enviar? }`. Responde `{ ok, id }`.
 */
import { eq } from 'drizzle-orm';
import { asignacion, referencia, usuario } from '@/db/esquema';
import { getDb } from '@/db';
import { esVisible, getCampo, type TipoProducto } from '@/dominio/campos';
import { crearReferencia } from '@/server/acciones/crear-referencia';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { json, soloDesarrollo } from '@/server/http';
import { cargarActorPorId } from '@/server/politicas/actor';

export const dynamic = 'force-dynamic';

const DATOS: Array<[string, unknown]> = [
  ['descripcion_factura', 'MOTOR SERIE E 400 W SIN FRENO (ejemplo)'],
  ['uso', 'Mover el eje de una máquina de ejemplo.'],
  ['funciones', 'Gira el eje (ejemplo).'],
  ['unidad_medida', 'Unidades'],
  ['materia_constitutiva', 'Aluminio, cobre (ejemplo)'],
  ['aspecto_fisico', 'Sólido'],
  ['marca', { texto: 'MARCA-DEMO' }],
  ['pais_origen', 'FR'],
  ['fabricante', 'Fabricante Demo SA'],
  ['proveedor', 'Proveedor Demo SA'],
  ['reembolsable', 'No'],
  ['tipo_empaque', 'Unidad'],
  // `requiere_rim` lo responde la aduana (reunion 2026-11): la ficha de desarrollo llega sin responder.
  // Obligatoria para repuesto y equipo (D5); en los demas tipos no aplica y se salta.
  ['maquina_destino', 'Máquina de ejemplo (ejemplo)'],
];

export async function POST(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const db = getDb();
  const e = (await request.json().catch(() => ({}))) as { codigo?: string; nombre?: string; tipo?: TipoProducto; llena?: boolean; enviar?: boolean };
  if (!e.codigo || !/^TEST-[A-Z0-9-]+$/.test(e.codigo)) return json({ ok: false, mensaje: 'El código debe empezar por TEST-.' }, 422);

  const [solicitante] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'solicitante@desarrollo.invalid')).limit(1);
  const [aduana] = await db.select({ id: usuario.id }).from(usuario).where(eq(usuario.email, 'aduana-a@desarrollo.invalid')).limit(1);
  if (!solicitante || !aduana) return json({ ok: false, mensaje: 'Faltan los usuarios de desarrollo.' }, 409);
  const actor = await cargarActorPorId(db, solicitante.id);
  if (!actor) return json({ ok: false, mensaje: 'El solicitante de desarrollo no está activo.' }, 409);

  const r = await crearReferencia(
    { db, actor },
    { codigo: e.codigo, nombreProducto: e.nombre ?? `${e.codigo} (ejemplo)`, tipoProducto: e.tipo ?? 'REPUESTO' },
  );
  if (e.llena !== false) {
    const tipo = e.tipo ?? 'REPUESTO';
    for (const [campo, valor] of DATOS) {
      const def = getCampo(campo);
      if (!def || !esVisible(def, tipo)) continue;
      const [f] = await db.select({ datos: referencia.datos }).from(referencia).where(eq(referencia.id, r.id)).limit(1);
      await guardarCampo({ db, actor }, { referenciaId: r.id, campo, valor, versionEsperada: f?.datos?.[campo]?.n ?? 0 });
    }
  }
  if (e.enviar !== false) {
    await db.update(referencia).set({ estado: 'EN_GESTION' }).where(eq(referencia.id, r.id));
    await db.insert(asignacion).values({
      referenciaId: r.id,
      deUsuarioId: actor.usuarioId,
      aUsuarioId: aduana.id,
      pedido: 'clasificar',
      mensaje: '[DESARROLLO] asignación de ejemplo',
      estado: 'pendiente',
    });
  }
  return json({ ok: true, id: r.id });
}
