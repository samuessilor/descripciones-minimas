/** CSV seguro (13.4) y formato de las pantallas de administracion. */
import { describe, expect, it } from 'vitest';
import { aCsv, celdaCsv, neutralizarFormula } from '@/server/csv';
import { dentroDe, describirNavegador, etiquetaAccion, fechaHora, formatearIp, hace, plural } from '@/componentes/admin/formato';
import { taparTokens } from '@/server/politicas/administracion-correo';
import { inicioDia } from '@/server/politicas/administracion-auditoria';

describe('CSV: neutralizar formulas (13.4)', () => {
  it.each(['=1+1', '+SUMA(A1)', '-2+3', '@cmd', '\t=1', '\r=1'])('antepone una comilla a %j', (v) => {
    expect(neutralizarFormula(v).startsWith("'")).toBe(true);
    expect(celdaCsv(v).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('no toca texto normal ni numeros', () => {
    expect(celdaCsv('Filtro de aire')).toBe('Filtro de aire');
    expect(celdaCsv(42)).toBe('42');
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(null)).toBe('');
    expect(celdaCsv(undefined)).toBe('');
  });

  it('entrecomilla comas, saltos y comillas, y serializa objetos', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(celdaCsv('linea1\nlinea2')).toBe('"linea1\nlinea2"');
    expect(celdaCsv({ a: 1 })).toBe('"{""a"":1}"');
  });

  it('una celda que empieza por = se neutraliza aunque venga de un texto de usuario', () => {
    const csv = aCsv(['x', 'detalle'], [['=HYPERLINK("http://x")', { texto: '=1+1' }]]);
    const lineas = csv.replace('﻿', '').split('\r\n');
    expect(lineas[0]).toBe('x,detalle');
    expect(lineas[1]!.startsWith(`"'=HYPERLINK`)).toBe(true);
  });

  it('lleva BOM y termina en salto de linea', () => {
    const csv = aCsv(['a'], [['b']]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('formato', () => {
  it('plural', () => {
    expect(plural(1, 'persona', 'personas')).toBe('1 persona');
    expect(plural(0, 'persona', 'personas')).toBe('0 personas');
    expect(plural(3, 'persona', 'personas')).toBe('3 personas');
  });

  it('hace / dentroDe', () => {
    const ahora = new Date('2026-10-21T15:00:00Z');
    expect(hace(null, ahora)).toBe('Nunca');
    expect(hace(new Date('2026-10-21T14:59:50Z'), ahora)).toBe('ahora mismo');
    expect(hace(new Date('2026-10-21T14:30:00Z'), ahora)).toBe('hace 30 min');
    expect(hace(new Date('2026-10-21T10:00:00Z'), ahora)).toBe('hace 5 h');
    expect(hace(new Date('2026-10-20T14:00:00Z'), ahora)).toBe('ayer');
    expect(hace(new Date('2026-10-17T15:00:00Z'), ahora)).toBe('hace 4 días');
    expect(dentroDe(new Date('2026-10-21T15:05:00Z'), ahora)).toBe('en 5 min');
    expect(dentroDe(new Date('2026-10-21T14:00:00Z'), ahora)).toBe('ya');
  });

  it('fechaHora usa la hora de Bogota', () => {
    expect(fechaHora('2026-10-21T15:30:00Z')).toMatch(/10:30/);
    expect(fechaHora(null)).toBe('—');
  });

  it('describirNavegador', () => {
    expect(describirNavegador('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('Chrome en Windows');
    expect(describirNavegador('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Version/17 Safari/604.1')).toBe('Safari en iPhone o iPad');
    expect(describirNavegador('Mozilla/5.0 (Windows NT 10.0) Edg/120 Chrome/120 Safari/537')).toBe('Edge en Windows');
    expect(describirNavegador(null)).toBe('Dispositivo desconocido');
  });

  it('etiquetaAccion cae a texto legible si no la conoce', () => {
    expect(etiquetaAccion('invitar')).toBe('Invitó a una persona');
    expect(etiquetaAccion('algo_nuevo')).toBe('algo nuevo');
  });
});

describe('tapar tokens y fechas de auditoria', () => {
  it('tapa el valor de cualquier token= (enlace de acceso)', () => {
    const t = taparTokens('Entra: http://x/entrar/confirmar?token=abc123XYZ_-&siguiente=%2F y <a href="http://x?token=zzz">ir</a>');
    expect(t).not.toContain('abc123XYZ');
    expect(t).not.toContain('zzz');
    expect(t).toContain('siguiente=%2F');
    expect(t).toContain('token=••••••');
  });

  it('inicioDia: 00:00 de Bogota (UTC-5) y rechaza formatos raros', () => {
    expect(inicioDia('2026-10-21')?.toISOString()).toBe('2026-10-21T05:00:00.000Z');
    expect(inicioDia('21/10/2026')).toBeNull();
    expect(inicioDia('2026-13-45')).toBeNull();
  });
});

describe('formatearIp', () => {
  it('muestra el equipo local y oculta la direccion vacia de IPv6', () => {
    expect(formatearIp('0000:0000:0000:0000:0000:0000:0000:0000')).toBeNull();
    expect(formatearIp('::')).toBeNull();
    expect(formatearIp('0000:0000:0000:0000:0000:0000:0000:0001')).toBe('este equipo');
    expect(formatearIp('::1')).toBe('este equipo');
    expect(formatearIp('127.0.0.1')).toBe('este equipo');
    expect(formatearIp('190.25.10.7')).toBe('190.25.10.7');
    expect(formatearIp(null)).toBeNull();
    expect(formatearIp('')).toBeNull();
  });
});
