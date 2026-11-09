/**
 * SOLO DESARROLLO: entra sin pedir enlace ni abrir el correo. `GET /api/dev/entrar?correo=lector@desarrollo.invalid`
 * crea el token como el flujo real y lo confirma en el acto, asi la sesion nace con las mismas reglas.
 * Sin `correo` muestra la lista de usuarios para elegir.
 */
import { createHash, randomBytes } from 'node:crypto';
import { asc } from 'drizzle-orm';
import { usuario } from '@/db/esquema';
import { getDb } from '@/db';
import { siguienteSeguro } from '@/dominio/redireccion';
import { confirmarEnlace } from '@/server/acceso';
import { getAuth, getDepsAcceso } from '@/server/auth-app';
import { getConfig } from '@/server/config';
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
      .select({ email: usuario.email, nombre: usuario.nombre, rol: usuario.rol, activo: usuario.activo })
      .from(usuario)
      .orderBy(asc(usuario.email));
    const items = filas
      .filter((f) => f.activo)
      .map(
        (f) =>
          `<li><a href="/api/dev/entrar?correo=${encodeURIComponent(f.email)}&amp;siguiente=${encodeURIComponent(siguiente)}">${esc(f.nombre)}</a> <small>${esc(f.rol)} · ${esc(f.email)}</small></li>`,
      )
      .join('');
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Entrar (desarrollo)</title><body style="font:16px system-ui;max-width:640px;margin:40px auto"><h1>Entrar como…</h1><p>Solo desarrollo.</p><ul style="line-height:2">${items}</ul>`,
      { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  const token = randomBytes(24).toString('base64url');
  const identificador = `magic-link:${createHash('sha256').update(token).digest('base64url')}`;
  const ctx = await getAuth().$context;
  await ctx.internalAdapter.createVerificationValue({
    identifier: identificador,
    value: JSON.stringify({ type: 'magic-link', email: correo }),
    expiresAt: new Date(Date.now() + getConfig().ENLACE_VIGENCIA_MINUTOS * 60_000),
  });
  const r = await confirmarEnlace(getDepsAcceso(), { token, siguiente, headers: new Headers(request.headers) });
  if (!r.ok) {
    return new Response(`No se pudo entrar como ${esc(correo)} (${r.motivo}). Revisa que el usuario exista y este activo.`, {
      status: 400,
    });
  }
  const h = new Headers({ location: new URL(r.siguiente, getConfig().APP_URL).toString(), 'cache-control': 'no-store' });
  for (const c of r.setCookie) h.append('set-cookie', c);
  return new Response(null, { status: 303, headers: h });
}
