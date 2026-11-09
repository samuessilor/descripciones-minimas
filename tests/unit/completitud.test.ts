import { describe, expect, it } from 'vitest';
import { TIPOS_PRODUCTO, camposObligatoriosCliente, type TipoProducto } from '@/dominio/campos';
import { calcularCompletitud, solicitudSinRespuesta } from '@/dominio/completitud';

const VALOR_DE_EJEMPLO: Record<string, unknown> = {
  codigo: 'TEST-0001',
  nombre_producto: 'Producto de prueba',
  tipo_producto: 'INSUMO',
  area_responsable: 'Mantenimiento',
  descripcion_factura: 'Segun factura',
  uso: 'Limpieza de lentes (ejemplo)',
  funciones: 'Retira residuos (ejemplo)',
  unidad_medida: 'Litros',
  materia_constitutiva: 'Agua\nAlcohol',
  aspecto_fisico: 'Líquido',
  marca: { texto: 'ACME' },
  pais_origen: 'FR',
  fabricante: 'Fabrica SA',
  proveedor: 'Proveedor SA',
  tipo_empaque: 'Bidón de 20 kg',
  maquina_destino: 'Biseladora X',
  requiere_rim: 'NO',
  cantidad_rim: { valor: '156', expresion: '13x12' },
  fecha_fabricacion: { fecha: '2026-01-01' },
};

function llenar(tipo: TipoProducto, sobre: Record<string, unknown> = {}): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const c of camposObligatoriosCliente(tipo)) v[c.clave] = VALOR_DE_EJEMPLO[c.clave];
  v.tipo_producto = tipo;
  delete v.cantidad_rim;
  return { ...v, ...sobre };
}

const aduanaCompleta = {
  partida_arancelaria: '8501.31.20.00',
  descripciones_minimas: { no_aplica: true },
  restricciones: 'Sin restricciones',
  observaciones_aduana: { no_aplica: true },
};

describe('semaforo por seccion (D-13, D-26, 8.2)', () => {
  it('una ficha con solo lo del area completo tiene las tres secciones verdes, en los cinco tipos', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      const c = calcularCompletitud({ tipo, valores: llenar(tipo) });
      expect(c.secciones.producto.estado, tipo).toBe('verde');
      expect(c.secciones.detalle.estado, tipo).toBe('verde');
      expect(c.secciones.especificaciones.estado, tipo).toBe('verde');
      expect(c.tresSeccionesVerdes).toBe(true);
      expect(c.area).toMatchObject({ faltan: 0, completo: true });
    }
  });

  it('los obligatorios de la aduana se cuentan aparte y no tiñen la seccion', () => {
    const c = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO') });
    expect(c.aduana.faltantes.sort()).toEqual(
      ['clasificacion_finalizada', 'descripciones_minimas', 'observaciones_aduana', 'partida_arancelaria', 'restricciones'].sort(),
    );
    expect(c.aduana).toMatchObject({ faltan: 5, total: 5, completo: false });
  });

  it('cuenta lo que falta por seccion con el texto "Faltan N"', () => {
    const v = llenar('INSUMO');
    delete v.uso;
    delete v.unidad_medida;
    delete v.marca;
    const c = calcularCompletitud({ tipo: 'INSUMO', valores: v });
    expect(c.secciones.producto).toMatchObject({ estado: 'amarillo', faltan: 2, texto: 'Faltan 2' });
    expect(c.secciones.producto.faltantes.sort()).toEqual(['unidad_medida', 'uso']);
    expect(c.secciones.detalle).toMatchObject({ estado: 'amarillo', faltan: 1, texto: 'Falta 1' });
    expect(c.area.faltan).toBe(3);
    expect(c.tresSeccionesVerdes).toBe(false);
  });

  it('"No tiene marca", "No se conoce", "Por confirmar", «No aplica» y «mismo fabricante» cuentan como valores validos', () => {
    const c = calcularCompletitud({
      tipo: 'EQUIPO',
      valores: llenar('EQUIPO', {
        marca: { sin_marca: true },
        pais_origen: 'NO_SE_CONOCE',
        fecha_fabricacion: { por_confirmar: true, nota: 'pendiente' },
        aspecto_fisico: { no_aplica: true },
        tipo_empaque: { no_aplica: true },
        proveedor: { mismo_fabricante: true },
      }),
    });
    expect(c.secciones.detalle.estado).toBe('verde');
    expect(c.secciones.especificaciones.estado).toBe('verde');
  });

  it('un texto de solo espacios no cuenta como lleno', () => {
    const c = calcularCompletitud({
      tipo: 'INSUMO',
      valores: llenar('INSUMO', { uso: '   ', marca: { texto: '' } }),
    });
    expect(c.secciones.producto.faltantes).toContain('uso');
    expect(c.secciones.detalle.faltantes).toContain('marca');
  });

  it('la fecha de fabricacion solo se exige en equipos', () => {
    const insumo = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO') });
    expect(insumo.secciones.especificaciones.faltantes).not.toContain('fecha_fabricacion');
    const v = llenar('EQUIPO');
    delete v.fecha_fabricacion;
    const equipo = calcularCompletitud({ tipo: 'EQUIPO', valores: v });
    expect(equipo.secciones.especificaciones.faltantes).toContain('fecha_fabricacion');
    expect(equipo.secciones.especificaciones.estado).toBe('amarillo');
  });

  it('la maquina donde se instala se exige al repuesto y al accesorio, no a la montura (D5, P1)', () => {
    for (const tipo of ['REPUESTO', 'ACCESORIO'] as const) {
      const v = llenar(tipo);
      delete v.maquina_destino;
      expect(calcularCompletitud({ tipo, valores: v }).secciones.detalle.faltantes).toContain('maquina_destino');
    }
    const montura = llenar('MONTURA');
    expect(montura.maquina_destino).toBeUndefined();
    expect(calcularCompletitud({ tipo: 'MONTURA', valores: montura }).secciones.detalle.estado).toBe('verde');
  });

  it('la foto no cuenta para el verde', () => {
    const c = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO') });
    expect(c.secciones.especificaciones.faltantes).not.toContain('adjuntos');
  });
});

describe('R1: diligenciar y luego borrar, desmarcar o cambiar vuelve a pendiente', () => {
  it('borrar un obligatorio lo devuelve a pendiente', () => {
    const lleno = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO') });
    expect(lleno.secciones.producto.estado).toBe('verde');
    const borrado = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO', { funciones: null }) });
    expect(borrado.secciones.producto).toMatchObject({ estado: 'amarillo', faltan: 1, faltantes: ['funciones'] });
  });

  it('el area responsable es obligatoria en los cinco tipos: vacia, Producto queda pendiente (P4)', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      expect(calcularCompletitud({ tipo, valores: llenar(tipo) }).secciones.producto.estado, tipo).toBe('verde');
      const sin = calcularCompletitud({ tipo, valores: llenar(tipo, { area_responsable: null }) });
      expect(sin.secciones.producto, tipo).toMatchObject({ estado: 'amarillo', faltan: 1, faltantes: ['area_responsable'] });
      expect(sin.area.faltan, tipo).toBe(1);
    }
  });

  it('desmarcar «No aplica» (aspecto fisico, tipo de empaque) vuelve a pendiente', () => {
    const conNoAplica = llenar('REPUESTO', { aspecto_fisico: { no_aplica: true }, tipo_empaque: { no_aplica: true } });
    expect(calcularCompletitud({ tipo: 'REPUESTO', valores: conNoAplica }).secciones.detalle.estado).toBe('verde');
    const sin = calcularCompletitud({ tipo: 'REPUESTO', valores: { ...conNoAplica, aspecto_fisico: null, tipo_empaque: null } });
    expect(sin.secciones.detalle.faltantes.sort()).toEqual(['aspecto_fisico', 'tipo_empaque']);
  });

  it('desmarcar «El proveedor es el mismo fabricante» vuelve a pendiente', () => {
    const vinculado = llenar('INSUMO', { proveedor: { mismo_fabricante: true } });
    expect(calcularCompletitud({ tipo: 'INSUMO', valores: vinculado }).secciones.detalle.estado).toBe('verde');
    expect(calcularCompletitud({ tipo: 'INSUMO', valores: { ...vinculado, proveedor: null } }).secciones.detalle.faltantes).toEqual(['proveedor']);
  });

  it('RIM: sin elegir falta; «No» basta; «Sí» exige la cantidad; volver a «No» deja de exigirla (E2)', () => {
    const base = llenar('INSUMO');
    const sinElegir = calcularCompletitud({ tipo: 'INSUMO', valores: { ...base, requiere_rim: null } });
    expect(sinElegir.secciones.especificaciones.faltantes).toEqual(['requiere_rim']);

    const no = calcularCompletitud({ tipo: 'INSUMO', valores: { ...base, requiere_rim: 'NO' } });
    expect(no.secciones.especificaciones).toMatchObject({ estado: 'verde', faltan: 0 });

    const si = calcularCompletitud({ tipo: 'INSUMO', valores: { ...base, requiere_rim: 'SI' } });
    expect(si.secciones.especificaciones).toMatchObject({ estado: 'amarillo', faltan: 1, faltantes: ['cantidad_rim'] });

    const siConCantidad = calcularCompletitud({ tipo: 'INSUMO', valores: { ...base, requiere_rim: 'SI', cantidad_rim: { valor: '5', expresion: '5' } } });
    expect(siConCantidad.secciones.especificaciones.estado).toBe('verde');
    expect(siConCantidad.area.total).toBe(no.area.total + 1);

    // La cantidad sigue guardada, pero con «No» ya no se pide.
    const otraVezNo = calcularCompletitud({ tipo: 'INSUMO', valores: { ...base, requiere_rim: 'NO', cantidad_rim: { valor: '5', expresion: '5' } } });
    expect(otraVezNo.secciones.especificaciones.estado).toBe('verde');
    expect(otraVezNo.area.total).toBe(no.area.total);
  });

  it('desmarcar «No aplica» en la aduana (restricciones, observaciones) vuelve a pendiente', () => {
    const completa = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO', { ...aduanaCompleta, restricciones: { no_aplica: true } }) });
    expect(completa.aduana.faltantes).toEqual(['clasificacion_finalizada']);
    const sin = calcularCompletitud({ tipo: 'INSUMO', valores: llenar('INSUMO', { ...aduanaCompleta, restricciones: null, observaciones_aduana: null }) });
    expect(sin.aduana.faltantes.sort()).toEqual(['clasificacion_finalizada', 'observaciones_aduana', 'restricciones']);
  });
});

describe('clasificacion finalizada = NO (8.2, CA-11)', () => {
  it('pone amarilla Especificaciones aunque el area haya terminado', () => {
    const c = calcularCompletitud({
      tipo: 'INSUMO',
      valores: llenar('INSUMO', { clasificacion_finalizada: 'NO' }),
    });
    expect(c.secciones.especificaciones.estado).toBe('amarillo');
    expect(c.secciones.especificaciones.texto).toBe('La aduana pidió más información');
    expect(c.tresSeccionesVerdes).toBe(false);
    expect(c.finalizada).toBe('NO');
  });

  it('con SI no cambia el color de seccion', () => {
    const c = calcularCompletitud({
      tipo: 'INSUMO',
      valores: llenar('INSUMO', { clasificacion_finalizada: 'SI' }),
    });
    expect(c.secciones.especificaciones.estado).toBe('verde');
    expect(c.finalizada).toBe('SI');
  });
});

describe('parte de la aduana', () => {
  it('las descripciones minimas adicionales son un obligatorio de la aduana y no tiñen Especificaciones', () => {
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: llenar('REPUESTO', { partida_arancelaria: '8501.31.20.00' }) });
    expect(c.aduana.faltantes).toContain('descripciones_minimas');
    expect(c.secciones.especificaciones.faltantes).not.toContain('descripciones_minimas');
    expect(c.secciones.especificaciones.estado).toBe('verde');
  });

  it('queda verde con partida, descripciones («No aplica»), restricciones, observaciones y clasificacion finalizada', () => {
    const abierta = calcularCompletitud({ tipo: 'REPUESTO', valores: llenar('REPUESTO', aduanaCompleta) });
    expect(abierta.aduana).toMatchObject({ faltan: 1, faltantes: ['clasificacion_finalizada'], completo: false });

    const cerrada = calcularCompletitud({ tipo: 'REPUESTO', valores: llenar('REPUESTO', { ...aduanaCompleta, clasificacion_finalizada: 'SI' }) });
    expect(cerrada.aduana).toMatchObject({ faltan: 0, faltantes: [], completo: true });
  });

  it('un NO en clasificacion finalizada no cuenta como cerrada', () => {
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: llenar('REPUESTO', { ...aduanaCompleta, clasificacion_finalizada: 'NO' }) });
    expect(c.aduana.faltantes).toEqual(['clasificacion_finalizada']);
    expect(c.aduana.completo).toBe(false);
  });

  it('un texto de solo espacios en descripciones minimas no cuenta', () => {
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: llenar('REPUESTO', { ...aduanaCompleta, descripciones_minimas: '  \n ' }) });
    expect(c.aduana.faltantes).toContain('descripciones_minimas');
  });
});

describe('A2: solicitud de la aduana y respuesta del area', () => {
  const solicitud = '¿El motor es AC o DC? Amperaje';
  const conSolicitud = (respuesta?: unknown) =>
    llenar('REPUESTO', { ...aduanaCompleta, descripciones_minimas: solicitud, ...(respuesta === undefined ? {} : { respuesta_area: respuesta }) });

  it('una solicitud sin respuesta deja pendiente la parte de la aduana (sin teñir las secciones del area)', () => {
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: conSolicitud() });
    expect(c.aduana.faltantes).toEqual(['respuesta_area', 'clasificacion_finalizada']);
    expect(c.aduana.total).toBe(6);
    expect(c.area.completo).toBe(true);
    expect(solicitudSinRespuesta(conSolicitud())).toBe(true);
  });

  it('la respuesta a ESA solicitud la completa', () => {
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: conSolicitud({ texto: 'DC, 5 A', sobre: solicitud }) });
    expect(c.aduana.faltantes).toEqual(['clasificacion_finalizada']);
  });

  it('si la aduana cambia la solicitud despues de la respuesta, vuelve a quedar pendiente', () => {
    const v = { ...conSolicitud({ texto: 'DC, 5 A', sobre: solicitud }), descripciones_minimas: `${solicitud}. ¿Voltaje?` };
    expect(calcularCompletitud({ tipo: 'REPUESTO', valores: v }).aduana.faltantes).toContain('respuesta_area');
  });

  it('borrar la respuesta vuelve a pendiente; «No aplica» en la solicitud deja de pedir respuesta', () => {
    expect(calcularCompletitud({ tipo: 'REPUESTO', valores: conSolicitud(null) }).aduana.faltantes).toContain('respuesta_area');
    const noAplica = { ...conSolicitud({ texto: 'x', sobre: 'otra' }), descripciones_minimas: { no_aplica: true } };
    const c = calcularCompletitud({ tipo: 'REPUESTO', valores: noAplica });
    expect(c.aduana.faltantes).toEqual(['clasificacion_finalizada']);
    expect(c.aduana.total).toBe(5);
  });
});
