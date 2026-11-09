/**
 * `avisar`: la unidad de confianza de las notificaciones (SPEC 14). En UNA llamada y dentro de la
 * transaccion de quien la invoca deja:
 *   1. la notificacion en la bandeja (fuente de verdad), y
 *   2. si el tipo sale por correo y la persona lo acepta, la fila del outbox con el contenido ya
 *      renderizado (el reintento envia exactamente lo mismo).
 * Si la transaccion se revierte, no queda ni aviso ni correo; si el proveedor de correo cae despues,
 * el pendiente igual esta en la bandeja y el despachador reintenta.
 */
import type { Ejecutor } from '@/db/tipos';
import { getConfig } from '../config';
import { encolarCorreo } from '../correo/outbox';
import { renderizarAviso, type ParamsAviso, type PlantillaAviso } from '../correo/plantillas';
import { crearNotificacion, type TipoNotificacion } from './crear';

/** Que tipos salen tambien por correo (tabla de "Que cae en cada canal", SPEC 14). */
export const TIPOS_CON_CORREO: ReadonlySet<TipoNotificacion> = new Set<TipoNotificacion>([
  'asignacion',
  'recordatorio',
  'respuesta',
  'clasificada',
  'reabierta',
  'reapertura_solicitada',
]);

export interface DestinoAviso {
  id: string;
  nombre: string;
  email: string;
  preferenciaAviso: string;
  correoInvalido: boolean;
}

/** Como le llego el aviso a la persona. */
export type CanalAviso = 'correo' | 'solo_bandeja' | 'correo_invalido' | 'sin_correo';

export interface ResultadoAviso {
  notificacionId: string;
  canal: CanalAviso;
  /** Id de la fila del outbox (null si no hay correo). */
  correoId: string | null;
}

export interface OpcionesAviso {
  destino: DestinoAviso;
  tipo: TipoNotificacion;
  referenciaId: string;
  asignacionId?: string | null;
  titulo: string;
  ahora: Date;
  correo?: CorreoDeAviso | null;
  contacto: string;
}

export interface CorreoDeAviso {
  plantilla: PlantillaAviso;
  params: Omit<ParamsAviso, 'nombre' | 'contacto'>;
  /** Por defecto `notif:<id de la notificacion>`. Para la asignacion inicial: `asig:<id>:inicial`. */
  clave?: string;
}

/** Encola el correo de una notificacion ya creada, respetando la preferencia y el correo invalido. */
export async function encolarAviso(
  tx: Ejecutor,
  p: { destino: DestinoAviso; notificacionId: string; correo: CorreoDeAviso; contacto: string },
): Promise<{ canal: CanalAviso; correoId: string | null }> {
  // Modo basico: el aviso vive solo en la app (campana y «Para mí»). Sin cola, sin despachador, sin cron.
  if (!getConfig().AVISOS_POR_CORREO) return { canal: 'sin_correo', correoId: null };
  // "Solo en la plataforma": la persona eligio no recibir correo (preferencia de /cuenta).
  if (p.destino.preferenciaAviso === 'solo_bandeja') return { canal: 'solo_bandeja', correoId: null };

  const contenido = renderizarAviso(p.correo.plantilla, {
    ...p.correo.params,
    nombre: p.destino.nombre,
    contacto: p.contacto,
  });
  const clave = p.correo.clave ?? `notif:${p.notificacionId}`;

  if (p.destino.correoInvalido) {
    // Queda registrado como no entregable para que quien envio vea "El correo no se pudo entregar".
    const { id } = await encolarCorreo(tx, {
      notificacionId: p.notificacionId,
      destinatario: p.destino.email,
      plantilla: p.correo.plantilla,
      claveIdempotencia: clave,
      contenido,
      estadoInicial: { estado: 'abandonado', ultimoError: 'El correo del destinatario está marcado como inválido.' },
    });
    return { canal: 'correo_invalido', correoId: id };
  }

  const { id } = await encolarCorreo(tx, {
    notificacionId: p.notificacionId,
    destinatario: p.destino.email,
    plantilla: p.correo.plantilla,
    claveIdempotencia: clave,
    contenido,
  });
  return { canal: 'correo', correoId: id };
}

export async function avisar(tx: Ejecutor, o: OpcionesAviso): Promise<ResultadoAviso> {
  const notificacionId = await crearNotificacion(tx, {
    usuarioId: o.destino.id,
    tipo: o.tipo,
    referenciaId: o.referenciaId,
    titulo: o.titulo,
    asignacionId: o.asignacionId ?? null,
    creadaEn: o.ahora,
  });
  if (!o.correo || !TIPOS_CON_CORREO.has(o.tipo)) {
    return { notificacionId, canal: 'sin_correo', correoId: null };
  }
  const r = await encolarAviso(tx, { destino: o.destino, notificacionId, correo: o.correo, contacto: o.contacto });
  return { notificacionId, ...r };
}
