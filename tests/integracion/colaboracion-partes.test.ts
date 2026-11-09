/**
 * «Enviar a» deja el pendiente en la app (campana y «Para mi») y reparte PARTES de la ficha entre personas; el tablero
 * dice de quien esta pendiente cada parte y quien falta.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion } from '@/db/esquema';
import { enviarA } from '@/server/acciones/asignaciones';
import { pendientesDe } from '@/server/politicas/colaboracion';
import { responsablesPorParte, tableroDe } from '@/server/politicas/tablero';
import { nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';
import { asignacionesDe, notificacionesDe } from './ayudas-colab';

let e: Escenario;
const T0 = new Date('2026-10-21T15:00:00.000Z');
const DIAS = 86_400_000;

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

describe('aviso dentro de la app', () => {
  it('enviar deja asignacion y notificacion en la bandeja de quien la recibe', async () => {
    const id = await nuevaFicha(e, { codigo: 'BAS-0001' });
    const r = await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId }] });
    expect(r.creadas).toBe(1);
    expect(r.destinatarios[0]).toMatchObject({ creadas: 1, actualizadas: 0, sinCambios: 0 });
    const [n] = await notificacionesDe(e.db, e.charles.usuarioId);
    expect(n?.tipo).toBe('asignacion');
    expect(n?.titulo).toContain('BAS-0001');
  });
});

describe('partes de la ficha', () => {
  it('guarda las secciones elegidas y las muestra en el titulo; vacio o las tres = toda su parte', async () => {
    const id = await nuevaFicha(e, { codigo: 'PAR-0001' });
    await enviarA(e.ctx(e.admin, T0), {
      referenciaId: id,
      destinatarios: [{ usuarioId: e.edward.usuarioId, secciones: ['detalle', 'producto'] }, { usuarioId: e.charles.usuarioId, secciones: ['producto', 'detalle', 'especificaciones'] }],
    });
    const filas = await asignacionesDe(e.db, id);
    expect(filas.find((a) => a.aUsuarioId === e.edward.usuarioId)?.secciones).toBe('producto,detalle'); // en el orden de la ficha
    expect(filas.find((a) => a.aUsuarioId === e.charles.usuarioId)?.secciones).toBeNull();
    const [n] = await notificacionesDe(e.db, e.edward.usuarioId);
    expect(n?.titulo).toContain('Producto y Detalle');
  });

  it('reenviar con otras secciones actualiza la misma asignacion y avisa; con las mismas no hace nada', async () => {
    const id = await nuevaFicha(e, { codigo: 'PAR-0002' });
    const base = { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, secciones: ['detalle' as const] }] };
    expect((await enviarA(e.ctx(e.edward, T0), base)).creadas).toBe(1);
    expect((await enviarA(e.ctx(e.edward, T0), base)).destinatarios[0]?.sinCambios).toBe(1);
    const r = await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.charles.usuarioId, secciones: ['especificaciones'] }] });
    expect(r.actualizadas).toBe(1);
    const activas = (await asignacionesDe(e.db, id)).filter((a) => a.estado === 'pendiente');
    expect(activas).toHaveLength(1);
    expect(activas[0]?.secciones).toBe('especificaciones');
    // El aviso de actualizacion dice que le toca ahora, no solo el pedido.
    const avisos = await notificacionesDe(e.db, e.charles.usuarioId);
    expect(avisos.find((n) => n.titulo.includes('actualizó') && n.titulo.includes('PAR-0002'))?.titulo).toMatch(/: Especificaciones$/);
    // «Para mi» solo nombra lo que se le pidio, nunca la seccion de otra persona.
    const falta = (await pendientesDe(e.db, e.charles, T0)).find((f) => f.codigo === 'PAR-0002')?.falta;
    expect(falta).toBeTruthy();
    expect(falta).not.toMatch(/Producto|Detalle/);
  });

  it('la aduana no lleva secciones: siempre es su bloque', async () => {
    const id = await nuevaFicha(e, { codigo: 'PAR-0003' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: id, destinatarios: [{ usuarioId: e.brian.usuarioId, secciones: ['detalle'] }] });
    const [a] = await asignacionesDe(e.db, id);
    expect(a?.secciones).toBeNull();
    const por = (await responsablesPorParte(e.db, e.admin, [id], T0)).get(id);
    expect(por?.aduana.map((r) => r.nombre)).toEqual(['Brian']);
    expect(por?.detalle).toHaveLength(0);
  });

  it('responsablesPorParte: sin secciones el area tiene las tres; con secciones solo esas', async () => {
    const id = await nuevaFicha(e, { codigo: 'PAR-0004' });
    await enviarA(e.ctx(e.admin, T0), {
      referenciaId: id,
      destinatarios: [{ usuarioId: e.edward.usuarioId, secciones: ['detalle'] }, { usuarioId: e.charles.usuarioId }],
    });
    const por = (await responsablesPorParte(e.db, e.admin, [id], new Date(T0.getTime() + 3 * DIAS))).get(id);
    expect(por?.producto.map((r) => r.nombre)).toEqual(['Charles']);
    expect(por?.detalle.map((r) => r.nombre).sort()).toEqual(['Charles', 'Edward']);
    expect(por?.detalle[0]?.dias).toBe(3);
  });
});

describe('tablero: quien falta', () => {
  it('cuenta, dice de quien esta cada parte y marca lo detenido', async () => {
    const solo = await nuevaFicha(e, { codigo: 'TAB-0001', nombre: 'Sin dueno' });
    const repartida = await nuevaFicha(e, { codigo: 'TAB-0002', nombre: 'Repartida' });
    await enviarA(e.ctx(e.admin, T0), { referenciaId: repartida, destinatarios: [{ usuarioId: e.edward.usuarioId, secciones: ['detalle'] }] });
    await e.db.update(asignacion).set({ creadaEn: new Date(T0.getTime() - 6 * DIAS) }).where(eq(asignacion.referenciaId, repartida));

    const t = await tableroDe(e.db, e.admin, T0);
    const filaSolo = t.abiertas.find((f) => f.id === solo);
    const filaRep = t.abiertas.find((f) => f.id === repartida);
    // Un borrador que nadie ha enviado dice lo mismo que el listado, no «Sin responsable».
    expect(filaSolo?.bloqueo).toMatchObject({ clase: 'sin_enviar', texto: 'Aún sin enviar' });
    expect(filaRep?.partes.detalle.responsables.map((r) => r.nombre)).toEqual(['Edward']);
    // Producto y Especificaciones siguen sin dueno: la razon inmediata es esa, no Edward.
    expect(filaRep?.bloqueo.clase).toBe('sin_responsable');
    expect(filaRep?.bloqueo.texto).toBe('Sin responsable en Producto y Especificaciones');
    expect(t.porPersona.find((p) => p.nombre === 'Edward')?.masAntiguaDias).toBeGreaterThanOrEqual(6);
    expect(t.resumen.abiertas).toBe(t.abiertas.length);
  });

  it('la cifra «Sin responsable» es la de la regla 11: EN_GESTION sin ninguna asignacion activa', async () => {
    const antes = (await tableroDe(e.db, e.admin, T0)).resumen.sinResponsable;
    await nuevaFicha(e, { codigo: 'TAB-0005' }); // borrador: no cuenta
    const enviada = await nuevaFicha(e, { codigo: 'TAB-0006' });
    await enviarA(e.ctx(e.admin, T0), { referenciaId: enviada, destinatarios: [{ usuarioId: e.edward.usuarioId, secciones: ['detalle'] }] });
    // Con una asignacion activa no cuenta, aunque Producto y Especificaciones no tengan dueno.
    expect((await tableroDe(e.db, e.admin, T0)).resumen.sinResponsable).toBe(antes);
    await e.db.update(asignacion).set({ estado: 'hecha' }).where(eq(asignacion.referenciaId, enviada));
    expect((await tableroDe(e.db, e.admin, T0)).resumen.sinResponsable).toBe(antes + 1);
  });

  it('una agencia solo ve en su tablero lo que le enviaron', async () => {
    const mia = await nuevaFicha(e, { codigo: 'TAB-0003' });
    await nuevaFicha(e, { codigo: 'TAB-0004' });
    await enviarA(e.ctx(e.edward, T0), { referenciaId: mia, destinatarios: [{ usuarioId: e.brian.usuarioId }] });
    const t = await tableroDe(e.db, e.brian, T0);
    const codigos = t.abiertas.map((f) => f.codigo);
    expect(codigos).toContain('TAB-0003');
    expect(codigos).not.toContain('TAB-0004');
    expect(codigos.every((c) => c === 'TAB-0003' || c === 'PAR-0003')).toBe(true); // lo unico que se le envio en este archivo
  });
});
