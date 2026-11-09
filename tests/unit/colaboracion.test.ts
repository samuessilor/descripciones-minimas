import { describe, expect, it } from 'vitest';
import {
  TransicionAsignacionInvalida,
  enlaceInicio,
  enlaceReferencia,
  esAsignacionActiva,
  inicioDiaBogota,
  nombreSinMarca,
  partesDeAsignacion,
  pedidoCompatible,
  pedidoPorDefecto,
  pedidosPermitidos,
  plural,
  puedeRecibirAsignacion,
  puedeTransicionarAsignacion,
  textoDias,
  tiempoRelativo,
  transicionarAsignacion,
  type EstadoAsignacion,
  type EventoAsignacion,
} from '@/dominio/colaboracion';
import { textoDeValor } from '@/dominio/mostrar-valor';
import { getCampo } from '@/dominio/campos';
import { calcularCompletitud } from '@/dominio/completitud';
import { describirFalta } from '@/server/politicas/colaboracion';

describe('pedidos por rol (8.3 regla 1)', () => {
  it('cada rol solo recibe pedidos que puede cumplir', () => {
    expect(pedidosPermitidos('aduana')).toEqual(['clasificar', 'revisar']);
    expect(pedidosPermitidos('solicitante')).toEqual(['completar', 'responder', 'revisar']);
    expect(pedidosPermitidos('admin')).toHaveLength(4);
    expect(pedidosPermitidos('supervisor')).toEqual(pedidosPermitidos('admin'));
    expect(pedidosPermitidos('lector')).toEqual([]);
  });

  it('el pedido por defecto sigue al rol', () => {
    expect(pedidoPorDefecto('aduana')).toBe('clasificar');
    expect(pedidoPorDefecto('solicitante')).toBe('completar');
    expect(pedidoPorDefecto('admin')).toBe('completar');
    expect(pedidoPorDefecto('supervisor')).toBe('completar');
  });

  it('compatibilidad y quien puede recibir', () => {
    expect(pedidoCompatible('aduana', 'completar')).toBe(false);
    expect(pedidoCompatible('solicitante', 'clasificar')).toBe(false);
    expect(pedidoCompatible('admin', 'clasificar')).toBe(true);
    expect(puedeRecibirAsignacion('lector')).toBe(false);
    expect(puedeRecibirAsignacion('aduana')).toBe(true);
  });
});

describe('maquina de estados de la asignacion (8.3)', () => {
  const ESTADOS: EstadoAsignacion[] = ['pendiente', 'en_curso', 'hecha', 'reasignada', 'cancelada'];
  const EVENTOS: EventoAsignacion[] = ['abrir', 'terminar', 'cancelar', 'reasignar'];

  it('transiciones validas del diagrama', () => {
    expect(transicionarAsignacion('pendiente', 'abrir')).toBe('en_curso');
    expect(transicionarAsignacion('pendiente', 'terminar')).toBe('hecha');
    expect(transicionarAsignacion('en_curso', 'terminar')).toBe('hecha');
    expect(transicionarAsignacion('pendiente', 'cancelar')).toBe('cancelada');
    expect(transicionarAsignacion('en_curso', 'cancelar')).toBe('cancelada');
    expect(transicionarAsignacion('pendiente', 'reasignar')).toBe('reasignada');
    expect(transicionarAsignacion('en_curso', 'reasignar')).toBe('reasignada');
  });

  it('no existe ninguna transicion desde un estado terminal (ni hecha -> pendiente)', () => {
    for (const estado of ['hecha', 'reasignada', 'cancelada'] as const) {
      for (const evento of EVENTOS) {
        expect(puedeTransicionarAsignacion(estado, evento)).toBe(false);
        expect(() => transicionarAsignacion(estado, evento)).toThrow(TransicionAsignacionInvalida);
      }
    }
  });

  it('abrir solo sale de pendiente; la combinacion completa son exactamente 7 transiciones', () => {
    let validas = 0;
    for (const s of ESTADOS) for (const ev of EVENTOS) if (puedeTransicionarAsignacion(s, ev)) validas += 1;
    expect(validas).toBe(7);
    expect(puedeTransicionarAsignacion('en_curso', 'abrir')).toBe(false);
  });

  it('activa = pendiente o en_curso', () => {
    expect(ESTADOS.filter(esAsignacionActiva)).toEqual(['pendiente', 'en_curso']);
  });
});

describe('fechas y tiempo', () => {
  it('el dia de Bogota empieza a las 05:00 UTC (UTC-5, sin horario de verano)', () => {
    expect(inicioDiaBogota(new Date('2026-10-21T15:00:00Z')).toISOString()).toBe('2026-10-21T05:00:00.000Z');
    // 02:00 UTC del 22 todavia es el 21 en Bogota (21:00).
    expect(inicioDiaBogota(new Date('2026-10-22T02:00:00Z')).toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(inicioDiaBogota(new Date('2026-10-22T05:00:00Z')).toISOString()).toBe('2026-10-22T05:00:00.000Z');
  });

  it('tiempo relativo en espanol', () => {
    const ahora = new Date('2026-10-21T15:00:00Z');
    const antes = (ms: number) => new Date(ahora.getTime() - ms);
    expect(tiempoRelativo(antes(10_000), ahora)).toBe('ahora mismo');
    expect(tiempoRelativo(antes(5 * 60_000), ahora)).toBe('hace 5 min');
    expect(tiempoRelativo(antes(2 * 3_600_000), ahora)).toBe('hace 2 h');
    expect(tiempoRelativo(antes(30 * 3_600_000), ahora)).toBe('ayer');
    expect(tiempoRelativo(antes(3 * 86_400_000), ahora)).toBe('hace 3 días');
    expect(tiempoRelativo(antes(40 * 86_400_000), ahora)).toBe('11 sep');
  });

  it('plural y dias', () => {
    expect(plural(1, 'referencia', 'referencias')).toBe('1 referencia');
    expect(plural(3, 'referencia', 'referencias')).toBe('3 referencias');
    expect(textoDias(1)).toBe('1 día');
    expect(textoDias(5)).toBe('5 días');
  });
});

describe('enlaces: solo el UUID, nada de la mercancia (D-23)', () => {
  it('construye el enlace directo sin barras dobles', () => {
    expect(enlaceReferencia('https://dm.example.com/', 'abc')).toBe('https://dm.example.com/referencias/abc');
    expect(enlaceReferencia('http://localhost:3013', 'abc')).toBe('http://localhost:3013/referencias/abc');
    expect(enlaceInicio('https://dm.example.com//')).toBe('https://dm.example.com/');
  });

  it('quita la marca [DESARROLLO] del nombre', () => {
    expect(nombreSinMarca('Ana Admin [DESARROLLO]')).toBe('Ana Admin');
    expect(nombreSinMarca('Brian')).toBe('Brian');
  });
});

describe('texto legible de un valor (historial)', () => {
  it('marca, cantidad, pais, vacio y texto', () => {
    expect(textoDeValor(getCampo('marca') ?? null, { texto: 'NAGA' })).toBe('NAGA');
    expect(textoDeValor(getCampo('marca') ?? null, { sin_marca: true })).toBe('No tiene marca');
    expect(textoDeValor(getCampo('pais_origen') ?? null, 'FR')).toBe('Francia');
    expect(textoDeValor(null, null)).toBe('Vacío');
    expect(textoDeValor(null, 'hola')).toBe('hola');
    expect(textoDeValor(getCampo('valor_unitario') ?? null, '12.5')).toBe('12,5 USD');
    expect(textoDeValor(null, { por_confirmar: true, nota: 'pre-inspección' })).toBe('Por confirmar (pre-inspección)');
    // El historial muestra lo mismo que la ficha: etiqueta del tipo y fecha larga, no la clave ni el ISO crudos.
    expect(textoDeValor(getCampo('tipo_producto') ?? null, 'INSUMO')).toBe('Insumo');
    expect(textoDeValor(getCampo('fecha_solicitud') ?? null, '2026-10-27')).toBe('27 de octubre de 2026');
    expect(textoDeValor(getCampo('fecha_fabricacion') ?? null, { fecha: '2026-10-27' })).toBe('27 de octubre de 2026');
  });
});

describe('describirFalta: la frase de «Para mí» para la aduana', () => {
  it('con RIM, partida, descripciones, restricciones y observaciones solo falta cerrar; una solicitud sin respuesta espera al area', () => {
    const completa = { requiere_rim: 'NO', partida_arancelaria: '8501.31.20.00', descripciones_minimas: { no_aplica: true }, restricciones: 'Ninguna', observaciones_aduana: { no_aplica: true } };
    const c = calcularCompletitud({ tipo: 'INSUMO', valores: completa });
    expect(describirFalta(c, 'clasificar', 'EN_GESTION')).toBe('Falta cerrar la clasificación');
    const sinPartida = calcularCompletitud({ tipo: 'INSUMO', valores: { ...completa, partida_arancelaria: null } });
    expect(describirFalta(sinPartida, 'clasificar', 'EN_GESTION')).toBe('Falta 1 dato de la aduana');
    const esperando = calcularCompletitud({ tipo: 'INSUMO', valores: { ...completa, descripciones_minimas: '¿AC o DC?' } });
    expect(describirFalta(esperando, 'clasificar', 'EN_GESTION')).toBe('Esperando la respuesta del área');
  });
});

describe('partesDeAsignacion: asignaciones antiguas de Detalle tras mover pais, fabricante y proveedor a Producto', () => {
  it('una asignacion que solo dice «detalle» tambien cubre Producto; el resto queda igual', () => {
    expect(partesDeAsignacion('detalle', 'solicitante')).toEqual(['producto', 'detalle']);
    expect(partesDeAsignacion('producto,detalle', 'solicitante')).toEqual(['producto', 'detalle']);
    expect(partesDeAsignacion('producto', 'solicitante')).toEqual(['producto']);
    expect(partesDeAsignacion('especificaciones', 'solicitante')).toEqual(['especificaciones']);
    expect(partesDeAsignacion(null, 'solicitante')).toEqual(['producto', 'detalle', 'especificaciones']);
    expect(partesDeAsignacion('detalle', 'aduana')).toEqual(['aduana']);
  });
});
