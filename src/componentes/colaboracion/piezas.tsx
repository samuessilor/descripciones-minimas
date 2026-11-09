import {
  Bell,
  CheckCheck,
  Clock,
  MailCheck,
  MailWarning,
  MessageSquareText,
  Pencil,
  RefreshCw,
  Send,
  Undo2,
  Mail,
  Hourglass,
  type LucideIcon,
} from 'lucide-react';
import { ETIQUETA_PEDIDO, type Pedido } from '@/dominio/colaboracion';
import { Insignia } from '@/componentes/ui/insignia';
import { cn } from '@/lib/utils';
import type { EntregaVista } from '@/server/politicas/colaboracion';

/**
 * Estado del CORREO de un envio, siempre con icono + palabra (nunca solo color). El pendiente vive en la
 * bandeja de la persona; el correo es un aviso. Por eso un fallo se dice sin dramatismo y con salida:
 * «avísale por otro medio» (SPEC 14).
 */
export function InsigniaCorreo({ entrega, className }: { entrega: EntregaVista; className?: string }) {
  switch (entrega.estado) {
    case 'enviado':
      return (
        <Insignia variante="azul" className={className} icono={<MailCheck aria-hidden className="size-3.5" />}>
          Correo enviado
        </Insignia>
      );
    case 'en_cola':
      return (
        <Insignia variante="neutra" className={className} icono={<Hourglass aria-hidden className="size-3.5" />}>
          Correo en camino
        </Insignia>
      );
    case 'reintentando':
      return (
        <Insignia variante="neutra" className={className} icono={<RefreshCw aria-hidden className="size-3.5" />}>
          Reintentando el correo
        </Insignia>
      );
    case 'no_entregable':
      return (
        <Insignia variante="error" className={className} icono={<MailWarning aria-hidden className="size-3.5" />}>
          Correo sin entregar
        </Insignia>
      );
    default:
      return (
        <Insignia variante="contorno" className={className} icono={<Mail aria-hidden className="size-3.5" />}>
          Solo en la plataforma
        </Insignia>
      );
  }
}

/** Frase de salida cuando el correo no llego (se muestra bajo la insignia, solo a quien envio). */
export function textoSalidaCorreo(entrega: EntregaVista): string | null {
  if (entrega.estado === 'no_entregable') return 'El correo no se pudo entregar. El pendiente sí está en su bandeja; avísale por otro medio.';
  if (entrega.estado === 'reintentando') return 'El proveedor de correo falló. Seguimos intentando solos; el pendiente ya está en su bandeja.';
  return null;
}

export function InsigniaPedido({ pedido, className }: { pedido: Pedido | null; className?: string }) {
  if (!pedido) return null;
  return <Insignia variante="contorno" className={className}>{ETIQUETA_PEDIDO[pedido]}</Insignia>;
}

const ICONO_TIPO: Record<string, LucideIcon> = {
  asignacion: Send,
  recordatorio: Clock,
  respuesta: CheckCheck,
  clasificada: CheckCheck,
  reabierta: Undo2,
  reapertura_solicitada: Undo2,
  cambio_en_mi_campo: Pencil,
  comentario: MessageSquareText,
};

/** Icono redondo de un aviso, por tipo. Decorativo: el titulo dice todo. */
export function IconoAviso({ tipo, noLeida, className }: { tipo: string; noLeida?: boolean; className?: string }) {
  const Icono = ICONO_TIPO[tipo] ?? Bell;
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full border',
        noLeida ? 'border-azul-300 bg-azul-100 text-azul-800' : 'border-borde-suave bg-superficie-2 text-tinta-suave',
        className,
      )}
    >
      <Icono className="size-4.5" strokeWidth={1.9} />
    </span>
  );
}
