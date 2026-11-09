/**
 * `guardarCampo` (12.4, 9.3, 9.5): historial, version por campo, motivo al reemplazar valor ajeno,
 * aviso al autor, idempotencia, permisos por grupo y estado de la ficha.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campoHistorial, notificacion, referencia } from '@/db/esquema';
import { guardarCampo } from '@/server/acciones/guardar-campo';
import { ErrorAccion } from '@/server/acciones/resultado';
import { asignarAAduana, nuevoEscenario, nuevaFicha, rechazaCon, versionDe, type Escenario } from './ayudas';

let e: Escenario;

beforeAll(async () => {
  e = await nuevoEscenario();
});
afterAll(async () => {
  await e.c.cerrar();
});

const guardar = async (
  ficha: string,
  campo: string,
  valor: unknown,
  quien = e.edward,
  extra: { motivo?: string; versionEsperada?: number } = {},
) =>
  guardarCampo(e.ctx(quien), {
    referenciaId: ficha,
    campo,
    valor,
    versionEsperada: extra.versionEsperada ?? (await versionDe(e.db, ficha, campo)),
    ...(extra.motivo !== undefined ? { motivo: extra.motivo } : {}),
  });

async function fallaCon(p: Promise<unknown>, codigo: string): Promise<ErrorAccion> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ErrorAccion);
    expect((err as ErrorAccion).codigo).toBe(codigo);
    return err as ErrorAccion;
  }
  throw new Error(`se esperaba el codigo ${codigo} y no hubo error`);
}

async function historial(ficha: string, campo: string) {
  return e.db
    .select()
    .from(campoHistorial)
    .where(and(eq(campoHistorial.referenciaId, ficha), eq(campoHistorial.campo, campo)))
    .orderBy(campoHistorial.versionCampo);
}

describe('escritura basica', () => {
  it('guarda un campo, versiona por campo y deja autor, rol y organizacion en el historial', async () => {
    const f = await nuevaFicha(e);
    const r = await guardar(f, 'uso', '  Limpieza de lentes  ');
    expect(r).toMatchObject({ escrito: true, version: 1, valor: 'Limpieza de lentes' });

    const h = await historial(f, 'uso');
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      versionCampo: 1,
      tipoEvento: 'fijar',
      valor: 'Limpieza de lentes',
      autorId: e.edward.usuarioId,
      rol: 'solicitante',
      organizacionId: e.orgInterna,
      baseVersion: 0,
      origen: 'web',
    });

    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.datos.uso).toMatchObject({ v: 'Limpieza de lentes', n: 1, a: e.edward.usuarioId, o: e.orgInterna });
  });

  it('sube referencia.version con cada escritura (para el sondeo) y reindexa texto_busqueda', async () => {
    const f = await nuevaFicha(e, { codigo: 'B32 10-KIT5', nombre: 'Chuck inferior' });
    const [antes] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    const r = await guardar(f, 'marca', { texto: 'ACME' });
    const [despues] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(despues!.version).toBe(antes!.version + 1);
    expect(r.versionFicha).toBe(despues!.version);
    expect(despues!.textoBusqueda).toContain('acme');
    expect(despues!.textoBusqueda).toContain('b3210kit5');
  });

  it('actualiza las columnas promovidas al cambiar nombre, tipo y partida', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'nombre_producto', 'Nombre nuevo');
    await guardar(f, 'tipo_producto', 'EQUIPO');
    await asignarAAduana(e, f, e.brian);
    await guardar(f, 'partida_arancelaria', '8421399000', e.brian);
    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila).toMatchObject({ nombreProducto: 'Nombre nuevo', tipoProducto: 'EQUIPO', partida: '8421.39.90.00' });
    expect(fila!.textoBusqueda).toContain('8421.39.90.00');
  });

  it('es idempotente: el mismo valor no escribe (ni siquiera con version vieja: reintento de red)', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Igual');
    const otra = await guardar(f, 'uso', 'Igual');
    expect(otra).toMatchObject({ escrito: false, version: 1 });
    const reintento = await guardar(f, 'uso', 'Igual', e.edward, { versionEsperada: 0 });
    expect(reintento).toMatchObject({ escrito: false, version: 1 });
    expect(await historial(f, 'uso')).toHaveLength(1);
  });

  it('vaciar el propio valor no pide motivo y queda como evento "vaciar"', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Algo');
    const r = await guardar(f, 'uso', '');
    expect(r).toMatchObject({ escrito: true, version: 2, valor: null });
    const h = await historial(f, 'uso');
    expect(h[1]).toMatchObject({ tipoEvento: 'vaciar', valor: null });
  });

  it('valida con zod: uuid, nombre de campo y version', async () => {
    await fallaCon(guardarCampo(e.ctx(e.edward), { referenciaId: 'no-es-uuid', campo: 'uso', valor: 'x', versionEsperada: 0 }), 'VALIDACION');
    await fallaCon(
      guardarCampo(e.ctx(e.edward), { referenciaId: await nuevaFicha(e), campo: 'uso', valor: 'x', versionEsperada: -1 }),
      'VALIDACION',
    );
  });

  it('rechaza campos desconocidos, el codigo y los campos que no se escriben asi', async () => {
    const f = await nuevaFicha(e);
    await fallaCon(guardar(f, 'inventado', 'x'), 'VALIDACION');
    await fallaCon(guardar(f, 'codigo', 'OTRO-1'), 'VALIDACION');
    await fallaCon(guardar(f, 'dias_gestion', 3), 'VALIDACION');
    await fallaCon(guardar(f, 'adjuntos', 'x'), 'VALIDACION');
  });

  it('rechaza un valor gigante', async () => {
    const f = await nuevaFicha(e);
    await fallaCon(guardar(f, 'uso', 'x'.repeat(30_000)), 'VALIDACION');
  });
});

describe('normalizacion de numeros y listas', () => {
  it('la cantidad del RIM guarda resultado y expresion', async () => {
    const f = await nuevaFicha(e);
    expect((await guardar(f, 'requiere_rim', 'Sí')).valor).toBe('SI');
    const c = await guardar(f, 'cantidad_rim', '13x12');
    expect(c.valor).toEqual({ valor: '156', expresion: '13x12' });
    const h = await historial(f, 'cantidad_rim');
    expect(h[0]!.valor).toEqual({ valor: '156', expresion: '13x12' });
  });

  it('una cantidad ambigua no se guarda y devuelve las opciones; el usuario elige', async () => {
    const f = await nuevaFicha(e);
    const err = await fallaCon(guardar(f, 'cantidad_rim', '1.374'), 'VALIDACION');
    expect(JSON.stringify(err.detalle)).toContain('AMBIGUO');
    expect(await historial(f, 'cantidad_rim')).toHaveLength(0);
    const ok = await guardar(f, 'cantidad_rim', { texto: '1.374', desambiguar: 'entero' });
    expect((ok.valor as { valor: string }).valor).toBe('1374');
  });

  it('los campos retirados (valor unitario, cantidad a radicar, clasificadores) ya no se escriben', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await fallaCon(guardar(f, 'valor_unitario', '137,74'), 'VALIDACION');
    await fallaCon(guardar(f, 'cantidad_a_radicar', '13x12'), 'VALIDACION');
    await fallaCon(guardar(f, 'primer_clasificador', { usuario_id: e.brian.usuarioId }, e.brian), 'VALIDACION');
  });

  it('la unidad de medida solo admite valores del catalogo', async () => {
    const f = await nuevaFicha(e);
    await fallaCon(guardar(f, 'unidad_medida', 'Parsecs'), 'VALIDACION');
    expect((await guardar(f, 'unidad_medida', 'Litros')).valor).toBe('Litros');
  });

  it('el pais admite ISO2 y "No se conoce"', async () => {
    const f = await nuevaFicha(e);
    expect((await guardar(f, 'pais_origen', 'fr')).valor).toBe('FR');
    expect((await guardar(f, 'pais_origen', 'NO_SE_CONOCE')).valor).toBe('NO_SE_CONOCE');
    await fallaCon(guardar(f, 'pais_origen', 'Francia'), 'VALIDACION');
  });
});

describe('campos condicionales por tipo (D-06, P-10)', () => {
  it('fecha de fabricacion solo existe en equipos; maquina de destino solo en repuesto y accesorio', async () => {
    const insumo = await nuevaFicha(e, { tipo: 'INSUMO' });
    await fallaCon(guardar(insumo, 'fecha_fabricacion', { fecha: '2026-01-01' }), 'VALIDACION');
    await fallaCon(guardar(insumo, 'maquina_destino', 'Biseladora'), 'VALIDACION');

    const equipo = await nuevaFicha(e, { tipo: 'EQUIPO' });
    expect((await guardar(equipo, 'fecha_fabricacion', { fecha: '2026-01-01' })).escrito).toBe(true);
    await fallaCon(guardar(equipo, 'maquina_destino', 'x'), 'VALIDACION');

    const repuesto = await nuevaFicha(e, { tipo: 'REPUESTO' });
    expect((await guardar(repuesto, 'maquina_destino', 'Biseladora')).escrito).toBe(true);
  });

  it('cambiar el tipo con campos llenos conserva los valores (nada se borra)', async () => {
    const f = await nuevaFicha(e, { tipo: 'REPUESTO' });
    await guardar(f, 'maquina_destino', 'Biseladora Mei 641');
    await guardar(f, 'unidad_medida', 'Litros');
    await guardar(f, 'tipo_producto', 'INSUMO');
    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.tipoProducto).toBe('INSUMO');
    expect(fila!.datos.maquina_destino!.v).toBe('Biseladora Mei 641'); // oculto pero conservado
    expect(fila!.datos.unidad_medida!.v).toBe('Litros');
    expect((await historial(f, 'maquina_destino')).length).toBe(1);
  });
});

describe('permisos por grupo de campo y rol (3.3, 9.2, D-02)', () => {
  it('el solicitante no escribe campos de la aduana; la aduana no escribe campos del cliente', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await fallaCon(guardar(f, 'partida_arancelaria', '8421.39.90.00', e.edward), 'SIN_PERMISO');
    await fallaCon(guardar(f, 'uso', 'La aduana no lo escribe', e.brian), 'SIN_PERMISO');
    expect((await guardar(f, 'partida_arancelaria', '8421.39.90.00', e.brian)).escrito).toBe(true);
  });

  it('el lector no escribe nada; el admin escribe ambos grupos', async () => {
    const f = await nuevaFicha(e);
    await fallaCon(guardar(f, 'uso', 'x', e.lector), 'SIN_PERMISO');
    expect((await guardar(f, 'uso', 'del admin', e.admin)).escrito).toBe(true);
    expect((await guardar(f, 'restricciones', 'texto', e.admin)).escrito).toBe(true);
  });

  it('una ficha ajena (no asignada a la agencia) responde NO_ENCONTRADO, tambien al escribir', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await fallaCon(guardar(f, 'partida_arancelaria', '8421.39.90.00', e.brianB), 'NO_ENCONTRADO');
    await fallaCon(guardar(await nuevaFicha(e), 'observaciones_aduana', 'x', e.brian), 'NO_ENCONTRADO');
  });

  it('una ficha CLASIFICADA es solo lectura: FICHA_CERRADA', async () => {
    const f = await nuevaFicha(e);
    await e.db.update(referencia).set({ estado: 'CLASIFICADA', clasificadaEn: new Date() }).where(eq(referencia.id, f));
    await fallaCon(guardar(f, 'uso', 'x'), 'FICHA_CERRADA');
  });

  it('una ficha archivada es solo lectura', async () => {
    const f = await nuevaFicha(e);
    await e.db.update(referencia).set({ archivadaEn: new Date(), archivadaPor: e.admin.usuarioId, motivoArchivo: 'prueba' }).where(eq(referencia.id, f));
    await fallaCon(guardar(f, 'uso', 'x'), 'FICHA_CERRADA');
  });

  it('cerrar la clasificacion (finalizada = SI) solo por «finalizar»; NO si se puede escribir', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await fallaCon(guardar(f, 'clasificacion_finalizada', 'SI', e.brian), 'VALIDACION');
    expect((await guardar(f, 'clasificacion_finalizada', 'NO', e.brian)).escrito).toBe(true);
  });

  it('la respuesta del area la escribe el area, no la aduana, y solo si hay una solicitud', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await fallaCon(guardar(f, 'respuesta_area', 'DC'), 'VALIDACION'); // aun no hay solicitud
    await guardar(f, 'descripciones_minimas', '¿AC o DC?', e.brian);
    await fallaCon(guardar(f, 'respuesta_area', 'DC', e.brian), 'SIN_PERMISO');
    expect((await guardar(f, 'respuesta_area', 'DC')).valor).toEqual({ texto: 'DC', sobre: '¿AC o DC?' });
  });
});

describe('reemplazo de valor ajeno: motivo, aviso, historial (CA-12, P-07)', () => {
  it('sin motivo: FALTA_MOTIVO y nada cambia', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'materia_constitutiva', 'Agua 80%');
    await fallaCon(guardar(f, 'materia_constitutiva', 'Alcohol', e.charles), 'FALTA_MOTIVO');
    expect(await historial(f, 'materia_constitutiva')).toHaveLength(1);
  });

  it('con motivo: guarda, conserva el valor anterior y avisa al autor (solo bandeja)', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'materia_constitutiva', 'Agua 80%');
    const r = await guardar(f, 'materia_constitutiva', 'Agua 78%', e.charles, { motivo: 'Corrijo con la hoja de seguridad' });
    expect(r).toMatchObject({ escrito: true, version: 2 });

    const h = await historial(f, 'materia_constitutiva');
    expect(h.map((x) => x.valor)).toEqual(['Agua 80%', 'Agua 78%']); // el de Edward sigue ahi
    expect(h[1]).toMatchObject({ motivo: 'Corrijo con la hoja de seguridad', autorId: e.charles.usuarioId });

    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(and(eq(notificacion.usuarioId, e.edward.usuarioId), eq(notificacion.tipo, 'cambio_en_mi_campo'), eq(notificacion.referenciaId, f)));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.titulo).toContain('Charles');
    expect(avisos[0]!.titulo).toContain('Materia constitutiva');
  });

  it('el propio autor cambia su valor sin motivo ni aviso', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Uno');
    await guardar(f, 'uso', 'Dos');
    const avisos = await e.db.select().from(notificacion).where(eq(notificacion.referenciaId, f));
    expect(avisos).toHaveLength(0);
  });

  it('nadie vacia un valor ajeno; solo un admin, y con motivo', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'De Edward');
    await fallaCon(guardar(f, 'uso', '', e.charles, { motivo: 'quiero borrarlo' }), 'SIN_PERMISO');
    await fallaCon(guardar(f, 'uso', '', e.admin), 'FALTA_MOTIVO');
    const r = await guardar(f, 'uso', '', e.admin, { motivo: 'Duplicado en información adicional' });
    expect(r).toMatchObject({ escrito: true, valor: null });
    const h = await historial(f, 'uso');
    expect(h[0]!.valor).toBe('De Edward'); // el original sigue en el historial
  });

  it('un motivo vacio o de solo espacios no cuenta', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'De Edward');
    await fallaCon(guardar(f, 'uso', 'Otro', e.charles, { motivo: '   ' }), 'FALTA_MOTIVO');
  });

  it('no avisa a un autor desactivado', async () => {
    const f = await nuevaFicha(e, { actor: e.charles });
    await guardar(f, 'uso', 'De Charles', e.charles);
    // Se desactiva a Charles directamente en la base: el aviso se omite sin romper la escritura.
    const { usuario } = await import('@/db/esquema');
    await e.db.update(usuario).set({ activo: false }).where(eq(usuario.id, e.charles.usuarioId));
    try {
      const r = await guardar(f, 'uso', 'Cambio de Edward', e.edward, { motivo: 'actualizo' });
      expect(r.escrito).toBe(true);
      const avisos = await e.db.select().from(notificacion).where(eq(notificacion.usuarioId, e.charles.usuarioId));
      expect(avisos).toHaveLength(0);
    } finally {
      await e.db.update(usuario).set({ activo: true }).where(eq(usuario.id, e.charles.usuarioId));
    }
  });

  it('entre agencias: el aviso al autor no revela el nombre de la otra agencia (A5)', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await asignarAAduana(e, f, e.brianB); // un admin compartio la ficha con una segunda agencia (D-29)
    await guardar(f, 'observaciones_aduana', 'Nota de Brian', e.brian);
    await guardar(f, 'observaciones_aduana', 'Nota de Brenda', e.brianB, { motivo: 'Aclaro la redaccion' });
    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(and(eq(notificacion.usuarioId, e.brian.usuarioId), eq(notificacion.referenciaId, f)));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.titulo).toContain('Otra agencia');
    expect(avisos[0]!.titulo).not.toContain('Brenda');
  });

  it('un interno que cambia el valor de una agencia si aparece con su nombre', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await guardar(f, 'observaciones_aduana', 'Nota de Brian', e.brian);
    await guardar(f, 'observaciones_aduana', 'Nota ajustada', e.admin, { motivo: 'Aclaro la redaccion' });
    const avisos = await e.db.select().from(notificacion).where(eq(notificacion.usuarioId, e.brian.usuarioId));
    expect(avisos.some((a) => a.titulo.includes('Ana Admin'))).toBe(true);
  });
});

describe('concurrencia optimista por campo (9.5, CA-14) -- logica sobre PGlite', () => {
  it('dos personas, campos distintos: ambos cambios quedan', async () => {
    const f = await nuevaFicha(e);
    const [a, b] = await Promise.all([guardar(f, 'uso', 'Uso de Edward'), guardar(f, 'proveedor', 'Proveedor de Charles', e.charles)]);
    expect(a.escrito && b.escrito).toBe(true);
    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.datos.uso!.v).toBe('Uso de Edward');
    expect(fila!.datos.proveedor!.v).toBe('Proveedor de Charles');
  });

  it('mismo campo con la misma version esperada: una gana, la otra recibe CONFLICTO con el valor vigente y su autor', async () => {
    const f = await nuevaFicha(e);
    const resultados = await Promise.allSettled([
      guardar(f, 'funciones', 'Texto de Edward', e.edward, { versionEsperada: 0 }),
      guardar(f, 'funciones', 'Texto de Charles', e.charles, { versionEsperada: 0 }),
    ]);
    const ok = resultados.filter((r) => r.status === 'fulfilled');
    const mal = resultados.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(mal).toHaveLength(1);
    const err = mal[0]!.reason as ErrorAccion;
    expect(err.codigo).toBe('CONFLICTO');
    const vigente = (err.detalle as { vigente: { valor: string; version: number; autor: string } }).vigente;
    expect(vigente.version).toBe(1);
    expect(['Edward', 'Charles']).toContain(vigente.autor);
    expect(['Texto de Edward', 'Texto de Charles']).toContain(vigente.valor);
    // Sin perdida: el unico hecho escrito es el del ganador.
    const h = await historial(f, 'funciones');
    expect(h).toHaveLength(1);
    expect(h[0]!.valor).toBe(vigente.valor);
  });

  it('el CONFLICTO no escribe nada y reporta quien guardo primero', async () => {
    const f = await nuevaFicha(e);
    await guardar(f, 'uso', 'Primero Edward');
    const err = await fallaCon(guardar(f, 'uso', 'Segundo Charles', e.charles, { versionEsperada: 0 }), 'CONFLICTO');
    expect(err.message).toContain('Edward');
    expect((err.detalle as { vigente: { valor: string } }).vigente.valor).toBe('Primero Edward');
    expect(await historial(f, 'uso')).toHaveLength(1);
  });
});

describe('descripciones minimas: un campo de texto de la aduana como cualquier otro (DESVIACIONES 2026-10-27)', () => {
  it('la aduana lo guarda con historial y version; el area no lo escribe; una clave dm: ya no existe', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    const r = await guardar(f, 'descripciones_minimas', 'Producto: motor\r\nPotencia: 400 W', e.brian);
    expect(r).toMatchObject({ escrito: true, version: 1, valor: 'Producto: motor\nPotencia: 400 W' });
    await guardar(f, 'descripciones_minimas', 'Producto: motor\nPotencia: 400 W\nTipo de corriente: alterna', e.brian);

    const h = await historial(f, 'descripciones_minimas');
    expect(h.map((x) => x.versionCampo)).toEqual([1, 2]);
    expect(h[0]).toMatchObject({ valor: 'Producto: motor\nPotencia: 400 W', autorId: e.brian.usuarioId, rol: 'aduana', organizacionId: e.orgA });
    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.datos.descripciones_minimas).toMatchObject({ n: 2, a: e.brian.usuarioId });

    await fallaCon(guardar(f, 'descripciones_minimas', 'lo escribe el area', e.edward), 'SIN_PERMISO');
    await fallaCon(guardar(f, 'dm:3f1c2e9a-0000-4000-8000-000000000001', 'x', e.edward), 'VALIDACION');
  });

  it('reemplazar las de otra persona pide motivo y avisa; una version vieja es CONFLICTO', async () => {
    const f = await nuevaFicha(e);
    await asignarAAduana(e, f, e.brian);
    await guardar(f, 'descripciones_minimas', 'Producto: filtro', e.brian);
    await fallaCon(guardar(f, 'descripciones_minimas', 'Producto: filtro de aire', e.admin), 'FALTA_MOTIVO');
    const err = await fallaCon(guardar(f, 'descripciones_minimas', 'Otra', e.admin, { versionEsperada: 0, motivo: 'x' }), 'CONFLICTO');
    expect((err.detalle as { vigente: { valor: string } }).vigente.valor).toBe('Producto: filtro');
    await guardar(f, 'descripciones_minimas', 'Producto: filtro de aire', e.admin, { motivo: 'Precisión del producto' });
    const avisos = await e.db
      .select()
      .from(notificacion)
      .where(and(eq(notificacion.usuarioId, e.brian.usuarioId), eq(notificacion.tipo, 'cambio_en_mi_campo'), eq(notificacion.referenciaId, f)));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.titulo).toContain('Descripciones mínimas');
  });
});
describe('rechazo de entradas hostiles', () => {
  it('trata el texto como dato: HTML y SQL quedan literales, y U+0000 se elimina', async () => {
    const f = await nuevaFicha(e);
    const raro = `<script>alert(1)</script>'; drop table referencia; --\u0000`;
    const r = await guardar(f, 'informacion_adicional', raro);
    expect(r.valor).toBe(`<script>alert(1)</script>'; drop table referencia; --`);
    const [fila] = await e.db.select().from(referencia).where(eq(referencia.id, f));
    expect(fila!.datos.informacion_adicional!.v).toBe(r.valor);
  });

  it('rechaza el tipo equivocado en campos estructurados', async () => {
    const f = await nuevaFicha(e);
    await fallaCon(guardar(f, 'marca', 42), 'VALIDACION');
    await fallaCon(guardar(f, 'fecha_solicitud', 'ayer'), 'VALIDACION');
    await rechazaCon(Promise.reject(new Error('control')), /control/);
  });
});
