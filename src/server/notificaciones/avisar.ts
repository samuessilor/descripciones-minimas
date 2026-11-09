/**
 * `avisar`: la unidad de confianza de las notificaciones (SPEC 14). En la transaccion de quien la invoca deja la
 * notificacion en la bandeja (campana y «Para mi»): es la fuente de verdad y el unico canal. Si la transaccion se
 * revierte, no queda el aviso. No hay correo: cada persona ve lo suyo al entrar a la plataforma.
 */
import type { Ejecutor } from '@/db/tipos';
import { crearNotificacion, type TipoNotificacion } from './crear';

export interface DestinoAviso {
  id: string;
}

export interface OpcionesAviso {
  destino: DestinoAviso;
  tipo: TipoNotificacion;
  referenciaId: string;
  asignacionId?: string | null;
  titulo: string;
  ahora: Date;
}

export interface ResultadoAviso {
  notificacionId: string;
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
  return { notificacionId };
}
