/** SOLO DESARROLLO (`npm run inicio`): cuentas del selector "Ver como" y bandera de modo sin login. */
import { AREAS, nombreDeArea } from '@/dominio/areas';
import { normalizarTexto } from '@/dominio/normalizacion';

export interface CuentaDemo {
  email: string;
  etiqueta: string;
  detalle: string;
}

/**
 * Contrasena de TODAS las cuentas de ejemplo (`@desarrollo.invalid`). Solo existe en desarrollo y pruebas: las semillas
 * no corren en produccion, donde cada cuenta tiene su propia contrasena temporal generada. No es un secreto.
 */
export const CLAVE_DESARROLLO = 'desarrollo-2026';

export function sinLogin(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.SIN_LOGIN === '1';
}

/**
 * Todas las cuentas que existiran, en el orden en que se muestran. La primera es con la que se entra. Una cuenta general
 * por area (C1, las mismas de `USUARIOS_DESARROLLO`) y una por empresa de aduana (C3); al final, dos personas de ejemplo
 * para ver el reparto por persona.
 */
export function cuentasDemo(): CuentaDemo[] {
  return [
    { email: 'admin@desarrollo.invalid', etiqueta: 'Administrador', detalle: 'Ve y gestiona todo' },
    ...AREAS.map((area) => ({
      email: `${normalizarTexto(area)}@desarrollo.invalid`,
      etiqueta: nombreDeArea(area),
      detalle: 'Cuenta general del área',
    })),
    { email: 'aduana-a@desarrollo.invalid', etiqueta: 'Agencia de aduana A', detalle: 'Agencia Demo A' },
    { email: 'aduana-b@desarrollo.invalid', etiqueta: 'Agencia de aduana B', detalle: 'Agencia Demo B' },
    { email: 'lector@desarrollo.invalid', etiqueta: 'Consulta', detalle: 'Solo ve, no edita' },
    { email: 'solicitante@desarrollo.invalid', etiqueta: 'Edgar (Consumibles)', detalle: 'Persona del área' },
    { email: 'solicitante2@desarrollo.invalid', etiqueta: 'Carla (Mantenimiento)', detalle: 'Persona del área' },
  ];
}
