/**
 * Parametros vigentes para la pantalla «Parametros» (solo lectura). Se leen de la configuracion REAL del proceso
 * y de las constantes del codigo; nunca se devuelve un secreto (ni su valor, ni parte de el): de las llaves solo
 * se dice si estan puestas o no.
 */
import type { Config } from './config';
import { REGLAS_TASA } from './limite-tasa';
import type { Actor } from './politicas/actor';
import { exigir } from './politicas/exigir';

export interface Parametro {
  /** Nombre de la variable de entorno que lo cambia; `null` si es una regla del producto (cambia con codigo). */
  variable: string | null;
  nombre: string;
  valor: string;
  nota?: string;
}

export interface GrupoParametros {
  id: string;
  titulo: string;
  descripcion: string;
  parametros: Parametro[];
}

function duracion(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)} s`;
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 48) return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  return `${Math.round(h / 24)} días`;
}

const veces = (r: { max: number; ventanaMs: number }) => `${r.max} cada ${duracion(r.ventanaMs)}`;
const horas = (h: number) => (h % 24 === 0 && h >= 48 ? `${h / 24} días (${h} h)` : `${h} h`);

export function leerParametros(actor: Pick<Actor, 'rol'>, c: Config): GrupoParametros[] {
  exigir(actor, 'administrar'); // Parametros es solo del administrador: la supervisora no llega a esta logica.
  return [
    {
      id: 'acceso',
      titulo: 'Acceso y sesiones',
      descripcion: 'Cuánto tiempo se mantiene abierta una sesión. Se entra con usuario y contraseña.',
      parametros: [
        { variable: 'SESION_INACTIVIDAD_HORAS_INTERNO', nombre: 'Inactividad máxima, personal interno', valor: horas(c.SESION_INACTIVIDAD_HORAS_INTERNO) },
        { variable: 'SESION_ABSOLUTA_HORAS_INTERNO', nombre: 'Duración máxima de sesión, personal interno', valor: horas(c.SESION_ABSOLUTA_HORAS_INTERNO) },
        { variable: 'SESION_INACTIVIDAD_HORAS_EXTERNO', nombre: 'Inactividad máxima, agencias', valor: horas(c.SESION_INACTIVIDAD_HORAS_EXTERNO) },
        { variable: 'SESION_ABSOLUTA_HORAS_EXTERNO', nombre: 'Duración máxima de sesión, agencias', valor: horas(c.SESION_ABSOLUTA_HORAS_EXTERNO) },
      ],
    },
    {
      id: 'limites',
      titulo: 'Límites de uso',
      descripcion: 'Topes que protegen la plataforma de abusos y de errores. Se cuentan por persona, usuario o dirección IP.',
      parametros: [
        { variable: null, nombre: 'Intentos de entrada fallidos, por usuario', valor: veces(REGLAS_TASA.accesoFallidoPorUsuario), nota: 'Entrar bien no cuenta. Pasado el tope, espera a que se reinicie la ventana.' },
        { variable: null, nombre: 'Intentos de entrada, por dirección IP', valor: veces(REGLAS_TASA.accesoPorIp) },
        { variable: null, nombre: 'Cambiar la contraseña, por persona', valor: veces(REGLAS_TASA.cambiarClave) },
        { variable: null, nombre: 'Subir fotos, por persona', valor: veces(REGLAS_TASA.subirArchivo) },
        { variable: null, nombre: 'Descargar Excel, por persona', valor: veces(REGLAS_TASA.exportar) },
        { variable: null, nombre: 'Buscar, por persona', valor: veces(REGLAS_TASA.buscar) },
        { variable: null, nombre: 'Enviar a, por persona', valor: veces(REGLAS_TASA.enviarA) },
        { variable: 'RECORDATORIO_MANUAL_MAX_DIA', nombre: 'Recordatorios por asignación y día', valor: String(c.RECORDATORIO_MANUAL_MAX_DIA) },
      ],
    },
    {
      id: 'clasificacion',
      titulo: 'Clasificación y acceso de las agencias',
      descripcion: 'Qué pasa al cerrar una clasificación y cuánto tiempo conserva la agencia el acceso a la referencia.',
      parametros: [
        {
          variable: 'CIERRE_MODO',
          nombre: 'Modo de cierre de la clasificación',
          valor: c.CIERRE_MODO === 'bloquear' ? 'Bloquear' : 'Advertir',
          nota:
            c.CIERRE_MODO === 'bloquear'
              ? 'Si hay advertencias, la clasificación no se puede cerrar hasta resolverlas.'
              : 'Si hay advertencias, se puede cerrar de todos modos explicando el motivo.',
        },
        { variable: 'ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR', nombre: 'Días de acceso de la agencia tras clasificar', valor: `${c.ACCESO_AGENCIA_DIAS_TRAS_CLASIFICAR} días` },
      ],
    },
    {
      id: 'sistema',
      titulo: 'Sistema',
      descripcion: 'Dónde corre y dónde guarda lo que recibe.',
      parametros: [
        { variable: 'NODE_ENV', nombre: 'Entorno', valor: c.NODE_ENV === 'production' ? 'Producción' : c.NODE_ENV === 'test' ? 'Pruebas' : 'Desarrollo' },
        { variable: 'APP_URL', nombre: 'Dirección pública', valor: c.APP_URL },
        { variable: 'DATABASE_URL', nombre: 'Base de datos', valor: c.DATABASE_URL ? 'Postgres externo' : 'Local embebida (PGlite)', nota: 'La cadena de conexión no se muestra.' },
        { variable: 'ALMACEN', nombre: 'Almacén de fotos', valor: c.ALMACEN === 'blob' ? 'Vercel Blob' : 'Disco local' },
        { variable: 'CONTACTO_ADMIN', nombre: 'Contacto que ven las personas', valor: c.CONTACTO_ADMIN },
      ],
    },
  ];
}
