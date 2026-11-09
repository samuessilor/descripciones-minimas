/**
 * Sistema visual: contrastes WCAG 2.x calculados desde los tokens REALES de `globals.css` (si alguien
 * cambia un color y rompe el contraste, esta prueba falla), y las utilidades puras de la biblioteca.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { destinosPara } from '@/componentes/navegacion';
import { textoFaltan } from '@/componentes/ui/estado-chip';
import { iniciales, nombreVisible } from '@/componentes/ui/avatar';

const css = readFileSync(fileURLToPath(new URL('../../src/app/globals.css', import.meta.url)), 'utf8');

function token(nombre: string): string {
  const m = new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!m) throw new Error(`token --${nombre} no encontrado en globals.css`);
  return m[1]!;
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const BLANCO = '#ffffff';

describe('contraste de texto (>= 4,5:1, WCAG 1.4.3)', () => {
  const texto: Array<[string, string, string]> = [
    ['tinta', 'tinta', 'fondo'],
    ['tinta', 'tinta', 'superficie'],
    ['tinta-suave', 'tinta-suave', 'fondo'],
    ['tinta-suave', 'tinta-suave', 'superficie'],
    ['tinta-suave', 'tinta-suave', 'azul-50'],
    ['azul-500 (enlaces)', 'azul-500', 'fondo'],
    ['azul-500 (enlaces)', 'azul-500', 'superficie'],
    ['amarillo-texto', 'amarillo-texto', 'amarillo-fondo'],
    ['verde-texto', 'verde-texto', 'verde-fondo'],
    ['error', 'error', 'error-fondo'],
    ['error', 'error', 'superficie'],
    ['azul-900', 'azul-900', 'azul-50'],
    ['azul-700', 'azul-700', 'azul-50'],
    ['azul-900', 'azul-900', 'azul-100'],
  ];
  it.each(texto)('%s sobre su fondo', (_n, fg, bg) => {
    expect(contraste(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  const sobreAzul: Array<[string, string]> = [
    ['azul-900', BLANCO],
    ['azul-800', BLANCO],
    ['azul-700', BLANCO],
    ['azul-600', BLANCO],
  ];
  it.each(sobreAzul)('blanco sobre %s', (bg) => {
    expect(contraste(BLANCO, token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('texto claro sobre el panel azul-900 (azul-200 y azul-300)', () => {
    expect(contraste(token('azul-200'), token('azul-900'))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(token('azul-300'), token('azul-900'))).toBeGreaterThanOrEqual(4.5);
  });

  it('texto azul-900 sobre el amarillo solido y blanco sobre el verde solido', () => {
    expect(contraste(token('azul-700'), token('amarillo-solido'))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BLANCO, token('verde-solido'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('contraste de componentes (>= 3:1, WCAG 1.4.11)', () => {
  it('borde de campos sobre blanco', () => {
    expect(contraste(token('borde-campo'), BLANCO)).toBeGreaterThanOrEqual(3);
  });
  it('anillo de foco sobre fondo y superficie claros', () => {
    expect(contraste(token('foco'), token('fondo'))).toBeGreaterThanOrEqual(3);
    expect(contraste(token('foco'), BLANCO)).toBeGreaterThanOrEqual(3);
  });
  it('foco blanco sobre las barras azules', () => {
    expect(contraste(token('foco-oscuro'), token('azul-900'))).toBeGreaterThanOrEqual(3);
    expect(contraste(token('foco-oscuro'), token('azul-700'))).toBeGreaterThanOrEqual(3);
  });
  it('bordes e iconos del semaforo contra su propio fondo y contra la pagina', () => {
    expect(contraste(token('amarillo-borde'), BLANCO)).toBeGreaterThanOrEqual(3);
    expect(contraste(token('amarillo-borde'), token('amarillo-fondo'))).toBeGreaterThanOrEqual(3);
    expect(contraste(token('verde-solido'), BLANCO)).toBeGreaterThanOrEqual(3);
    expect(contraste(token('verde-solido'), token('verde-fondo'))).toBeGreaterThanOrEqual(3);
  });
});

describe('semaforo: el amarillo y el verde no son la marca', () => {
  it('ningun token azul se parece al amarillo ni al verde del estado', () => {
    // El estado se distingue tambien por icono y palabra; aqui se vigila que el azul de marca no invada esos tonos.
    const matiz = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const d = max - Math.min(r, g, b);
      if (d === 0) return 0;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    for (const n of ['azul-900', 'azul-700', 'azul-600', 'azul-500']) {
      const h = matiz(token(n));
      expect(h, n).toBeGreaterThan(200);
      expect(h, n).toBeLessThan(250);
    }
  });
});

describe('navegacion por rol', () => {
  it('todos ven Inicio, Referencias y Notificaciones; Administracion solo el admin', () => {
    for (const rol of ['admin', 'solicitante', 'aduana', 'lector'] as const) {
      const etiquetas = destinosPara(rol).map((d) => d.etiqueta);
      expect(etiquetas).toEqual(expect.arrayContaining(['Inicio', 'Referencias', 'Notificaciones']));
      expect(etiquetas.includes('Administración'), rol).toBe(rol === 'admin');
    }
    const admin = destinosPara('admin').find((d) => d.href === '/admin');
    expect(admin?.hijos?.map((h) => h.etiqueta)).toEqual(['Usuarios', 'Organizaciones', 'Catálogos', 'Auditoría', 'Parámetros']);
  });
});

describe('avatar y textos de estado', () => {
  it('iniciales sin la marca [DESARROLLO]', () => {
    expect(nombreVisible('Ana Admin [DESARROLLO]')).toBe('Ana Admin');
    expect(iniciales('Ana Admin [DESARROLLO]')).toBe('AA');
    expect(iniciales('Brian')).toBe('B');
    expect(iniciales('  Carla   María  Pérez ')).toBe('CM');
  });

  it('textoFaltan usa las palabras del SPEC 10.5', () => {
    expect(textoFaltan(0)).toBe('Completa');
    expect(textoFaltan(1)).toBe('Falta 1 campo');
    expect(textoFaltan(3)).toBe('Faltan 3 campos');
    expect(textoFaltan(3, 8)).toBe('Faltan 3 campos de 8');
  });
});
