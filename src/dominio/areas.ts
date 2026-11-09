/**
 * Areas de la empresa (reunion con el area, 2026-10-29). Catalogo FIJO: es a la vez el «Área responsable» de una
 * referencia y el area de cada usuario interno (Administracion > Usuarios). Una referencia le pertenece al area que la
 * tiene como responsable; no se deriva del tipo de producto (un repuesto puede ser de Consumibles).
 *
 * Se guarda el nombre tal cual (`'Mantenimiento'`), asi se lee igual en la ficha, en el historial y en el Excel.
 * Dominio PURO.
 */
import { normalizarTexto } from './normalizacion';

export const AREAS = ['Consumibles', 'Mantenimiento', 'Instrumentos', 'Marketing'] as const;
export type Area = (typeof AREAS)[number];

export function esArea(v: unknown): v is Area {
  return typeof v === 'string' && (AREAS as readonly string[]).includes(v);
}

/** Nombres que se usaban antes del catalogo (texto libre). «Insumos» es el nombre viejo de Consumibles. */
const SINONIMOS: Readonly<Record<string, Area>> = { insumos: 'Consumibles', insumo: 'Consumibles' };

/** Lleva un texto libre de area al catalogo (sin tildes ni mayusculas); `null` si no corresponde a ninguna. */
export function normalizarArea(texto: string | null | undefined): Area | null {
  if (!texto) return null;
  const t = normalizarTexto(texto);
  return AREAS.find((a) => normalizarTexto(a) === t) ?? SINONIMOS[t] ?? null;
}

/** Como se nombra al area cuando es la responsable: «Área Mantenimiento». */
export function nombreDeArea(area: string): string {
  return `Área ${area}`;
}

/**
 * Toda cuenta interna con rol «solicitante» (la de un area o la de una persona del area) pertenece a UN area: de ahi salen
 * «Para mi», lo que se le envia y a quien le toca cada referencia. Administrador, supervisora general, lector y aduana pueden no tener area.
 */
export function exigeArea(rol: string, tipoOrganizacion: string): boolean {
  return rol === 'solicitante' && tipoOrganizacion === 'interna';
}

export const MENSAJE_AREA_OBLIGATORIA = 'Elige el área (Consumibles, Mantenimiento, Instrumentos o Marketing): una cuenta de solicitante siempre es de un área.';
