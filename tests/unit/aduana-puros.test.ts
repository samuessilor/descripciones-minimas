/** Piezas puras del lado aduana (H4): mascara de la partida, neutralizacion de formulas, cierre y nombres de archivo. */
import { describe, expect, it } from 'vitest';
import { evaluarCierre, type EntradaCierre } from '@/dominio/estado';
import { digitosQueFaltan, mascaraPartida } from '@/dominio/partida-mascara';
import { esPartidaValida, normalizarPartida } from '@/dominio/partida';
import { COLUMNAS_BASE } from '@/server/exportar/columnas';
import { nombreDeArchivo } from '@/server/exportar';
import { fechaHoraBogota, fechaSolo } from '@/server/exportar/filas';
import { podriaSerFormula, prepararTexto, recortarCelda } from '@/server/exportar/neutralizar';
import { normasDeTexto } from '@/server/politicas/aduana';

/** Simula a una persona que escribe caracter por caracter (o borra) sobre el campo con mascara. */
function teclear(secuencia: string[], inicio = ''): string[] {
  const pasos: string[] = [];
  let actual = inicio;
  for (const tecla of secuencia) {
    const bruto = tecla === '<' ? actual.slice(0, -1) : actual + tecla;
    actual = mascaraPartida(bruto, actual);
    pasos.push(actual);
  }
  return pasos;
}

describe('mascara progresiva de la partida (NNNN.NN.NN.NN)', () => {
  it('pone los puntos al completar cada grupo, sin que la persona los escriba', () => {
    const pasos = teclear([...'8421399000']);
    expect(pasos).toEqual(['8', '84', '842', '8421.', '8421.3', '8421.39.', '8421.39.9', '8421.39.90.', '8421.39.90.0', '8421.39.90.00']);
    expect(esPartidaValida(pasos.at(-1) as string)).toBe(true);
  });

  it('no deja pasar de 10 digitos ni letras', () => {
    expect(mascaraPartida('8421.39.90.001', '8421.39.90.00')).toBe('8421.39.90.00');
    expect(mascaraPartida('84a2', '84')).toBe('842');
  });

  it('se puede borrar de a un caracter, incluidos los puntos, sin que la mascara los devuelva', () => {
    expect(teclear(['<', '<', '<'], '8421.39.')).toEqual(['8421.39', '8421.3', '8421']);
    // Borrando el punto final de "8421." queda "8421" y no reaparece:
    expect(mascaraPartida('8421', '8421.')).toBe('8421');
  });

  it('acepta pegar con otros separadores', () => {
    expect(mascaraPartida('8421-39-90-00', '')).toBe('8421.39.90.00');
    expect(mascaraPartida('8421 39 90 00', '')).toBe('8421.39.90.00');
    expect(mascaraPartida('84213990', '')).toBe('8421.39.90.');
  });

  it('dice cuantos digitos faltan', () => {
    expect(digitosQueFaltan('')).toBe(10);
    expect(digitosQueFaltan('8421.39')).toBe(4);
    expect(digitosQueFaltan('8421.39.90.00')).toBe(0);
  });

  it('la normalizacion del servidor acepta lo que produce la mascara y rechaza lo incompleto', () => {
    expect(normalizarPartida('8421.39.90.00')).toBe('8421.39.90.00');
    expect(normalizarPartida('8421.39.90.')).toBeNull();
    expect(normalizarPartida('=8421.39.90.00')).toBeNull();
  });
});

describe('neutralizacion de formulas (SPEC 13.4)', () => {
  it.each(['=1+1', '+cmd|calc', '-2+3', '@SUM(A1)', '\t=1', '\r=1', ' =1+1', '​=1+1'])(
    'marca %j como posible formula',
    (t) => {
      expect(podriaSerFormula(t)).toBe(true);
      expect(prepararTexto(t).formatoTexto).toBe(true);
    },
  );

  it.each(['Sin restricciones', '8421.39.90.00', 'Línea\n=nota', 'a=b', 'precio -5', 'ñandú', ''])('no toca %j', (t) => {
    expect(podriaSerFormula(t)).toBe(false);
    expect(prepararTexto(t)).toEqual({ texto: t, formatoTexto: false });
  });

  it('nunca altera el contenido (el dato no se modifica) y quita controles que rompen el XML', () => {
    expect(prepararTexto('=1+1').texto).toBe('=1+1');
    expect(prepararTexto('a\u0000b\u0008c\td\ne').texto).toBe('abc\td\ne');
  });

  it('recorta una celda desmesurada al limite de Excel', () => {
    const largo = 'x'.repeat(40_000);
    expect(recortarCelda(largo).length).toBeLessThanOrEqual(32_000);
    expect(recortarCelda('corto')).toBe('corto');
  });
});

describe('evaluarCierre (G1, G6, A1-A3)', () => {
  const base: EntradaCierre = {
    rol: 'aduana',
    fichaVisible: true,
    partida: '8421.39.90.00',
    camposAreaFaltantes: [],
    descripcionesVacias: false,
    restriccionesVacias: false,
    modo: 'advertir',
  };

  it('limpio: cierra sin motivo', () => {
    expect(evaluarCierre(base)).toEqual({ ok: true, advertencias: [], requiereMotivo: false });
  });
  it('G1: sin partida o con formato malo no cierra', () => {
    for (const partida of [null, '', '8421', '8421.39.90']) {
      const r = evaluarCierre({ ...base, partida });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toEqual(['G1']);
    }
  });
  it('G6: solo aduana y admin', () => {
    for (const rol of ['solicitante', 'lector'] as const) {
      const r = evaluarCierre({ ...base, rol });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.bloqueos[0]?.regla).toBe('G6');
    }
    expect(evaluarCierre({ ...base, rol: 'admin' }).ok).toBe(true);
  });
  it('A1-A3 advierten con la lista exacta y piden motivo', () => {
    const r = evaluarCierre({ ...base, camposAreaFaltantes: ['Uso', 'Marca'], descripcionesVacias: true, restriccionesVacias: true, observacionesVacias: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.requiereMotivo).toBe(true);
      expect(r.advertencias.map((a) => [a.regla, a.mensaje, a.detalle])).toEqual([
        ['A1', 'Faltan 2 campos del área', ['Uso', 'Marca']],
        ['A2', 'Las descripciones mínimas adicionales están vacías', []],
        ['A3', 'Las restricciones están vacías', []],
        ['A3', 'Las observaciones de la aduana están vacías', []],
      ]);
    }
  });
  it('CIERRE_MODO=bloquear: A1-A3 son guardas duras', () => {
    const r = evaluarCierre({ ...base, modo: 'bloquear', restriccionesVacias: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toEqual(['A3']);
  });
  it('la partida y la ficha invisible se reportan juntas', () => {
    const r = evaluarCierre({ ...base, partida: null, rol: 'solicitante' });
    if (!r.ok) expect(r.bloqueos.map((b) => b.regla)).toEqual(['G6', 'G1']);
  });
});

describe('normas de una restriccion', () => {
  it('rotula las siglas que aparecen', () => {
    expect(normasDeTexto('No aplica RAEE (ANLA). Excluido de RETIE y RETILAP; RETIQ.')).toEqual(['RETIE', 'RETILAP', 'RETIQ', 'RAEE', 'ANLA']);
    expect(normasDeTexto('Sin Restricciones')).toEqual([]);
    expect(normasDeTexto(null)).toEqual([]);
    expect(normasDeTexto('RETIES')).toEqual([]);
  });
});

describe('exportacion: nombres y fechas', () => {
  it('nombre del archivo con la hora de Bogota, sin tildes ni espacios', () => {
    expect(nombreDeArchivo(new Date('2026-10-21T20:30:00Z'))).toBe('descripciones-minimas_20261021_1530.xlsx');
    // Pasada la medianoche en UTC todavia es el dia anterior en Bogota.
    expect(nombreDeArchivo(new Date('2026-01-01T03:05:00Z'))).toBe('descripciones-minimas_20251231_2205.xlsx');
    expect(nombreDeArchivo(new Date())).toMatch(/^[a-z0-9_.-]+$/);
  });
  it('fechas de Excel: el dia no se corre y la hora es la de Bogota', () => {
    expect(fechaSolo('2026-10-21')?.toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(fechaSolo('basura')).toBeNull();
    expect(fechaHoraBogota('2026-10-21T20:30:00Z')?.toISOString()).toBe('2026-10-21T15:30:00.000Z');
    expect(fechaHoraBogota(null)).toBeNull();
  });
  it('las columnas del SPEC 15.1 (con los cambios de la reunion) mas la autoria por seccion, con encabezados unicos', () => {
    expect(COLUMNAS_BASE).toHaveLength(41); // con el area responsable
    expect(new Set(COLUMNAS_BASE.map((c) => c.encabezado)).size).toBe(41);
    expect(new Set(COLUMNAS_BASE.map((c) => c.clave)).size).toBe(41);
    expect(COLUMNAS_BASE[0]?.encabezado).toBe('Código');
    expect(COLUMNAS_BASE[34]?.encabezado).toBe('Última actualización');
    const claves = COLUMNAS_BASE.map((c) => c.clave);
    for (const fuera of ['valor_unitario', 'cantidad_a_radicar', 'primer_clasificador', 'segundo_clasificador']) expect(claves).not.toContain(fuera);
    for (const nueva of ['area_responsable', 'requiere_rim', 'cantidad_empaque', 'respuesta_area']) expect(claves).toContain(nueva);
    expect(claves).not.toContain('cantidad_rim');
  });
});
