/**
 * Dias en gestion (6.3, RV-32): ((clasificada_en ?? ahora) - fecha_solicitud) - dias_pausa,
 * en dias CALENDARIO de America/Bogota (S-03, S-04). Se congela al clasificar y, al reabrir,
 * `dias_pausa` absorbe los dias que estuvo cerrada.
 */

const ZONA = 'America/Bogota';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Fecha calendario `YYYY-MM-DD` de un instante, vista desde Bogota. */
export function fechaBogota(instante: Date): string {
  return formato.format(instante);
}

/** Dias calendario entre dos fechas `YYYY-MM-DD` (b - a). */
function diferenciaDias(a: string, b: string): number {
  const [ya, ma, da] = a.split('-').map(Number) as [number, number, number];
  const [yb, mb, db] = b.split('-').map(Number) as [number, number, number];
  const ua = Date.UTC(ya, ma - 1, da);
  const ub = Date.UTC(yb, mb - 1, db);
  return Math.round((ub - ua) / 86_400_000);
}

export interface EntradaDias {
  fechaSolicitud: string;
  clasificadaEn: Date | null;
  ahora: Date;
  diasPausa: number;
}

export function diasEnGestion({ fechaSolicitud, clasificadaEn, ahora, diasPausa }: EntradaDias): number {
  const fin = fechaBogota(clasificadaEn ?? ahora);
  return Math.max(0, diferenciaDias(fechaSolicitud, fin) - diasPausa);
}

/** Nuevo `dias_pausa` al reabrir una ficha clasificada. */
export function diasPausaAlReabrir(p: { clasificadaEn: Date; ahora: Date; diasPausaPrevio: number }): number {
  const transcurridos = diferenciaDias(fechaBogota(p.clasificadaEn), fechaBogota(p.ahora));
  return p.diasPausaPrevio + Math.max(0, transcurridos);
}

/** Resta de fechas `YYYY-MM-DD` expuesta para validaciones (fecha futura, etc.). */
export function compararFechas(a: string, b: string): number {
  return diferenciaDias(b, a);
}
