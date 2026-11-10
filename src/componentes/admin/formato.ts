/** Formato y etiquetas compartidas por las pantallas de administracion y de cuenta (es-CO, hora de Bogota). */
import { ETIQUETA_ROL } from '@/componentes/navegacion';

const ZONA = 'America/Bogota';
const FECHA_HORA = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const FECHA = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short', year: 'numeric' });
const HORA = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, hour: 'numeric', minute: '2-digit', second: '2-digit' });

export function fechaHora(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return FECHA_HORA.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function fechaCorta(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  return FECHA.format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function horaCompleta(iso: string | Date): string {
  return HORA.format(typeof iso === 'string' ? new Date(iso) : iso);
}

/** «hace 5 min», «hace 3 h», «ayer», «hace 4 días»; con fecha completa si pasaron mas de 30 dias. */
export function hace(iso: string | Date | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return 'Nunca';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const seg = Math.round((ahora.getTime() - d.getTime()) / 1000);
  if (seg < 45) return 'ahora mismo';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const dias = Math.round(h / 24);
  if (dias === 1) return 'ayer';
  if (dias <= 30) return `hace ${dias} días`;
  return fechaCorta(d);
}

/** Tiempo hasta una fecha futura: «en 5 min», «en 2 h». Si ya paso: «ya». */
export function dentroDe(iso: string | Date, ahora: Date = new Date()): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const seg = Math.round((d.getTime() - ahora.getTime()) / 1000);
  if (seg <= 30) return 'ya';
  const min = Math.round(seg / 60);
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `en ${h} h`;
  return `en ${Math.round(h / 24)} días`;
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export const ROL_ETIQUETA = ETIQUETA_ROL;

export const ROL_DESCRIPCION: Record<string, string> = {
  admin: 'Todo, incluida la administración',
  supervisor: 'Igual que el administrador, salvo parámetros y contraseñas; no crea ni toca administradores ni supervisoras',
  solicitante: 'Crea y llena referencias',
  aduana: 'Clasifica y pide información',
  lector: 'Consulta y recuerda; no escribe',
};

export const TIPO_ORG_ETIQUETA = { interna: 'Área interna', agencia: 'Agencia de aduana' } as const;

export const ETIQUETA_ACCION: Record<string, string> = {
  login: 'Entró a la plataforma',
  login_fallido: 'Intento de entrada fallido',
  cerrar_sesion: 'Cerró sesión',
  crear_cuenta: 'Creó una cuenta',
  restablecer_clave: 'Restableció una contraseña',
  cambiar_clave: 'Cambió su contraseña',
  editar_usuario: 'Editó los datos de una persona',
  desactivar: 'Desactivó a una persona',
  reactivar: 'Reactivó a una persona',
  cambiar_rol: 'Cambió un rol',
  cambiar_organizacion: 'Cambió de organización a una persona',
  crear_organizacion: 'Creó una organización',
  editar_organizacion: 'Renombró una organización',
  cambiar_estado_organizacion: 'Activó o desactivó una organización',
  eliminar_organizacion: 'Borró una organización',
  retirar_acceso_agencia: 'Retiró el acceso de una agencia',
  guardar_catalogo: 'Cambió un valor de lista',
  guardar_restriccion: 'Guardó una restricción',
  guardar_partida: 'Guardó una partida',
  actualizar_preferencias: 'Cambió sus preferencias',
  enviar_a: 'Envió una referencia',
  enviar_lote: 'Envió varias referencias',
  recordar: 'Recordó un pendiente',
  reasignar: 'Reasignó un pendiente',
  exportar: 'Descargó una exportación',
  restaurar: 'Restauró un valor',
  reabrir: 'Reabrió una clasificación',
  solicitar_reapertura: 'Pidió reabrir una clasificación',
  archivar: 'Archivó una referencia',
  desarchivar: 'Restauró una referencia archivada',
  corregir_codigo: 'Corrigió un código',
  retirar_adjunto: 'Retiró una foto',
  leer_adjunto: 'Abrió una foto',
  crear_referencia: 'Creó una referencia',
  finalizar: 'Cerró una clasificación',
  cambiar_partida: 'Cambió una partida',
  marcar_listo: 'Marcó su parte como lista',
  cancelar_asignacion: 'Canceló un pendiente',
  retencion: 'Limpieza automática',
};

export function etiquetaAccion(accion: string): string {
  return ETIQUETA_ACCION[accion] ?? accion.replace(/_/g, ' ');
}

export const ETIQUETA_ENTIDAD: Record<string, string> = {
  usuario: 'Persona',
  referencia: 'Referencia',
  organizacion: 'Organización',
  catalogo_item: 'Valor de lista',
  restriccion_plantilla: 'Restricción',
  partida_arancelaria: 'Partida',
  auditoria: 'Auditoría',
  asignacion: 'Pendiente',
  lote: 'Envío en lote',
  adjunto: 'Foto',
  exportacion: 'Exportación',
};

export const ETIQUETA_PEDIDO: Record<string, string> = {
  completar: 'Completar',
  clasificar: 'Clasificar',
  responder: 'Responder',
  revisar: 'Revisar',
};

/** «Chrome en Windows», «Safari en iPhone»... a partir del agente de usuario, sin librerias. */
export function describirNavegador(ua: string | null | undefined): string {
  if (!ua) return 'Dispositivo desconocido';
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  const so = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iOS/.test(ua) ? 'iPhone o iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  if (nav && so) return `${nav} en ${so}`;
  return nav ?? so ?? 'Dispositivo desconocido';
}

/** IP legible: el equipo local en vez de `::1` o ceros, y nada si el dato es la direccion «vacia» de IPv6. */
export function formatearIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim();
  if (/^(0{1,4}:){7}0{1,4}$/.test(v) || v === '::') return null;
  if (/^(0{1,4}:){7}0{0,3}1$/.test(v) || v === '::1' || v === '127.0.0.1' || v === '::ffff:127.0.0.1') return 'este equipo';
  return v;
}
