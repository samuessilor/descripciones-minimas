/**
 * Limite de tasa en la propia base (tabla `limite_tasa`, sin Redis; 13.3). Ventana fija: un
 * contador por (clave, ventana). Un `INSERT ... ON CONFLICT DO UPDATE` atomico, igual en PGlite y Postgres.
 */
import { lt, sql } from 'drizzle-orm';
import { limiteTasa } from '@/db/esquema';
import type { Ejecutor } from '@/db/tipos';

export interface ReglaTasa {
  max: number;
  ventanaMs: number;
}

export interface ResultadoTasa {
  permitido: boolean;
  contador: number;
  /** Milisegundos hasta que la ventana se reinicia. */
  reintentarEnMs: number;
}

/** Valores S-13. */
export const REGLAS_TASA = {
  enlacePorCorreo: { max: 5, ventanaMs: 15 * 60_000 },
  // Por IP es mas alto que S-13: toda una oficina (o una agencia) sale por la misma IP publica (NAT) y pide su enlace
  // a la misma hora. El limite por correo y la espera de 30 s protegen cada buzon; este solo frena el barrido masivo.
  enlacePorIp: { max: 60, ventanaMs: 15 * 60_000 },
  /** Espera minima de 30 s entre solicitudes del mismo correo (10.6). */
  enlaceEspera: { max: 1, ventanaMs: 30_000 },
  subirArchivo: { max: 30, ventanaMs: 3_600_000 },
  exportar: { max: 5, ventanaMs: 3_600_000 },
  buscar: { max: 120, ventanaMs: 60_000 },
  enviarA: { max: 60, ventanaMs: 3_600_000 },
} as const satisfies Record<string, ReglaTasa>;

export async function limitarTasa(
  ej: Ejecutor,
  clave: string,
  regla: ReglaTasa,
  ahora: Date = new Date(),
): Promise<ResultadoTasa> {
  const inicio = Math.floor(ahora.getTime() / regla.ventanaMs) * regla.ventanaMs;
  const ventana = new Date(inicio);
  const [fila] = await ej
    .insert(limiteTasa)
    .values({ clave, ventana, contador: 1 })
    .onConflictDoUpdate({
      target: [limiteTasa.clave, limiteTasa.ventana],
      set: { contador: sql`${limiteTasa.contador} + 1` },
    })
    .returning({ contador: limiteTasa.contador });
  const contador = fila?.contador ?? 1;
  if (contador === 1 && Math.random() < 0.05) {
    // Limpieza oportunista de ventanas viejas (el rol `app` puede borrar solo en esta tabla).
    await ej.delete(limiteTasa).where(lt(limiteTasa.ventana, new Date(ahora.getTime() - 86_400_000)));
  }
  return { permitido: contador <= regla.max, contador, reintentarEnMs: inicio + regla.ventanaMs - ahora.getTime() };
}
