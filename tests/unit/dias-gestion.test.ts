import { describe, expect, it } from 'vitest';
import { diasEnGestion, diasPausaAlReabrir, fechaBogota } from '@/dominio/dias-gestion';

// Instantes en UTC; Bogota es UTC-5 sin horario de verano.
const utc = (s: string) => new Date(s);

describe('fechaBogota', () => {
  it('convierte un instante a la fecha calendario de Bogota', () => {
    expect(fechaBogota(utc('2026-10-21T03:00:00Z'))).toBe('2026-10-20'); // 22:00 del 20 en Bogota
    expect(fechaBogota(utc('2026-10-21T05:00:00Z'))).toBe('2026-10-21'); // 00:00 del 21
  });
});

describe('diasEnGestion (RV-32, CA-33)', () => {
  it('cuenta dias calendario desde la solicitud hasta ahora si no esta clasificada', () => {
    const d = diasEnGestion({
      fechaSolicitud: '2026-10-16',
      clasificadaEn: null,
      ahora: utc('2026-10-21T15:00:00Z'),
      diasPausa: 0,
    });
    expect(d).toBe(5);
  });

  it('el mismo dia de la solicitud son 0 dias', () => {
    expect(
      diasEnGestion({
        fechaSolicitud: '2026-10-21',
        clasificadaEn: null,
        ahora: utc('2026-10-21T15:00:00Z'),
        diasPausa: 0,
      }),
    ).toBe(0);
  });

  it('se congela al clasificar', () => {
    const base = { fechaSolicitud: '2026-10-16', clasificadaEn: utc('2026-10-21T15:00:00Z'), diasPausa: 0 };
    expect(diasEnGestion({ ...base, ahora: utc('2026-10-21T16:00:00Z') })).toBe(5);
    expect(diasEnGestion({ ...base, ahora: utc('2027-04-21T16:00:00Z') })).toBe(5);
  });

  it('cerrada el dia 5 y reabierta 180 dias despues muestra 5 mas los nuevos, no 185', () => {
    const solicitud = '2026-10-16';
    const clasificada = utc('2026-10-21T15:00:00Z'); // dia 5
    const reapertura = utc('2027-04-19T15:00:00Z'); // 180 dias despues
    const pausa = diasPausaAlReabrir({ clasificadaEn: clasificada, ahora: reapertura, diasPausaPrevio: 0 });
    expect(pausa).toBe(180);

    // Justo al reabrir (clasificada_en vuelve a null) sigue en 5.
    expect(diasEnGestion({ fechaSolicitud: solicitud, clasificadaEn: null, ahora: reapertura, diasPausa: pausa })).toBe(5);
    // Tres dias despues de reabrir: 8.
    expect(
      diasEnGestion({
        fechaSolicitud: solicitud,
        clasificadaEn: null,
        ahora: utc('2027-04-22T15:00:00Z'),
        diasPausa: pausa,
      }),
    ).toBe(8);
  });

  it('acumula pausas de reaperturas sucesivas', () => {
    const p1 = diasPausaAlReabrir({
      clasificadaEn: utc('2026-10-21T15:00:00Z'),
      ahora: utc('2026-10-31T15:00:00Z'),
      diasPausaPrevio: 0,
    });
    expect(p1).toBe(10);
    const p2 = diasPausaAlReabrir({
      clasificadaEn: utc('2026-11-05T15:00:00Z'),
      ahora: utc('2026-11-15T15:00:00Z'),
      diasPausaPrevio: p1,
    });
    expect(p2).toBe(20);
  });

  it('nunca devuelve negativos', () => {
    expect(
      diasEnGestion({
        fechaSolicitud: '2026-10-25',
        clasificadaEn: null,
        ahora: utc('2026-10-21T15:00:00Z'),
        diasPausa: 0,
      }),
    ).toBe(0);
  });
});
