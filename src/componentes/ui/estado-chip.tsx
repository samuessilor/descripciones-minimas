/**
 * `EstadoChip`: el semaforo de la aplicacion. Es el MISMO componente `Estado` de `@/componentes/Estado`
 * (un solo origen del patron, 11.4); este alias existe para importarlo junto a los demas de `ui/`.
 *
 *   <EstadoChip color="verde" texto="Clasificada" />
 *   <EstadoChip color="amarillo" texto="Faltan 3 campos" tamano="sm" />
 */
export { Estado as EstadoChip, type ColorEstado } from '@/componentes/Estado';

/** Texto estandar por color y contexto: usalo para no inventar palabras (10.5). */
export const TEXTO_ESTADO = {
  referencia: { amarillo: 'Pendiente', verde: 'Clasificada' },
  seccion: { amarillo: 'Pendiente', verde: 'Completa' },
} as const;

export function textoFaltan(n: number, de?: number): string {
  if (n <= 0) return 'Completa';
  const base = n === 1 ? 'Falta 1 campo' : `Faltan ${n} campos`;
  return de ? `${base} de ${de}` : base;
}
