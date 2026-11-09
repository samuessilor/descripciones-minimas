/**
 * Plantillas de correo (10.6, D-23): propias, con texto plano alterno y UN solo boton.
 * NUNCA llevan datos de la mercancia (los correos llegan a buzones de agencias externas y los
 * datos estan detras del login): solo quien envia, lo que se espera de la persona y el enlace
 * directo (UUID opaco). El codigo de la referencia solo aparece si `CORREO_INCLUIR_REFERENCIA`
 * esta activo (PA-12) y quien llama lo pasa en `codigo`.
 *
 * Las ocho plantillas de aviso se renderizan con `renderizarAviso`; el payload (asunto, texto y
 * html) se guarda en la fila del outbox al crear la notificacion, asi un reintento envia
 * exactamente lo mismo (14).
 */
import { VERBO_PEDIDO, type Pedido } from '@/dominio/colaboracion';

export interface CorreoRenderizado {
  asunto: string;
  texto: string;
  html: string;
}

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Una sola linea, sin saltos ni caracteres de control: nada que permita inyectar cabeceras en el asunto. */
export function limpiarLinea(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Quita la marca `[DESARROLLO]` de los usuarios de prueba. */
function nombreLimpio(nombre: string): string {
  return limpiarLinea(nombre.replace(/\[.*?\]/g, '')) || limpiarLinea(nombre);
}

/** «Hola Brian»: solo el primer nombre (el nombre completo suena a formulario). */
function primerNombre(nombre: string): string {
  return nombreLimpio(nombre).split(' ')[0] ?? nombre;
}

/** «el administrador de la plataforma» -> «al administrador de la plataforma» (avisa al / avisa a). */
function aContacto(contacto: string): string {
  return /^el\s/i.test(contacto) ? contacto.replace(/^el\s/i, 'al ') : `a ${contacto}`;
}

function origenDe(enlace: string): string {
  try {
    return new URL(enlace).origin;
  } catch {
    return '';
  }
}

interface OpcionesMarco {
  /** Frase corta que algunos clientes muestran junto al asunto. */
  previa?: string;
  /** Nota secundaria (caja azul clara). */
  nota?: string;
}

const AZUL_PROFUNDO = '#071F4A';
const AZUL_MARCA = '#0B2F6B';
const TINTA = '#0F1B2D';
const TINTA_SUAVE = '#4A5A70';

/**
 * Marco comun: banda azul con el wordmark (si el cliente bloquea la imagen se lee el `alt`, con el mismo
 * estilo), tarjeta blanca, un solo boton y, debajo, el enlace en texto por si el boton no abre.
 */
function marco(
  titulo: string,
  cuerpoHtml: string,
  textoBoton: string,
  enlace: string,
  pie: string,
  opciones: OpcionesMarco = {},
): string {
  const origen = origenDe(enlace);
  const logo = origen ? `${origen}/marca/essilorluxottica-wordmark-blanco.svg` : '';
  const previa = opciones.previa
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escaparHtml(opciones.previa)}</div>`
    : '';
  const nota = opciones.nota
    ? `<p style="margin:20px 0 0;padding:12px 14px;background:#EEF4FC;border-radius:8px;font-size:14px;line-height:1.5;color:${TINTA}">${escaparHtml(opciones.nota)}</p>`
    : '';
  return `<!doctype html>
<html lang="es-CO">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:#F3F6FA;font-family:Arial,Helvetica,sans-serif;color:${TINTA}">
  ${previa}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6FA;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #DCE4EF">
        <tr><td bgcolor="${AZUL_PROFUNDO}" style="background:${AZUL_PROFUNDO};padding:22px 28px">
          ${
            logo
              ? `<img src="${escaparHtml(logo)}" alt="ESSILORLUXOTTICA" height="18" style="display:block;height:18px;width:auto;border:0;color:#FFFFFF;font:bold 14px Arial,Helvetica,sans-serif;letter-spacing:0.08em">`
              : `<span style="color:#FFFFFF;font:bold 14px Arial,Helvetica,sans-serif;letter-spacing:0.08em">ESSILORLUXOTTICA</span>`
          }
          <div style="margin-top:6px;font-size:12px;letter-spacing:0.04em;color:#BCD3F5">Descripciones mínimas · Supply Chain</div>
        </td></tr>
        <tr><td style="padding:30px 28px 26px">
          <h1 style="margin:0 0 14px;font-size:22px;line-height:1.25;color:${TINTA}">${escaparHtml(titulo)}</h1>
          ${cuerpoHtml}
          ${nota}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 8px"><tr>
            <td bgcolor="${AZUL_MARCA}" style="background:${AZUL_MARCA};border-radius:8px">
              <a href="${escaparHtml(enlace)}" style="display:inline-block;padding:14px 28px;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:16px;font-family:Arial,Helvetica,sans-serif">${escaparHtml(textoBoton)}</a>
            </td>
          </tr></table>
          <p style="margin:12px 0 0;font-size:12.5px;line-height:1.5;color:${TINTA_SUAVE}">¿El botón no abre? Copia este enlace en tu navegador:<br><a href="${escaparHtml(enlace)}" style="color:#0B5FD0;word-break:break-all">${escaparHtml(enlace)}</a></p>
        </td></tr>
        <tr><td style="padding:16px 28px 22px;border-top:1px solid #E6ECF4;background:#FAFBFD">
          <p style="margin:0;font-size:12.5px;line-height:1.5;color:${TINTA_SUAVE}">${escaparHtml(pie)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function parrafo(texto: string): string {
  return `<p style="margin:0 0 10px;font-size:16px;line-height:1.55;color:${TINTA}">${escaparHtml(texto)}</p>`;
}

function armar(p: {
  asunto: string;
  titulo: string;
  intro: string;
  detalle?: string;
  nota?: string;
  boton: string;
  enlace: string;
  pie: string;
}): CorreoRenderizado {
  const cuerpo = parrafo(p.intro) + (p.detalle ? parrafo(p.detalle) : '');
  const texto = [p.intro, p.detalle ?? null, p.nota ?? null, `${p.boton}: ${p.enlace}`, p.pie]
    .filter((x): x is string => !!x)
    .join('\n\n');
  return {
    asunto: limpiarLinea(p.asunto),
    texto: `${texto}\n`,
    html: marco(p.titulo, cuerpo, p.boton, p.enlace, p.pie, { previa: p.intro, ...(p.nota ? { nota: p.nota } : {}) }),
  };
}

// ---- Acceso (H1) ----------------------------------------------------------------------------------------

/** (1) Enlace de acceso: "Tu enlace para entrar a Descripciones mínimas". */
export function plantillaEnlaceAcceso(p: {
  nombre: string;
  enlace: string;
  vigenciaMinutos: number;
  contacto: string;
}): CorreoRenderizado {
  return armar({
    asunto: 'Tu enlace para entrar a Descripciones mínimas',
    titulo: 'Tu enlace para entrar',
    intro: `Hola ${primerNombre(p.nombre)}. Usa este enlace para entrar a Descripciones mínimas.`,
    detalle: `El enlace dura ${p.vigenciaMinutos} minutos y solo sirve una vez.`,
    boton: 'Abrir en la plataforma',
    enlace: p.enlace,
    pie: `Si no esperabas este mensaje, ignóralo o avisa ${aContacto(p.contacto)}.`,
  });
}

/** (2) Invitacion / bienvenida: "{Quién} te dio acceso a Descripciones mínimas. Entra con este enlace". */
export function plantillaBienvenida(p: {
  nombre: string;
  quien: string;
  enlace: string;
  vigenciaMinutos: number;
  contacto: string;
}): CorreoRenderizado {
  const quien = nombreLimpio(p.quien);
  return armar({
    asunto: `${quien} te dio acceso a Descripciones mínimas`,
    titulo: 'Te dieron acceso',
    intro: `Hola ${primerNombre(p.nombre)}. ${quien} te dio acceso a Descripciones mínimas. Entra con este enlace.`,
    detalle: `El enlace dura ${p.vigenciaMinutos} minutos. Después puedes pedir otro desde la pantalla de entrada.`,
    boton: 'Abrir en la plataforma',
    enlace: p.enlace,
    pie: `Si no esperabas este mensaje, ignóralo o avisa ${aContacto(p.contacto)}.`,
  });
}

// ---- Avisos de colaboracion (H3) --------------------------------------------------------------------------

export type PlantillaAviso =
  | 'pendiente'
  | 'pendiente_actualizada'
  | 'recordatorio'
  | 'clasificada'
  | 'reabierta'
  | 'reapertura_solicitada'
  | 'devuelta'
  | 'resumen_lote';

export const PLANTILLAS_AVISO: readonly PlantillaAviso[] = [
  'pendiente',
  'pendiente_actualizada',
  'recordatorio',
  'clasificada',
  'reabierta',
  'reapertura_solicitada',
  'devuelta',
  'resumen_lote',
];

export interface ParamsAviso {
  /** Quien recibe. */
  nombre: string;
  /** Quien envia / actua. */
  quien: string;
  enlace: string;
  contacto: string;
  pedido?: Pedido | null;
  /** Solo si `CORREO_INCLUIR_REFERENCIA` esta activo. */
  codigo?: string | null;
  /** Dias que lleva pendiente (recordatorio). */
  diasEspera?: number | null;
  /** Referencias del resumen de lote. */
  cantidad?: number;
}

export function renderizarAviso(plantilla: PlantillaAviso, p: ParamsAviso): CorreoRenderizado {
  const nombre = primerNombre(p.nombre);
  const quien = nombreLimpio(p.quien);
  const pie = `Si no esperabas este mensaje, ignóralo o avisa ${aContacto(p.contacto)}.`;
  const conCodigo = p.codigo ? limpiarLinea(p.codigo) : null;
  const detalleReferencia = conCodigo ? `Referencia ${conCodigo}.` : undefined;
  const sinResponder = 'No necesitas responder este correo: todo se hace en la plataforma.';
  const base = { enlace: p.enlace, pie, boton: 'Abrir la referencia' };

  switch (plantilla) {
    case 'pendiente': {
      const verbo = VERBO_PEDIDO[p.pedido ?? 'completar'];
      return armar({
        ...base,
        asunto: conCodigo ? `Tienes pendiente la referencia ${conCodigo}` : 'Tienes una descripción mínima pendiente',
        titulo: 'Tienes una referencia pendiente',
        intro: `Hola ${nombre}. ${quien} te envió una referencia para ${verbo}.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
        nota: sinResponder,
      });
    }
    case 'pendiente_actualizada': {
      const verbo = VERBO_PEDIDO[p.pedido ?? 'completar'];
      return armar({
        ...base,
        asunto: conCodigo ? `Actualizaron lo que te piden en ${conCodigo}` : 'Actualizaron lo que te piden en una referencia',
        titulo: 'Cambió lo que te piden',
        intro: `Hola ${nombre}. ${quien} actualizó lo que te pide en una referencia que ya tenías pendiente: ahora es para ${verbo}.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
        nota: sinResponder,
      });
    }
    case 'recordatorio': {
      const desde = p.diasEspera && p.diasEspera > 0 ? ` desde hace ${p.diasEspera === 1 ? '1 día' : `${p.diasEspera} días`}` : '';
      return armar({
        ...base,
        asunto: conCodigo ? `Recordatorio: sigue pendiente ${conCodigo}` : 'Recordatorio: tienes una descripción mínima pendiente',
        titulo: 'Recordatorio de una referencia pendiente',
        intro: `Hola ${nombre}. ${quien} te recuerda una referencia que sigue pendiente${desde}.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
        nota: sinResponder,
      });
    }
    case 'clasificada':
      return armar({
        ...base,
        asunto: 'Una referencia quedó clasificada',
        titulo: 'Una referencia quedó clasificada',
        intro: `Hola ${nombre}. ${quien} cerró la clasificación de una referencia.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
      });
    case 'reabierta':
      return armar({
        ...base,
        asunto: 'Se reabrió una clasificación',
        titulo: 'Se reabrió una clasificación',
        intro: `Hola ${nombre}. ${quien} reabrió la clasificación de una referencia.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
      });
    case 'reapertura_solicitada':
      return armar({
        ...base,
        asunto: 'Piden reabrir una clasificación',
        titulo: 'Piden reabrir una clasificación',
        intro: `Hola ${nombre}. ${quien} pidió reabrir la clasificación de una referencia. El motivo está en la plataforma.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
      });
    case 'devuelta':
      return armar({
        ...base,
        asunto: `${quien} terminó su parte en una referencia`,
        titulo: 'Terminaron su parte',
        intro: `Hola ${nombre}. ${quien} marcó «Listo por mi parte» en una referencia que le enviaste.`,
        ...(detalleReferencia ? { detalle: detalleReferencia } : {}),
      });
    case 'resumen_lote': {
      const n = p.cantidad ?? 0;
      return armar({
        enlace: p.enlace,
        pie,
        boton: 'Abrir mis pendientes',
        asunto: `Tienes ${n} descripciones mínimas pendientes`,
        titulo: `Tienes ${n} referencias pendientes`,
        intro: `Hola ${nombre}. ${quien} te envió ${n} referencias. Las encuentras todas juntas en tus pendientes.`,
        nota: sinResponder,
      });
    }
  }
}
