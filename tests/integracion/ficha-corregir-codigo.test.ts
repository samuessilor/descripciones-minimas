/**
 * `corregirCodigo` (SPEC 6.3, CA-34) y la revision en vivo del codigo (`revisarCodigo`): quien puede, el motivo
 * obligatorio, el duplicado (incluso archivado y por variantes del codigo), reindexado e historial.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditoria, campoHistorial, notificacion, referencia } from '@/db/esquema';
import { buscar } from '@/server/acciones/buscar';
import { corregirCodigo } from '@/server/acciones/corregir-codigo';
import { revisarCodigo } from '@/server/acciones/crear-referencia';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

const fila = async (id: string) => (await e.db.select().from(referencia).where(eq(referencia.id, id)))[0]!;

describe('corregirCodigo', () => {
  it('el creador corrige con motivo: se reindexa, queda en el historial y en la auditoria', async () => {
    const f = await nuevaFicha(e, { codigo: 'MAL-001', nombre: 'Pieza mal codificada' });
    const r = await corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'BIEN-001', motivo: 'Una letra cambiada al copiar' });
    expect(r).toEqual({ ok: true, codigo: 'BIEN-001', cambio: true });

    const x = await fila(f);
    expect(x.codigo).toBe('BIEN-001');
    expect(x.codigoNorm).toBe('BIEN001');
    expect(x.textoBusqueda).toContain('bien-001');
    expect(x.textoBusqueda).not.toContain('mal-001');
    expect(x.datos.codigo).toMatchObject({ v: 'BIEN-001', n: 2 });

    const h = await e.db.select().from(campoHistorial).where(and(eq(campoHistorial.referenciaId, f), eq(campoHistorial.campo, 'codigo')));
    expect(h.map((v) => [v.versionCampo, v.valor])).toEqual([
      [1, 'MAL-001'],
      [2, 'BIEN-001'],
    ]);
    expect(h[1]?.motivo).toBe('Una letra cambiada al copiar');

    const logs = await e.db.select().from(auditoria).where(and(eq(auditoria.entidadId, f), eq(auditoria.accion, 'corregir_codigo')));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.detalle).toMatchObject({ de: 'MAL-001', a: 'BIEN-001' });

    // El buscador ya no encuentra el viejo y si el nuevo.
    expect((await buscar(e.ctx(e.edward), { q: 'MAL-001' })).total).toBe(0);
    expect((await buscar(e.ctx(e.edward), { q: 'BIEN-001' })).total).toBe(1);
  });

  it('el motivo es obligatorio: vacio, espacios o caracteres invisibles no valen', async () => {
    const f = await nuevaFicha(e);
    for (const motivo of ['', '   ', '​​​', '\t\n']) {
      await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'NUEVO-A', motivo })).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO' });
    }
    expect((await fila(f)).codigo).not.toBe('NUEVO-A');
  });

  it('solo el creador (mientras no este clasificada) o un admin', async () => {
    const f = await nuevaFicha(e);
    await expect(corregirCodigo(e.ctx(e.charles), { referenciaId: f, codigoNuevo: 'X-1', motivo: 'quiero' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(corregirCodigo(e.ctx(e.lector), { referenciaId: f, codigoNuevo: 'X-1', motivo: 'quiero' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await asignarAAduana(e, f, e.brian);
    await expect(corregirCodigo(e.ctx(e.brian), { referenciaId: f, codigoNuevo: 'X-1', motivo: 'quiero' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    // La otra agencia ni la ve.
    await expect(corregirCodigo(e.ctx(e.brianB), { referenciaId: f, codigoNuevo: 'X-1', motivo: 'quiero' })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });

  it('clasificada: el creador ya no; el admin si, y el creador recibe un aviso', async () => {
    const f = await nuevaFicha(e, { codigo: 'CLAS-1' });
    await e.db.update(referencia).set({ estado: 'CLASIFICADA' }).where(eq(referencia.id, f));
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'CLAS-2', motivo: 'x' })).rejects.toMatchObject({ codigo: 'FICHA_CERRADA' });
    await corregirCodigo(e.ctx(e.admin), { referenciaId: f, codigoNuevo: 'CLAS-2', motivo: 'Error de digitacion en la factura' });
    expect((await fila(f)).codigo).toBe('CLAS-2');
    const avisos = await e.db.select().from(notificacion).where(and(eq(notificacion.referenciaId, f), eq(notificacion.usuarioId, e.edward.usuarioId)));
    expect(avisos.map((a) => a.tipo)).toContain('cambio_en_mi_campo');
  });

  it('una ficha archivada no se corrige', async () => {
    const f = await nuevaFicha(e);
    await e.db.update(referencia).set({ archivadaEn: new Date() }).where(eq(referencia.id, f));
    await expect(corregirCodigo(e.ctx(e.admin), { referenciaId: f, codigoNuevo: 'ARCH-NUEVO', motivo: 'x' })).rejects.toMatchObject({ codigo: 'FICHA_CERRADA' });
  });

  it('duplicado: un codigo de otra ficha (con otros separadores) es DUPLICADO con enlace a la existente', async () => {
    const otra = await nuevaFicha(e, { codigo: 'DUP-100' });
    const f = await nuevaFicha(e);
    for (const intento of ['DUP-100', 'dup 100', 'DUP.100', 'dup_100', ' Dup-100 ']) {
      const err = await corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: intento, motivo: 'x' }).catch((x) => x);
      expect(err, intento).toMatchObject({ codigo: 'DUPLICADO', detalle: { id: otra } });
    }
    // Y si esa otra esta archivada, el mensaje dice como salir.
    await e.db.update(referencia).set({ archivadaEn: new Date() }).where(eq(referencia.id, otra));
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'DUP-100', motivo: 'x' })).rejects.toMatchObject({
      codigo: 'DUPLICADO',
      message: expect.stringContaining('archivada'),
    });
  });

  it('el mismo codigo con otro formato (solo separadores) es una correccion valida de la misma ficha; igual no cambia nada', async () => {
    const f = await nuevaFicha(e, { codigo: 'FMT-200' });
    expect(await corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'FMT 200', motivo: 'Asi viene en la factura' })).toMatchObject({ cambio: true, codigo: 'FMT 200' });
    expect((await fila(f)).codigoNorm).toBe('FMT200');
    expect(await corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'FMT 200', motivo: 'otra vez' })).toMatchObject({ cambio: false });
  });

  it('valida la entrada: vacio, demasiado largo o caracteres que Postgres rechaza', async () => {
    const f = await nuevaFicha(e);
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: '   ', motivo: 'x' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: 'A'.repeat(81), motivo: 'x' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: f, codigoNuevo: '\u0000', motivo: 'x' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    await expect(corregirCodigo(e.ctx(e.edward), { referenciaId: 'no-uuid', codigoNuevo: 'A-1', motivo: 'x' })).rejects.toMatchObject({ codigo: 'VALIDACION' });
  });
});

describe('revisarCodigo (en vivo, mientras se escribe)', () => {
  it('avisa del duplicado exacto con la ficha existente', async () => {
    const f = await nuevaFicha(e, { codigo: 'LIVE-500', nombre: 'Existente' });
    const r = await revisarCodigo(e.ctx(e.edward), { codigo: 'live 500' });
    expect(r.existente).toMatchObject({ id: f, codigo: 'LIVE-500', nombreProducto: 'Existente', archivada: false });
  });

  it('lista parecidos (ceros a la izquierda y prefijo) sin bloquear', async () => {
    await nuevaFicha(e, { codigo: '0123-X', nombre: 'Con cero' });
    await nuevaFicha(e, { codigo: 'PRE-7788', nombre: 'Prefijo largo' });
    const ceros = await revisarCodigo(e.ctx(e.edward), { codigo: '123-X' });
    expect(ceros.existente).toBeNull();
    expect(ceros.parecidas.map((p) => p.codigo)).toContain('0123-X');
    const prefijo = await revisarCodigo(e.ctx(e.edward), { codigo: 'PRE-7788-EXTRA' });
    expect(prefijo.parecidas.map((p) => p.codigo)).toContain('PRE-7788');
  });

  it('un codigo vacio o con comodines no explota ni trae todo', async () => {
    expect(await revisarCodigo(e.ctx(e.edward), { codigo: '   ' })).toEqual({ existente: null, parecidas: [] });
    const r = await revisarCodigo(e.ctx(e.edward), { codigo: '%%%%' });
    expect(r.existente).toBeNull();
    expect(r.parecidas).toEqual([]);
  });

  it('solo quien puede crear lo consulta (la aduana y el lector, no)', async () => {
    await expect(revisarCodigo(e.ctx(e.brian), { codigo: 'LIVE-500' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(revisarCodigo(e.ctx(e.lector), { codigo: 'LIVE-500' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
  });
});
