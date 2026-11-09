import { describe, expect, it } from 'vitest';
import matriz from '../fixtures/matriz-spec7.json';
import {
  CAMPOS,
  CAMPOS_RETIRADOS,
  EMPAQUES,
  EMPAQUES_CON_CONTENIDO,
  ETIQUETA_TIPO,
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
    expect(matriz.filas).toHaveLength(29);
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
        expect.arrayContaining(['descripcion_factura', 'uso', 'funciones', 'unidad_medida', 'aspecto_fisico', 'fabricante', 'proveedor', 'tipo_empaque']),
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

  it('las etiquetas de uso y funciones son las que pidio la usuaria en todos los tipos', () => {
    expect(getCampo('uso')?.etiqueta).toBe('Uso');
    expect(getCampo('funciones')?.etiqueta).toBe('Funciones');
    expect(ayudaPara(getCampo('uso')!, 'REPUESTO')).toMatch(/máquina/i);
    expect(ayudaPara(getCampo('uso')!, 'INSUMO')).not.toBe(ayudaPara(getCampo('uso')!, 'REPUESTO'));
    expect(getCampo('informacion_adicional')?.ayuda).toBe('Información relevante que el área quiera añadir.');
  });

  it('solo el cliente (C) cuenta para el color de seccion: los O de la aduana y la respuesta del area quedan fuera (D-26)', () => {
    for (const tipo of TIPOS_PRODUCTO) {
      const claves = camposObligatoriosCliente(tipo).map((c) => c.clave);
      for (const fuera of ['partida_arancelaria', 'descripciones_minimas', 'restricciones', 'observaciones_aduana', 'clasificacion_finalizada', 'respuesta_area']) {
        expect(claves).not.toContain(fuera);
      }
    }
    // La fecha de fabricacion es opcional («si aplica»): ya no cuenta para el color de la seccion ni en equipos.
    expect(camposObligatoriosCliente('EQUIPO').map((c) => c.clave)).not.toContain('fecha_fabricacion');
  });

  it('descripciones minimas adicionales: texto de la aduana, obligatorio; la aduana cuenta seis obligatorios (con requiere_rim)', () => {
    const dm = getCampo('descripciones_minimas');
    expect(dm).toMatchObject({ etiqueta: 'Descripciones mínimas adicionales', grupo: 'A', tipoDato: 'texto_largo', escribible: true, subbloque: null });
    expect(dm?.maximo).toBeGreaterThanOrEqual(2000);
    for (const tipo of TIPOS_PRODUCTO) {
      expect(camposObligatoriosAduana(tipo).map((c) => c.clave).sort()).toEqual(
        ['clasificacion_finalizada', 'descripciones_minimas', 'observaciones_aduana', 'partida_arancelaria', 'requiere_rim', 'restricciones'],
      );
    }
    expect(getCampo('respuesta_area')).toMatchObject({ grupo: 'C', tipoDato: 'respuesta', subbloque: 'complementos_aduana' });
  });

  it('el campo clasificacion_finalizada es desplegable SI/NO y tipo_producto desplegable (RV-09)', () => {
    expect(getCampo('clasificacion_finalizada')?.tipoDato).toBe('si_no');
    expect(getCampo('tipo_producto')?.tipoDato).toBe('tipo_producto');
  });
});
