/**
 * Composicion con porcentajes para insumos (02-ux-ui 4.5). La ficha guarda la materia constitutiva como TEXTO
 * (una linea por componente: «Alcoholes C8-10, 5 - 10 %»), asi que la tabla Componente / Desde % / Hasta % es solo
 * otra forma de escribir el mismo texto: cualquier texto libre se puede ver como filas y viceversa, sin perder nada.
 * Funciones puras (sin React): se prueban aparte.
 */

export interface FilaComposicion {
  componente: string;
  /** Texto tal cual lo escribio la persona (admite coma decimal). */
  desde: string;
  hasta: string;
}

const NUM = String.raw`\d+(?:[.,]\d+)?`;
// «Componente, 50 - 75 %» · «Componente 6 %» · «Componente: 2,5 a 10 %»
const CON_RANGO = new RegExp(String.raw`^(.*?)[\s,:;]*(${NUM})\s*(?:-|–|—|a)\s*(${NUM})\s*%\s*$`, 'u');
const CON_VALOR = new RegExp(String.raw`^(.*?)[\s,:;(]*(${NUM})\s*%\s*\)?\s*$`, 'u');

/** Cada linea no vacia es una fila; si termina en un porcentaje o rango, se separa. */
export function parsearComposicion(texto: string): FilaComposicion[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((linea) => {
      const r = CON_RANGO.exec(linea);
      if (r && (r[1] ?? '').trim() !== '') return { componente: (r[1] ?? '').trim(), desde: r[2] ?? '', hasta: r[3] ?? '' };
      const v = CON_VALOR.exec(linea);
      if (v && (v[1] ?? '').trim() !== '') return { componente: (v[1] ?? '').trim(), desde: v[2] ?? '', hasta: '' };
      return { componente: linea, desde: '', hasta: '' };
    });
}

/** Inversa de `parsearComposicion`: las filas sin componente ni numeros se descartan. */
export function serializarComposicion(filas: readonly FilaComposicion[]): string {
  return filas
    .filter((f) => f.componente.trim() !== '' || f.desde.trim() !== '' || f.hasta.trim() !== '')
    .map((f) => {
      const c = f.componente.trim();
      const d = f.desde.trim();
      const h = f.hasta.trim();
      if (d !== '' && h !== '' && d !== h) return `${c}, ${d} - ${h} %`;
      if (d !== '' || h !== '') return `${c}, ${d !== '' ? d : h} %`;
      return c;
    })
    .join('\n');
}

function numero(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export interface SumaComposicion {
  minimos: number;
  maximos: number;
  /** Hay al menos un porcentaje escrito. */
  hayPorcentajes: boolean;
  /** `error` solo si los minimos pasan de 100 %; lo demas informa, no bloquea (las hojas de seguridad dan rangos). */
  nivel: 'error' | 'info' | 'ok' | 'ninguno';
  mensaje: string;
}

function formatoPct(n: number): string {
  return `${(Math.round(n * 100) / 100).toString().replace('.', ',')} %`;
}

export function sumarComposicion(filas: readonly FilaComposicion[]): SumaComposicion {
  let minimos = 0;
  let maximos = 0;
  let hay = false;
  for (const f of filas) {
    const d = numero(f.desde);
    const h = numero(f.hasta);
    if (d === null && h === null) continue;
    hay = true;
    const bajo = d ?? h ?? 0;
    const alto = h ?? d ?? 0;
    minimos += Math.min(bajo, alto);
    maximos += Math.max(bajo, alto);
  }
  if (!hay) return { minimos: 0, maximos: 0, hayPorcentajes: false, nivel: 'ninguno', mensaje: '' };
  if (minimos > 100) {
    return {
      minimos,
      maximos,
      hayPorcentajes: true,
      nivel: 'error',
      mensaje: `Los mínimos suman ${formatoPct(minimos)}, más de 100 %. Revisa los porcentajes.`,
    };
  }
  if (maximos < 100) {
    return {
      minimos,
      maximos,
      hayPorcentajes: true,
      nivel: 'info',
      mensaje: `Suma máxima: ${formatoPct(maximos)}. Falta completar hasta 100 %: puede ser agua u otros componentes.`,
    };
  }
  return {
    minimos,
    maximos,
    hayPorcentajes: true,
    nivel: 'ok',
    mensaje: `Mínimos ${formatoPct(minimos)} · máximos ${formatoPct(maximos)}. Es posible llegar a 100 %.`,
  };
}
