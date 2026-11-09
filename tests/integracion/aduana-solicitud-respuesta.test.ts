/**
 * Reunion con el area (2026-10-29), A2 y R1 en el servidor:
 *  - la solicitud de la aduana (descripciones minimas adicionales) abre un pendiente «Responder» para el area, con aviso
 *    en la campana; la respuesta lo cierra y avisa a la aduana; si la aduana cambia la solicitud, vuelve a quedar
 *    pendiente; con «No aplica» deja de pedirse;
 *  - llenar y luego borrar, desmarcar «No aplica» o pasar el RIM a «Sí» sin cantidad devuelve el campo a pendiente en
 *    la ficha, la zona de la aduana y «Para mí».
 */
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asignacion, notificacion } from '@/db/esquema';
import { vistaAduana } from '@/server/politicas/aduana';
import { pendientesDe } from '@/server/politicas/colaboracion';
import { vistaFicha } from '@/server/politicas/referencias';
import { nuevoEscenario, type Escenario } from './ayudas';
import { escribir, fichaEnAduana } from './ayudas-aduana';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

const activasDe = (referenciaId: string, usuarioId: string) =>
  e.db
    .select()
    .from(asignacion)
    .where(and(eq(asignacion.referenciaId, referenciaId), eq(asignacion.aUsuarioId, usuarioId), inArray(asignacion.estado, ['pendiente', 'en_curso'])));

const avisos = (referenciaId: string, usuarioId: string, tipo: string) =>
  e.db
    .select()
    .from(notificacion)
    .where(and(eq(notificacion.referenciaId, referenciaId), eq(notificacion.usuarioId, usuarioId), eq(notificacion.tipo, tipo)));

describe('A2: solicitud de la aduana -> pendiente del area -> respuesta', () => {
  it('la solicitud llega al area como «Responder» con aviso; la aduana conserva su pendiente', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿El motor es AC o DC? ¿Amperaje?');

    const deEdward = await activasDe(id, e.edward.usuarioId);
    expect(deEdward).toHaveLength(1);
    expect(deEdward[0]).toMatchObject({ pedido: 'responder', deUsuarioId: e.brian.usuarioId, mensaje: '¿El motor es AC o DC? ¿Amperaje?' });
    expect(await avisos(id, e.edward.usuarioId, 'asignacion')).toHaveLength(1);
    expect((await activasDe(id, e.brian.usuarioId)).map((a) => a.pedido)).toEqual(['clasificar']);

    const pendientes = await pendientesDe(e.db, e.edward, new Date());
    expect(pendientes.find((p) => p.referenciaId === id)).toMatchObject({ pedido: 'responder' });

    const zona = await vistaAduana(e.db, e.brian, id, new Date());
    expect(zona.solicitudPendiente).toBe(true);
    expect(zona.permisos.responder).toBe(false);
    expect((await vistaAduana(e.db, e.edward, id, new Date())).permisos.responder).toBe(true);
    const ficha = await vistaFicha(e.db, e.edward, id, new Date());
    expect(ficha.completitud.aduana.faltantes).toContain('respuesta_area');
    expect(ficha.completitud.area.completo).toBe(true);
  });

  it('responder cierra el pendiente, avisa a la aduana y la parte deja de esperar; cambiar la solicitud lo reabre', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿Voltaje?');
    await escribir(e, e.edward, id, 'respuesta_area', '24 V DC');

    expect(await activasDe(id, e.edward.usuarioId)).toHaveLength(0);
    expect(await avisos(id, e.brian.usuarioId, 'respuesta')).toHaveLength(1);
    const zona = await vistaAduana(e.db, e.brian, id, new Date());
    expect(zona.solicitudPendiente).toBe(false);
    expect(zona.respuestaArea?.valor).toEqual({ texto: '24 V DC', sobre: '¿Voltaje?' });
    expect((await vistaFicha(e.db, e.brian, id, new Date())).completitud.aduana.faltantes).not.toContain('respuesta_area');

    // La aduana amplia la solicitud: la respuesta es anterior, vuelve a quedar pendiente y el area recibe otro pendiente.
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿Voltaje? ¿Y la potencia?');
    expect((await vistaAduana(e.db, e.brian, id, new Date())).solicitudPendiente).toBe(true);
    expect((await activasDe(id, e.edward.usuarioId)).map((a) => a.pedido)).toEqual(['responder']);

    await escribir(e, e.edward, id, 'respuesta_area', '24 V DC, 400 W');
    expect((await vistaAduana(e.db, e.brian, id, new Date())).solicitudPendiente).toBe(false);
    expect(await activasDe(id, e.edward.usuarioId)).toHaveLength(0);
  });

  it('mientras la aduana espere, el area no puede vaciar su respuesta (se corrige, no se borra)', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿AC o DC?');
    await escribir(e, e.edward, id, 'respuesta_area', 'AC');
    await expect(escribir(e, e.edward, id, 'respuesta_area', null)).rejects.toMatchObject({ codigo: 'VALIDACION' });
    expect((await vistaAduana(e.db, e.brian, id, new Date())).respuestaArea?.valor).toEqual({ texto: 'AC', sobre: '¿AC o DC?' });
  });

  it('si la aduana marca «No es necesario por ahora / no aplica», el pendiente del area se cierra y no falta respuesta', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'descripciones_minimas', '¿Material?');
    expect(await activasDe(id, e.edward.usuarioId)).toHaveLength(1);
    await escribir(e, e.brian, id, 'descripciones_minimas', { no_aplica: true });
    expect(await activasDe(id, e.edward.usuarioId)).toHaveLength(0);
    const c = (await vistaFicha(e.db, e.brian, id, new Date())).completitud;
    expect(c.aduana.faltantes).not.toContain('respuesta_area');
    expect(c.aduana.faltantes).not.toContain('descripciones_minimas');
  });
});

describe('R1 en el servidor: diligenciar y deshacer vuelve a pendiente', () => {
  it('aspecto fisico y tipo de empaque: «No aplica» cuenta; desmarcarlo vuelve a pendiente', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.edward, id, 'aspecto_fisico', { no_aplica: true });
    await escribir(e, e.edward, id, 'tipo_empaque', { no_aplica: true });
    expect((await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.detalle.estado).toBe('verde');
    await escribir(e, e.edward, id, 'aspecto_fisico', null);
    await escribir(e, e.edward, id, 'tipo_empaque', null);
    const detalle = (await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.detalle;
    expect(detalle).toMatchObject({ estado: 'amarillo', faltan: 2 });
    expect(detalle.faltantes.sort()).toEqual(['aspecto_fisico', 'tipo_empaque']);
  });

  it('otra persona desmarca un «No aplica» ajeno: pide motivo, vuelve a pendiente y avisa al autor', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.edward, id, 'tipo_empaque', { no_aplica: true });
    await expect(escribir(e, e.charles, id, 'tipo_empaque', null)).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO' });
    await escribir(e, e.charles, id, 'tipo_empaque', null, 'Sí trae empaque: caja');
    expect((await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.detalle.faltantes).toEqual(['tipo_empaque']);
    expect(await avisos(id, e.edward.usuarioId, 'cambio_en_mi_campo')).toHaveLength(1);
    // Un valor real ajeno sigue sin poder vaciarse (D-05).
    await escribir(e, e.edward, id, 'tipo_empaque', 'Caja');
    await expect(escribir(e, e.charles, id, 'tipo_empaque', null, 'lo borro')).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });

  it('proveedor «el mismo fabricante»: cuenta como diligenciado; quitarlo vuelve a pendiente', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.edward, id, 'proveedor', { mismo_fabricante: true });
    expect((await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.detalle.faltan).toBe(0);
    await escribir(e, e.edward, id, 'proveedor', null);
    expect((await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.detalle.faltantes).toEqual(['proveedor']);
  });

  it('RIM: «Sí» sin cantidad queda pendiente; con cantidad se completa; volver a «No» deja de exigirla', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    const esp = async () => (await vistaFicha(e.db, e.edward, id, new Date())).completitud.secciones.especificaciones;
    expect((await esp()).estado).toBe('verde'); // la ficha llena dice «No»
    await escribir(e, e.edward, id, 'requiere_rim', 'SI');
    expect(await esp()).toMatchObject({ estado: 'amarillo', faltantes: ['cantidad_rim'] });
    await escribir(e, e.edward, id, 'cantidad_rim', '12');
    expect((await esp()).estado).toBe('verde');
    await escribir(e, e.edward, id, 'cantidad_rim', null);
    expect((await esp()).faltantes).toEqual(['cantidad_rim']);
    await escribir(e, e.edward, id, 'requiere_rim', 'NO');
    expect((await esp()).estado).toBe('verde');
  });

  it('la aduana: desmarcar «No aplica» en restricciones u observaciones vuelve a pendiente', async () => {
    const id = await fichaEnAduana(e, { llena: true });
    await escribir(e, e.brian, id, 'restricciones', { no_aplica: true });
    await escribir(e, e.brian, id, 'observaciones_aduana', { no_aplica: true });
    const antes = (await vistaFicha(e.db, e.brian, id, new Date())).completitud.aduana.faltantes;
    expect(antes).not.toContain('restricciones');
    expect(antes).not.toContain('observaciones_aduana');
    await escribir(e, e.brian, id, 'restricciones', null);
    await escribir(e, e.brian, id, 'observaciones_aduana', null);
    const despues = (await vistaFicha(e.db, e.brian, id, new Date())).completitud.aduana.faltantes;
    expect(despues).toEqual(expect.arrayContaining(['restricciones', 'observaciones_aduana']));
  });

  it('una montura no pide «Máquina donde se instala» ni la acepta', async () => {
    const id = await fichaEnAduana(e, { llena: true, tipo: 'MONTURA' });
    const c = (await vistaFicha(e.db, e.edward, id, new Date())).completitud;
    expect(c.secciones.detalle.faltantes).not.toContain('maquina_destino');
    await expect(escribir(e, e.edward, id, 'maquina_destino', 'Biseladora')).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });
});
