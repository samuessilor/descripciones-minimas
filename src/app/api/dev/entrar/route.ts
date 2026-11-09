/**
 * SOLO DESARROLLO: entra sin escribir la contrasena. `GET /api/dev/entrar?correo=lector@desarrollo.invalid` inicia sesion
 * con la contrasena de ejemplo (`CLAVE_DESARROLLO`) por el mismo camino que el acceso real, asi la sesion nace con las
 * mismas reglas. Sin `correo` muestra la lista de usuarios para elegir.
 */
import { asc } from 'drizzle-orm';
import { usuario } from '@/db/esquema';
import { getDb } from '@/db';
import { siguienteSeguro } from '@/dominio/redireccion';
import { getAuth } from '@/server/auth-app';
import { getConfig } from '@/server/config';
import { CLAVE_DESARROLLO } from '@/server/cuentas-demo';
import { soloDesarrollo } from '@/server/http';

export const dynamic = 'force-dynamic';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

export async function GET(request: Request): Promise<Response> {
  const fuera = soloDesarrollo();
  if (fuera) return fuera;
  const url = new URL(request.url);
  const correo = url.searchParams.get('correo')?.trim().toLowerCase();
  const siguiente = siguienteSeguro(url.searchParams.get('siguiente'));

  if (!correo) {
    const filas = await getDb()
      .select({ email: usuario.email, username: usuario.username, nombre: usuario.nombre, rol: usuario.rol, activo: usuario.activo })
      .from(usuario)
      .orderBy(asc(usuario.email));
    const items = filas
      .filter((f) => f.activo)
      .map(
        (f) =>
          `<li><a href="/api/dev/entrar?correo=${encodeURIComponent(f.email)}&amp;siguiente=${encodeURIComponent(siguiente)}">${esc(f.nombre)}</a> <small>${esc(f.rol)} · ${esc(f.username ?? f.email)}</small></li>`,
      )
      .join('');
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Entrar (desarrollo)</title><body style="font:16px system-ui;max-width:640px;margin:40px auto"><h1>Entrar como…</h1><p>Solo desarrollo.</p><ul style="line-height:2">${items}</ul>`,
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  try {
    const r = await getAuth().api.signInEmail({
      body: { email: correo, password: CLAVE_DESARROLLO },
      headers: new Headers(request.headers),
      returnHeaders: true,
    });
    if (!r.response?.token) throw new Error('sin sesion');
    const h = new Headers({ location: new URL(siguiente, getConfig().APP_URL).toString(), 'cache-control': 'no-store' });
    for (const c of r.headers.getSetCookie?.() ?? []) h.append('set-cookie', c);
    return new Response(null, { status: 303, headers: h });
  } catch {
    return new Response(
      `No se pudo entrar como ${esc(correo)}. Revisa que el usuario exista y este activo; si la base es vieja (sin contrasenas), reinicia los datos de ejemplo: POST /api/dev/reset.`,
      { status: 400 },
    );
  }
}
