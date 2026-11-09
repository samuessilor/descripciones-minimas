/**
 * `proxy.ts` (Next 16; antes `middleware.ts`). PRIMERA barrera, no la autorizacion real (13.2):
 *  1. rechaza toda peticion mutante sin `Origin` valido (o sin `Sec-Fetch-Site: same-origin`), RV-20:
 *     Next deja pasar una peticion sin `Origin` con solo una advertencia;
 *  2. exige que haya cookie de sesion en todo salvo /entrar*, /api/auth/*, /api/cron/* (con su propio
 *     secreto) y estaticos. Que la cookie exista NO prueba nada: `getActor()` relee `usuario.activo`;
 *  3. pone las cabeceras de seguridad, con CSP por peticion (nonce). Todas las paginas autenticadas
 *     son dinamicas (usan `cookies()`), asi que el nonce por peticion es compatible.
 *
 * Nota de ubicacion: con carpeta `src/`, Next exige el archivo en `src/proxy.ts` (el SPEC lo lista en
 * la raiz de `app/`).
 */
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { siguienteSeguro } from '@/dominio/redireccion';

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PUBLICAS = [
  /^\/entrar(\/|$)/,
  /^\/api\/auth(\/|$)/,
  /^\/api\/cron(\/|$)/,
  /^\/robots\.txt$/,
  // Marca estatica: el icono de la pestana y `public/marca/` (el logo de la pantalla de entrada).
  /^\/icon\.svg$/,
  /^\/marca\//,
  // Biblioteca de componentes (/dev/ui): sin sesion, pero la propia pagina responde 404 fuera de desarrollo.
  /^\/dev(\/|$)/,
];

function esDesarrollo(): boolean {
  return process.env.NODE_ENV === 'development';
}

function origenPermitido(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    if (origin === 'null') return false;
    const permitidos = new Set<string>([request.nextUrl.origin]);
    try {
      permitidos.add(new URL(process.env.APP_URL || 'http://localhost:3000').origin);
    } catch {
      /* APP_URL invalida: la valida config.ts */
    }
    return permitidos.has(origin);
  }
  return request.headers.get('sec-fetch-site') === 'same-origin';
}

function construirCsp(nonce: string, dev: boolean): string {
  const directivas = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    dev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    // Los atributos style="" de React/Tailwind no admiten nonce: solo se permiten como atributo.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!dev) directivas.push('upgrade-insecure-requests');
  return directivas.join('; ');
}

function cabecerasDeSeguridad(h: Headers, csp: string): void {
  h.set('Content-Security-Policy', csp);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // La camara solo en `self`: la foto del celular (13.3).
  h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  h.set('X-Robots-Tag', 'noindex, nofollow');
  h.set('X-Frame-Options', 'DENY');
  const https = (process.env.APP_URL ?? '').startsWith('https://');
  if (https && !esDesarrollo()) h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
}

function respuestaJson(cuerpo: unknown, estado: number, csp: string): NextResponse {
  const r = NextResponse.json(cuerpo, { status: estado, headers: { 'cache-control': 'no-store' } });
  cabecerasDeSeguridad(r.headers, csp);
  return r;
}

export function proxy(request: NextRequest): NextResponse {
  const dev = esDesarrollo();
  const nonce = btoa(crypto.randomUUID());
  const csp = construirCsp(nonce, dev);
  const { pathname, search } = request.nextUrl;
  const esApi = pathname.startsWith('/api/');
  const esDevApi = pathname.startsWith('/api/dev/');

  // /api/dev/* solo existe en desarrollo.
  if (esDevApi && !dev) return respuestaJson({ ok: false, codigo: 'NO_ENCONTRADO' }, 404, csp);

  // 1. CSRF: toda mutacion exige Origin valido. (Las utilidades de /api/dev, solo en desarrollo, se
  //    llaman desde curl y scripts sin Origin; un navegador SIEMPRE envia Origin en un POST entre sitios.)
  if (METODOS_MUTANTES.has(request.method) && !origenPermitido(request) && !(dev && esDevApi && !request.headers.get('origin'))) {
    return respuestaJson(
      { ok: false, codigo: 'SIN_PERMISO', mensaje: 'Petición rechazada: el origen no es válido.' },
      403,
      csp,
    );
  }

  // 2. Sesion presente (primera barrera).
  const publica = PUBLICAS.some((p) => p.test(pathname)) || (dev && esDevApi);
  if (!publica && !getSessionCookie(request)) {
    if (esApi) {
      return respuestaJson(
        { ok: false, codigo: 'SIN_PERMISO', mensaje: 'Tu sesión venció. Entra de nuevo.', detalle: { sesionVencida: true } },
        401,
        csp,
      );
    }
    const destino = new URL('/entrar', request.url);
    const siguiente = siguienteSeguro(`${pathname}${search}`);
    if (siguiente !== '/') destino.searchParams.set('siguiente', siguiente);
    const r = NextResponse.redirect(destino);
    cabecerasDeSeguridad(r.headers, csp);
    return r;
  }

  // 3. Cabeceras de seguridad y nonce para Next.
  const entrada = new Headers(request.headers);
  entrada.set('x-nonce', nonce);
  entrada.set('content-security-policy', csp);
  entrada.set('x-ruta', `${pathname}${search}`); // siempre reescrita: el cliente no puede falsearla
  const r = NextResponse.next({ request: { headers: entrada } });
  cabecerasDeSeguridad(r.headers, csp);
  return r;
}

/**
 * El proxy corre en TODA ruta salvo los estaticos de compilacion. NO se excluye por extension
 * (`.png`, `.svg`...): una ruta dinamica como `/referencias/<id>.png` o `/api/adjuntos/<id>.jpg` se
 * saltaria Origin, sesion y CSP (13.3, RV-20). Los archivos de `public/` y los iconos se sirven igual,
 * con el costo minimo del proxy, y los publicos estan en `PUBLICAS`.
 */
export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|favicon.ico).*)' }],
};
