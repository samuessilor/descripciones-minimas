import { describe, expect, it } from 'vitest';
import { esPartidaValida, formatearPartida, normalizarPartida } from '@/dominio/partida';

describe('partida arancelaria NNNN.NN.NN.NN', () => {
  it('acepta el formato valido', () => {
    expect(esPartidaValida('8421.39.90.00')).toBe(true);
    expect(esPartidaValida('8501.31.20.00')).toBe(true);
  });

  it('rechaza formatos invalidos', () => {
    for (const mala of [
      '8421399000',
      '8421.39.90',
      '842.139.90.00',
      '8421.39.90.0a',
      '',
      ' 8421.39.90.00',
      '8421.39.90.000',
    ]) {
      expect(esPartidaValida(mala), mala).toBe(false);
    }
  });

  it('formatea progresivamente mientras se escribe (mascara)', () => {
    expect(formatearPartida('84')).toBe('84');
    expect(formatearPartida('84213')).toBe('8421.3');
    expect(formatearPartida('842139')).toBe('8421.39');
    expect(formatearPartida('8421399')).toBe('8421.39.9');
    expect(formatearPartida('8421399000')).toBe('8421.39.90.00');
  });

  it('ignora lo que no es digito y recorta el exceso', () => {
    expect(formatearPartida('8421.39-90 00 99')).toBe('8421.39.90.00');
    expect(formatearPartida('abc')).toBe('');
  });

  it('normalizarPartida rechaza texto basura alrededor de los 10 digitos', () => {
    for (const mala of ['ab8421399000cd', '8421399000x', 'x8421399000', '8421.39.90.00\nabc', '84 21 abc 39 90 00', '8421/39/90/00', '(8421399000)']) {
      expect(normalizarPartida(mala), JSON.stringify(mala)).toBeNull();
    }
  });

  it('normalizarPartida acepta solo digitos con puntos, guiones y espacios como separadores', () => {
    expect(normalizarPartida('8421-39-90-00')).toBe('8421.39.90.00');
    expect(normalizarPartida('8421 39 90 00')).toBe('8421.39.90.00');
    expect(normalizarPartida('  8421.39.90.00  ')).toBe('8421.39.90.00');
  });

  it('normalizarPartida devuelve la partida completa o null', () => {
    expect(normalizarPartida('8421399000')).toBe('8421.39.90.00');
    expect(normalizarPartida('8421.39.90.00')).toBe('8421.39.90.00');
    expect(normalizarPartida('8421.39')).toBeNull();
    expect(normalizarPartida('84213990001')).toBeNull();
  });
});
