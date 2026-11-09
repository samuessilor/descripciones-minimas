import { describe, expect, it } from 'vitest';
import { PLANTILLAS_AVISO, escaparHtml, limpiarLinea, plantillaBienvenida, plantillaEnlaceAcceso, renderizarAviso } from '@/server/correo/plantillas';
import { extraerEnlace } from '@/server/correo/outbox';

const ENLACE = 'http://localhost:3000/referencias/11111111-2222-4333-8444-555555555555';
const base = { nombre: 'Brian Pérez', quien: 'Edward', enlace: ENLACE, contacto: 'el administrador de la plataforma' };

describe('plantillas de correo (10.6, D-23)', () => {
  it('las ocho plantillas de aviso llevan texto plano alterno, un solo boton y el enlace', () => {
    expect(PLANTILLAS_AVISO).toHaveLength(8);
    for (const p of PLANTILLAS_AVISO) {
      const c = renderizarAviso(p, { ...base, cantidad: 4, diasEspera: 2, pedido: 'clasificar' });
      expect(c.asunto.length).toBeGreaterThan(5);
      expect(c.asunto).not.toMatch(/[\r\n]/);
      expect(c.texto).toContain(ENLACE);
      expect(c.html).toContain(`href="${ENLACE}"`);
      expect(c.html.match(/<a href=/g)?.length).toBeGreaterThanOrEqual(1);
      expect(c.html).toContain('lang="es-CO"');
      expect(extraerEnlace(c.texto)).toBe(ENLACE);
    }
  });

  it('el pendiente dice quien envia y que se espera, sin datos de la mercancia', () => {
    const c = renderizarAviso('pendiente', { ...base, pedido: 'clasificar' });
    expect(c.asunto).toBe('Tienes una descripción mínima pendiente');
    expect(c.texto).toContain('Hola Brian. Edward te envió una referencia para clasificar.');
    expect(c.texto).toContain('Abrir la referencia');
    expect(c.texto).not.toMatch(/partida|valor|proveedor|código/i);
    expect(c.html).toContain('Abrir la referencia');
  });

  it('el codigo solo aparece si se pide (CORREO_INCLUIR_REFERENCIA)', () => {
    const sin = renderizarAviso('pendiente', { ...base, pedido: 'revisar' });
    expect(sin.asunto).not.toContain('TEST-0001');
    const con = renderizarAviso('pendiente', { ...base, pedido: 'revisar', codigo: 'TEST-0001' });
    expect(con.asunto).toBe('Tienes pendiente la referencia TEST-0001');
    expect(con.texto).toContain('Referencia TEST-0001.');
  });

  it('el resumen de lote cuenta las referencias y lleva a la bandeja', () => {
    const c = renderizarAviso('resumen_lote', { ...base, enlace: 'http://localhost:3000/', cantidad: 10 });
    expect(c.asunto).toBe('Tienes 10 descripciones mínimas pendientes');
    expect(c.html).toContain('Abrir mis pendientes');
  });

  it('el recordatorio dice desde cuando', () => {
    expect(renderizarAviso('recordatorio', { ...base, diasEspera: 3 }).texto).toContain('desde hace 3 días');
    expect(renderizarAviso('recordatorio', { ...base, diasEspera: 1 }).texto).toContain('desde hace 1 día');
    expect(renderizarAviso('recordatorio', { ...base, diasEspera: 0 }).texto).not.toContain('desde hace');
  });

  it('el pie nombra al contacto con la gramatica correcta', () => {
    expect(renderizarAviso('devuelta', base).texto).toContain('avisa al administrador de la plataforma');
    expect(renderizarAviso('devuelta', { ...base, contacto: 'Samuel Galeano' }).texto).toContain('avisa a Samuel Galeano');
  });

  it('escapa HTML y no deja pasar saltos de linea al asunto (inyeccion de cabeceras)', () => {
    const c = renderizarAviso('devuelta', { ...base, nombre: '<img/src=x/onerror=1>', quien: 'Eva\r\nBcc: x@y.z <b>' });
    expect(c.html).not.toContain('<img/src=x');
    expect(c.html).toContain('&lt;img/src=x/onerror=1&gt;');
    expect(c.asunto).not.toMatch(/[\r\n]/);
    expect(c.asunto).toContain('Eva Bcc: x@y.z');
    expect(escaparHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
    expect(limpiarLinea('a b\u0000c\n d')).toBe('a b c d');
  });

  it('las dos de acceso (H1) siguen funcionando con primer nombre', () => {
    const a = plantillaEnlaceAcceso({ nombre: 'Ana Admin [DESARROLLO]', enlace: ENLACE, vigenciaMinutos: 30, contacto: 'el administrador' });
    expect(a.asunto).toBe('Tu enlace para entrar a Descripciones mínimas');
    expect(a.texto).toContain('Hola Ana.');
    expect(a.texto).toContain('30 minutos');
    const b = plantillaBienvenida({ nombre: 'Brian', quien: 'Ana Admin', enlace: ENLACE, vigenciaMinutos: 30, contacto: 'el administrador' });
    expect(b.asunto).toBe('Ana Admin te dio acceso a Descripciones mínimas');
  });

  it('el logo del correo apunta al mismo origen del enlace', () => {
    const c = renderizarAviso('pendiente', base);
    expect(c.html).toContain('http://localhost:3000/marca/essilorluxottica-wordmark-blanco.svg');
    expect(c.html).toContain('alt="ESSILORLUXOTTICA"');
  });
});
