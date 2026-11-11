import { describe, expect, it } from 'vitest';
import matriz from '../fixtures/matriz-spec7.json';
import {
  ARANCELES,
  CAMPOS,
  CAMPOS_RETIRADOS,
  EMPAQUES,
  EMPAQUES_CON_CONTENIDO,
  ETIQUETA_TIPO,
  IVAS,
  TIPOS_PRODUCTO,
  aplicaEnFicha,
  ayudaPara,
  camposPantalla,
  camposObligatoriosAduana,
  camposObligatoriosCliente,
  esVisible,
  getCampo,
  obligatoriedadPara,
  type TipoProducto,
} from '@/dominio/campos';

describe('catalogo de campos contra la matriz del SPEC 7 con los cambios de la reunion (R-06)', () => {
  it('tiene exactamente las filas de la matriz', () => {
    expect(matriz.filas).toHaveLength(32);
    expect(CAMPOS.map((c) => c.clave).sort()).toEqual(matriz.filas.map((f) => f.clave).sort());
  });

  for (const fila of matriz.filas) {
    it(`fila ${fila.fila} ${fila.clave}: seccion, grupo y obligatoriedad por tipo`, () => {
      const c = getCampo(fila.clave);
      expect(c, fila.clave).toBeDefined();
      if (!c) return;
      expect(c.grupo).toBe(fila.grupo);
      expect(c.seccion).toBe(fila.seccion);
      expect(c.confianza).toBe(fila.conf);
      expect(c.fila).toBe(fila.fila);
      TIPOS_PRODUCTO.forEach((t, i) => {
        expect(obligatoriedadPara(c, t), `${fila.clave}/${t}`).toBe(fila.obl[i]);
      });
    });
  }

  it('los cinco tipos, con Montura', () => {
    expect(TIPOS_PRODUCTO).toEqual(['INSUMO', 'REPUESTO', 'EQUIPO', 'ACCESORIO', 'MONTURA']);
    expect(ETIQUETA_TIPO.MONTURA).toBe('Montura');
  });

  it('la montura sigue al accesorio salvo que no lleva «Máquina donde se instala» (P1)', () => {
    for (const c of CAMPOS) {
      if (c.clave === 'maquina_destino') continue;
      expect(c.reglas.MONTURA, c.clave).toBe(c.reglas.ACCESORIO);
    }
    expect(esVisible(getCampo('maquina_destino')!, 'ACCESORIO')).toBe(true);
    expect(esVisible(getCampo('maquina_destino')!, 'MONTURA')).toBe(false);
  });

  it('descripcion, uso, funciones y unidad de medida son obligatorios en todos los tipos (P2)', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      expect(camposObligatoriosCliente(tipo).map((c) => c.clave)).toEqual(
        expect.arrayContaining(['descripcion_factura', 'uso', 'funciones', 'unidad_medida', 'aspecto_fisico', 'fabricante', 'proveedor', 'tipo_empaque', 'reembolsable']),
      );
    }
  });

  it('solo fecha_fabricacion y maquina_destino cambian de visibilidad por tipo (D-06)', () => {
    const ocultos: Record<string, TipoProducto[]> = {};
    for (const c of CAMPOS) {
      const o = TIPOS_PRODUCTO.filter((t) => !esVisible(c, t));
      if (o.length) ocultos[c.clave] = o;
    }
    expect(ocultos).toEqual({
      fecha_fabricacion: ['INSUMO', 'REPUESTO', 'ACCESORIO', 'MONTURA'],
      maquina_destino: ['INSUMO', 'EQUIPO', 'MONTURA'],
    });
  });

  it('el orden de pantalla respeta REU y D-08 (partida antes de informacion adicional, finalizada al final)', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      const { producto, detalle, especificaciones, complementos_aduana } = matriz.orden_pantalla;
      const vistos = camposPantalla(tipo);
      const cuando = (seccion: string, sub: boolean) =>
        vistos.filter((c) => c.seccion === seccion && (c.subbloque === 'complementos_aduana') === sub).map((c) => c.clave);
      const filtrar = (lista: string[]) => lista.filter((k) => esVisible(getCampo(k)!, tipo));
      expect(cuando('producto', false)).toEqual(filtrar(producto));
      expect(cuando('detalle', false)).toEqual(filtrar(detalle));
      expect(cuando('especificaciones', false)).toEqual(filtrar(especificaciones));
      expect(cuando('especificaciones', true)).toEqual(filtrar(complementos_aduana));
    }
  });

  it('los campos retirados no se muestran ni se escriben, pero conservan su etiqueta para el historial (E1, A5)', () => {
    expect(CAMPOS_RETIRADOS.map((c) => c.clave).sort()).toEqual([...matriz.retiradas].sort());
    for (const clave of matriz.retiradas) {
      const c = getCampo(clave)!;
      expect(c.etiqueta).not.toBe('');
      expect(c.escribible).toBe(false);
      for (const tipo of TIPOS_PRODUCTO) expect(esVisible(c, tipo)).toBe(false);
      expect(CAMPOS.some((x) => x.clave === clave)).toBe(false);
    }
  });

  it('admiten «No aplica» exactamente los campos de la reunion (D1, D4, A2-A4)', () => {
    expect(CAMPOS.filter((c) => c.noAplica).map((c) => c.clave).sort()).toEqual([...matriz.no_aplica].sort());
    expect(getCampo('descripciones_minimas')?.noAplica).toBe('No es necesario por ahora / no aplica');
  });

  it('requiere_rim lo llena la aduana (grupo A), sigue obligatorio y cantidad_rim ya no existe (reunion 2026-11)', () => {
    const rim = getCampo('requiere_rim')!;
    expect(rim).toMatchObject({ grupo: 'A', tipoDato: 'si_no', seccion: 'especificaciones', escribible: true });
    for (const tipo of TIPOS_PRODUCTO) {
      expect(obligatoriedadPara(rim, tipo), tipo).toBe('O');
      expect(camposObligatoriosAduana(tipo).map((c) => c.clave)).toContain('requiere_rim');
      expect(camposObligatoriosCliente(tipo).map((c) => c.clave)).not.toContain('requiere_rim');
    }
    expect(CAMPOS.some((c) => c.clave === 'cantidad_rim')).toBe(false);
    expect(CAMPOS_RETIRADOS.some((c) => c.clave === 'cantidad_rim')).toBe(true);
  });

  it('tipo_empaque es una lista fija (Bidón, Paquete, Unidad), siempre obligatoria y sin «No aplica»', () => {
    const empaque = getCampo('tipo_empaque')!;
    expect(empaque).toMatchObject({ tipoDato: 'lista', grupo: 'C', seccion: 'detalle' });
    expect(empaque.opciones).toEqual(['Bidón', 'Paquete', 'Unidad']);
    expect(EMPAQUES).toEqual(['Bidón', 'Paquete', 'Unidad']);
    expect(empaque.noAplica).toBeFalsy();
    for (const tipo of TIPOS_PRODUCTO) {
      expect(obligatoriedadPara(empaque, tipo), tipo).toBe('O');
      expect(aplicaEnFicha(empaque, tipo, {}), tipo).toBe(true);
      expect(camposObligatoriosCliente(tipo, undefined, {}).map((c) => c.clave)).toContain('tipo_empaque');
    }
  });

  it('el contenido por empaque solo aplica con Bidón o Paquete y cuenta como obligatorio solo entonces', () => {
    const contenido = getCampo('cantidad_empaque')!;
    expect(contenido).toMatchObject({ grupo: 'C', seccion: 'detalle', fila: 34, tipoDato: 'texto' });
    expect(EMPAQUES_CON_CONTENIDO).toEqual(['Bidón', 'Paquete']);
    for (const tipo of TIPOS_PRODUCTO) {
      expect(aplicaEnFicha(contenido, tipo, {}), `${tipo}/vacio`).toBe(false);
      expect(aplicaEnFicha(contenido, tipo, { tipo_empaque: 'Unidad' }), `${tipo}/Unidad`).toBe(false);
      expect(aplicaEnFicha(contenido, tipo, { tipo_empaque: 'Bidón' }), `${tipo}/Bidón`).toBe(true);
      expect(aplicaEnFicha(contenido, tipo, { tipo_empaque: 'Paquete' }), `${tipo}/Paquete`).toBe(true);
    }
    const claves = (v: Record<string, unknown>) => camposObligatoriosCliente('INSUMO', undefined, v).map((c) => c.clave);
    expect(claves({ tipo_empaque: 'Unidad' })).not.toContain('cantidad_empaque');
    expect(claves({})).not.toContain('cantidad_empaque');
    expect(claves({ tipo_empaque: 'Bidón' })).toContain('cantidad_empaque');
    expect(claves({ tipo_empaque: 'Paquete' })).toContain('cantidad_empaque');
  });

  it('la fecha de fabricacion es opcional («si aplica»), visible solo en equipos, y vive en detalle', () => {
    const fecha = getCampo('fecha_fabricacion')!;
    expect(fecha.seccion).toBe('detalle');
    expect(obligatoriedadPara(fecha, 'EQUIPO')).toBe('P');
    for (const tipo of TIPOS_PRODUCTO) {
      if (tipo !== 'EQUIPO') expect(esVisible(fecha, tipo), tipo).toBe(false);
      expect(camposObligatoriosCliente(tipo).map((c) => c.clave), tipo).not.toContain('fecha_fabricacion');
    }
  });

  it('las etiquetas de uso y funciones son las que pidio la usuaria en todos los tipos, sin el duplicado «Máquina:» en las ayudas', () => {
    expect(getCampo('uso')?.etiqueta).toBe('Uso/Función específica del producto');
    expect(getCampo('funciones')?.etiqueta).toBe('Función de la máquina');
    for (const tipo of TIPOS_PRODUCTO) expect(ayudaPara(getCampo('uso')!, tipo), tipo).not.toMatch(/máquina/i);
    expect(ayudaPara(getCampo('uso')!, 'INSUMO')).not.toBe(ayudaPara(getCampo('uso')!, 'REPUESTO'));
    expect(getCampo('informacion_adicional')?.ayuda).toBe('Información relevante que el área quiera añadir.');
  });

  it('las etiquetas de nombre_producto y descripcion_factura se intercambian sin cambiar las claves (reunion 2026-11-09)', () => {
    const titulo = getCampo('nombre_producto')!;
    expect(titulo).toMatchObject({ etiqueta: 'Descripción según factura', maximo: 500, tipoDato: 'texto_largo' });
    expect(titulo.ayuda).toMatch(/FILTRO/);
    const comercial = getCampo('descripcion_factura')!;
    expect(comercial).toMatchObject({ etiqueta: 'Nombre comercial', seccion: 'detalle' });
    expect(comercial.ayuda).toBe('Ej.: NSR E1');
  });

  it('Producto es la identificacion y la compra, en este orden (reunion 2026-11-10)', () => {
    const claves = CAMPOS.filter((c) => c.seccion === 'producto').map((c) => c.clave);
    expect(claves).toEqual([
      'codigo', 'nombre_producto', 'tipo_producto', 'area_responsable', 'pais_origen', 'unidad_medida', 'proveedor', 'reembolsable',
      'fecha_solicitud', 'dias_gestion',
    ]);
    for (const k of ['pais_origen', 'proveedor']) expect(getCampo(k)).toMatchObject({ seccion: 'producto', grupo: 'C' });
    expect(getCampo('unidad_medida')?.etiqueta).toBe('Unidad de medida según factura');
  });

  it('Detalle empieza por nombre comercial, uso, maquina de destino, funcion y fabricante, y sigue con lo de siempre', () => {
    const claves = CAMPOS.filter((c) => c.seccion === 'detalle').map((c) => c.clave);
    expect(claves).toEqual([
      'descripcion_factura', 'uso', 'maquina_destino', 'funciones', 'fabricante',
      'materia_constitutiva', 'aspecto_fisico', 'marca', 'tipo_empaque', 'cantidad_empaque', 'fecha_fabricacion',
    ]);
    expect(getCampo('maquina_destino')?.etiqueta).toBe('Máquina de destino');
    expect(getCampo('fabricante')).toMatchObject({ seccion: 'detalle', grupo: 'C', tipoDato: 'texto' });
  });

  it('arancel e IVA: la aduana los elige de una lista, justo despues de la partida', () => {
    expect(ARANCELES).toEqual(['0%', '5%', '10%', '15%']);
    expect(IVAS).toEqual(['0%', '19%']);
    expect(getCampo('arancel')).toMatchObject({ etiqueta: 'Arancel', grupo: 'A', tipoDato: 'lista', seccion: 'especificaciones', escribible: true, fila: 36 });
    expect(getCampo('iva')).toMatchObject({ etiqueta: 'IVA', grupo: 'A', tipoDato: 'lista', seccion: 'especificaciones', escribible: true, fila: 37 });
    expect(getCampo('arancel')?.opciones).toEqual(ARANCELES);
    expect(getCampo('iva')?.opciones).toEqual(IVAS);
    const espec = CAMPOS.filter((c) => c.seccion === 'especificaciones' && c.subbloque === null).map((c) => c.clave);
    expect(espec.slice(espec.indexOf('partida_arancelaria'), espec.indexOf('partida_arancelaria') + 3)).toEqual(['partida_arancelaria', 'arancel', 'iva']);
    for (const tipo of TIPOS_PRODUCTO) {
      expect(camposObligatoriosAduana(tipo).map((c) => c.clave)).toEqual(expect.arrayContaining(['arancel', 'iva']));
      expect(camposObligatoriosCliente(tipo).map((c) => c.clave)).not.toContain('arancel');
    }
  });

  it('reembolsable: lista fija Sí / No / No aplica, obligatoria en todos los tipos, del cliente y sin catalogo', () => {
    const c = getCampo('reembolsable')!;
    expect(c).toMatchObject({ etiqueta: 'Reembolsable', seccion: 'producto', grupo: 'C', fila: 35, tipoDato: 'lista', escribible: true });
    expect(c.opciones).toEqual(['Sí', 'No', 'No aplica']);
    expect(c.catalogo).toBeUndefined();
    expect(c.noAplica).toBeFalsy();
    for (const tipo of TIPOS_PRODUCTO) {
      expect(obligatoriedadPara(c, tipo), tipo).toBe('O');
      expect(camposObligatoriosCliente(tipo, 'producto', {}).map((x) => x.clave), tipo).toContain('reembolsable');
    }
  });

  it('solo el cliente (C) cuenta para el color de seccion: los O de la aduana y la respuesta del area quedan fuera (D-26)', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      const claves = camposObligatoriosCliente(tipo).map((c) => c.clave);
      for (const fuera of ['partida_arancelaria', 'arancel', 'iva', 'descripciones_minimas', 'restricciones', 'observaciones_aduana', 'clasificacion_finalizada', 'respuesta_area']) {
        expect(claves).not.toContain(fuera);
      }
    }
    // La fecha de fabricacion es opcional («si aplica»): ya no cuenta para el color de la seccion ni en equipos.
    expect(camposObligatoriosCliente('EQUIPO').map((c) => c.clave)).not.toContain('fecha_fabricacion');
  });

  it('descripciones minimas adicionales: texto de la aduana, obligatorio; la aduana cuenta ocho obligatorios (con requiere_rim, arancel e iva)', () => {
    const dm = getCampo('descripciones_minimas');
    expect(dm).toMatchObject({ etiqueta: 'Descripciones mínimas adicionales', grupo: 'A', tipoDato: 'texto_largo', escribible: true, subbloque: null });
    expect(dm?.maximo).toBeGreaterThanOrEqual(2000);
    for (const tipo of TIPOS_PRODUCTO) {
      expect(camposObligatoriosAduana(tipo).map((c) => c.clave).sort()).toEqual(
        ['arancel', 'clasificacion_finalizada', 'descripciones_minimas', 'iva', 'observaciones_aduana', 'partida_arancelaria', 'requiere_rim', 'restricciones'],
      );
    }
    expect(getCampo('respuesta_area')).toMatchObject({ grupo: 'C', tipoDato: 'respuesta', subbloque: 'complementos_aduana' });
  });

  it('el campo clasificacion_finalizada es desplegable SI/NO y tipo_producto desplegable (RV-09)', () => {
    expect(getCampo('clasificacion_finalizada')?.tipoDato).toBe('si_no');
    expect(getCampo('tipo_producto')?.tipoDato).toBe('tipo_producto');
  });
});
