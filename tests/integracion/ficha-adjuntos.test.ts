/**
 * Fotos de la ficha (SPEC 13.5, 9 punto 7): firma real, reprocesado, tope de 5, permisos por rol y estado,
 * aislamiento entre agencias, retiro con motivo (nada se borra) y limite de subidas.
 */
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjunto, auditoria, referencia } from '@/db/esquema';
import { leerAdjunto, limpiarNombreArchivo, listarAdjuntos, MAX_FOTOS, retirarAdjunto, subirAdjunto } from '@/server/acciones/adjuntos';
import type { Almacen } from '@/server/almacen/tipos';
import { asignarAAduana, nuevoEscenario, nuevaFicha, type Escenario } from './ayudas';

let e: Escenario;
beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

function almacenFalso(): Almacen & { claves: () => string[]; mapa: Map<string, { bytes: Uint8Array; mime: string }> } {
  const mapa = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    nombre: 'local',
    mapa,
    claves: () => [...mapa.keys()],
    async guardar(clave, bytes, mime) {
      if (mapa.has(clave)) throw new Error('ya existe');
      mapa.set(clave, { bytes, mime });
    },
    async leer(clave) {
      return mapa.get(clave) ?? null;
    },
  };
}

const jpeg = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 90, b: 170 } } }).jpeg().toBuffer();
const png = (w = 64, h = 48) => sharp({ create: { width: w, height: h, channels: 4, background: { r: 10, g: 90, b: 170, alpha: 0.5 } } }).png().toBuffer();

async function versionFicha(id: string): Promise<number> {
  const [f] = await e.db.select({ v: referencia.version }).from(referencia).where(eq(referencia.id, id));
  return f?.v ?? 0;
}

describe('subirAdjunto', () => {
  it('guarda la foto reprocesada con nombre opaco, miniatura aparte y sube la version de la ficha', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const v0 = await versionFicha(f);
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'C:\\fotos\\mi foto.jpg', almacen });

    expect(a.nombre).toBe('mi foto.jpg');
    expect(a.esPropio).toBe(true);
    expect(a.url).toBe(`/api/adjuntos/${a.id}`);
    expect(a.url).not.toMatch(/https?:/); // jamas una URL del almacen
    expect(almacen.claves()).toHaveLength(2); // foto + miniatura
    expect(almacen.claves().every((k) => /^[0-9a-f-]{36}(-m)?\.(jpg|webp)$/.test(k))).toBe(true);
    expect(await versionFicha(f)).toBe(v0 + 1);

    const [fila] = await e.db.select().from(adjunto).where(eq(adjunto.id, a.id));
    expect(fila?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fila?.mime).toBe('image/jpeg');
    expect(fila?.storageKey).not.toContain('mi foto');

    const foto = await leerAdjunto(e.ctx(e.edward), a.id, { miniatura: false, almacen });
    expect(foto.mime).toBe('image/jpeg');
    const mini = await leerAdjunto(e.ctx(e.edward), a.id, { miniatura: true, almacen });
    expect(mini.mime).toBe('image/webp');
  });

  it('decide por el contenido, no por el nombre: un PNG llamado .txt entra; un texto llamado .jpg no', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const bueno = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await png(), nombre: 'nota.txt', almacen });
    const [fila] = await e.db.select().from(adjunto).where(eq(adjunto.id, bueno.id));
    expect(fila?.mime).toBe('image/webp'); // un PNG sale como WebP

    const antes = almacen.claves().length;
    await expect(
      subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: new TextEncoder().encode('<script>alert(1)</script>'), nombre: 'falsa.jpg', almacen }),
    ).rejects.toMatchObject({ codigo: 'VALIDACION', message: expect.stringContaining('JPG, PNG o WebP') });
    // Una firma de JPEG con contenido roto tambien se rechaza, sin dejar nada a medias.
    await expect(
      subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]), nombre: 'rota.jpg', almacen }),
    ).rejects.toMatchObject({ codigo: 'VALIDACION' });
    expect(almacen.claves()).toHaveLength(antes);
    expect(await e.db.select().from(adjunto).where(eq(adjunto.referenciaId, f))).toHaveLength(1);
  });

  it('rechaza lo que pesa mas de 4 MB y lo vacio, con la salida dicha', async () => {
    const f = await nuevaFicha(e);
    await expect(
      subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: new Uint8Array(4 * 1024 * 1024 + 1), nombre: 'grande.jpg', almacen: almacenFalso() }),
    ).rejects.toMatchObject({ codigo: 'VALIDACION', message: expect.stringMatching(/pesa .* MB y el máximo es 4 MB/) });
    await expect(subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: new Uint8Array(), nombre: 'vacia.jpg', almacen: almacenFalso() })).rejects.toMatchObject({
      codigo: 'VALIDACION',
    });
  });

  it('maximo 5 fotos vivas por referencia; retirar una libera el cupo', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const subidas = [];
    for (let i = 0; i < MAX_FOTOS; i++) subidas.push(await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(8 + i, 8), nombre: `f${i}.jpg`, almacen }));
    await expect(subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'otra.jpg', almacen })).rejects.toMatchObject({
      codigo: 'VALIDACION',
      message: expect.stringContaining('máximo'),
    });
    await retirarAdjunto(e.ctx(e.edward), { adjuntoId: subidas[0]!.id, motivo: 'Borrosa' });
    await expect(subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'otra.jpg', almacen })).resolves.toBeTruthy();
  });

  it('con dos subidas a la vez el tope de 5 se respeta (la ficha se bloquea)', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    for (let i = 0; i < MAX_FOTOS - 1; i++) await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(8 + i, 8), nombre: `f${i}.jpg`, almacen });
    const [a, b] = await Promise.allSettled([
      subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(20, 20), nombre: 'a.jpg', almacen }),
      subirAdjunto(e.ctx(e.charles), { referenciaId: f, archivo: await jpeg(21, 21), nombre: 'b.jpg', almacen }),
    ]);
    expect([a.status, b.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
    const vivas = (await e.db.select().from(adjunto).where(eq(adjunto.referenciaId, f))).filter((x) => !x.retiradoEn);
    expect(vivas).toHaveLength(MAX_FOTOS);
  });

  it('permisos: el lector y la aduana no adjuntan; una ficha clasificada o ajena tampoco', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    const almacen = almacenFalso();
    const entrada = async () => ({ referenciaId: f, archivo: await jpeg(), nombre: 'x.jpg', almacen });

    await expect(subirAdjunto(e.ctx(e.lector), await entrada())).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(subirAdjunto(e.ctx(e.brian), await entrada())).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    // La agencia B no ve la ficha: 404 (no revela que existe).
    await expect(subirAdjunto(e.ctx(e.brianB), await entrada())).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });

    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: new Date(), clasificadaPor: e.admin.usuarioId }).where(eq(referencia.id, f));
    await expect(subirAdjunto(e.ctx(e.edward), await entrada())).rejects.toMatchObject({ codigo: 'FICHA_CERRADA' });
    expect(almacen.claves()).toHaveLength(0);
  });

  it('limite de subidas: 30 por hora y por persona', async () => {
    const f = await nuevaFicha(e);
    const ahora = new Date('2026-10-21T15:00:00Z');
    const basura = new TextEncoder().encode('no es imagen');
    for (let i = 0; i < 30; i++) {
      await expect(subirAdjunto(e.ctx(e.charles, ahora), { referenciaId: f, archivo: basura, nombre: 'x.jpg', almacen: almacenFalso() })).rejects.toMatchObject({ codigo: 'VALIDACION' });
    }
    await expect(subirAdjunto(e.ctx(e.charles, ahora), { referenciaId: f, archivo: basura, nombre: 'x.jpg', almacen: almacenFalso() })).rejects.toMatchObject({
      codigo: 'LIMITE_TASA',
    });
  });

  it('limpiarNombreArchivo quita rutas y caracteres invisibles', () => {
    expect(limpiarNombreArchivo('../../etc/passwd')).toBe('passwd');
    expect(limpiarNombreArchivo('C:\\Users\\yo\\foto.jpg')).toBe('foto.jpg');
    expect(limpiarNombreArchivo('fo\u200Bto\u0000.jpg')).toBe('foto.jpg');
    expect(limpiarNombreArchivo('   ')).toBe('foto');
    expect([...limpiarNombreArchivo('a'.repeat(300))]).toHaveLength(120);
  });
});

describe('leer y listar: nunca sin permiso sobre la ficha', () => {
  it('la agencia asignada la ve; la otra agencia y el id inventado reciben 404', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'p.jpg', almacen });

    await expect(leerAdjunto(e.ctx(e.brian), a.id, { miniatura: false, almacen })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' }); // aun sin asignar
    await asignarAAduana(e, f, e.brian);
    await expect(leerAdjunto(e.ctx(e.brian), a.id, { miniatura: false, almacen })).resolves.toMatchObject({ mime: 'image/jpeg' });
    await expect(leerAdjunto(e.ctx(e.brianB), a.id, { miniatura: false, almacen })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    await expect(leerAdjunto(e.ctx(e.edward), '3f1c2e9a-0000-4000-8000-000000000001', { miniatura: false, almacen })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    await expect(leerAdjunto(e.ctx(e.edward), 'no-es-uuid', { miniatura: false, almacen })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });

    await expect(listarAdjuntos(e.db, e.brianB, f, new Date())).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    expect(await listarAdjuntos(e.db, e.brian, f, new Date())).toHaveLength(1);
  });
});

describe('retirarAdjunto: nada se borra', () => {
  it('la propia se retira con motivo: queda la fila, el archivo y la auditoria', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'p.jpg', almacen });
    const archivos = almacen.claves().length;

    await expect(retirarAdjunto(e.ctx(e.edward), { adjuntoId: a.id, motivo: '   ' })).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO' });
    await expect(retirarAdjunto(e.ctx(e.edward), { adjuntoId: a.id, motivo: '\u200B\u200B' })).rejects.toMatchObject({ codigo: 'FALTA_MOTIVO' });

    await retirarAdjunto(e.ctx(e.edward), { adjuntoId: a.id, motivo: 'Se ve borrosa' });
    const [fila] = await e.db.select().from(adjunto).where(eq(adjunto.id, a.id));
    expect(fila).toMatchObject({ motivoRetiro: 'Se ve borrosa', retiradoPor: e.edward.usuarioId });
    expect(fila?.retiradoEn).toBeInstanceOf(Date);
    expect(almacen.claves()).toHaveLength(archivos); // el archivo se conserva

    const logs = await e.db.select().from(auditoria).where(eq(auditoria.entidadId, a.id));
    expect(logs.map((l) => l.accion)).toContain('retirar_adjunto');
    // Retirar dos veces no falla ni duplica la auditoria.
    await retirarAdjunto(e.ctx(e.edward), { adjuntoId: a.id, motivo: 'otra vez' });
    expect((await e.db.select().from(auditoria).where(eq(auditoria.entidadId, a.id))).filter((l) => l.accion === 'retirar_adjunto')).toHaveLength(1);

    // Aparece como retirada en el listado y ya no se sirve (salvo a un admin).
    const lista = await listarAdjuntos(e.db, e.edward, f, new Date());
    expect(lista[0]).toMatchObject({ retirado: true, motivoRetiro: 'Se ve borrosa' });
    await expect(leerAdjunto(e.ctx(e.edward), a.id, { miniatura: false, almacen })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
    await expect(leerAdjunto(e.ctx(e.admin), a.id, { miniatura: false, almacen })).resolves.toBeTruthy();
  });

  it('la foto de otra persona no se quita (un admin si, con motivo)', async () => {
    const f = await nuevaFicha(e);
    const almacen = almacenFalso();
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'p.jpg', almacen });
    await expect(retirarAdjunto(e.ctx(e.charles), { adjuntoId: a.id, motivo: 'No me gusta' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await expect(retirarAdjunto(e.ctx(e.lector), { adjuntoId: a.id, motivo: 'x' })).rejects.toMatchObject({ codigo: 'SIN_PERMISO' });
    await retirarAdjunto(e.ctx(e.admin), { adjuntoId: a.id, motivo: 'Datos personales visibles' });
    const [fila] = await e.db.select().from(adjunto).where(eq(adjunto.id, a.id));
    expect(fila?.retiradoPor).toBe(e.admin.usuarioId);
  });

  it('una foto de una ficha que no ve la agencia B es 404', async () => {
    const f = await nuevaFicha(e);
    const a = await subirAdjunto(e.ctx(e.edward), { referenciaId: f, archivo: await jpeg(), nombre: 'p.jpg', almacen: almacenFalso() });
    await expect(retirarAdjunto(e.ctx(e.brianB), { adjuntoId: a.id, motivo: 'x' })).rejects.toMatchObject({ codigo: 'NO_ENCONTRADO' });
  });
});
