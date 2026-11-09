import {
  Bell,
  CheckCheck,
  Clock,
  MessageSquareText,
  Pencil,
  Send,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { ETIQUETA_PEDIDO, type Pedido } from '@/dominio/colaboracion';
import { Insignia } from '@/componentes/ui/insignia';
import { cn } from '@/lib/utils';

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
