/**
 * Las contrasenas contra un Postgres REAL conectando COMO el rol `app` (no duenio, D-31): crear cuenta, entrar,
 * restablecer y cambiar la propia clave usan `account` y `usuario.username`, y ese rol solo tiene los permisos que
 * `aplicar_permisos_app()` le da. PGlite corre como superusuario y no puede demostrar esto.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { account, organizacion, session, usuario } from '@/db/esquema';
import { cambiarMiClave } from '@/server/acciones/cuenta';
import { crearCuenta, restablecerClave } from '@/server/acciones/usuarios';
import { iniciarSesion, type DepsAcceso } from '@/server/acceso';
import { crearAuth } from '@/server/auth';
import { cargarConfig } from '@/server/config';
import { cargarActorPorId, type Actor } from '@/server/politicas/actor';
import { iniciarPgReal, type PgReal } from './ayudas-pg';

let r: PgReal;
let admin: Actor;
let orgId: string;
let deps: DepsAcceso;

beforeAll(async () => {
  r = await iniciarPgReal();
  const [interna] = await r.migrador.db.insert(organizacion).values({ nombre: 'Interna', tipo: 'interna' }).returning();
  orgId = interna!.id;
  const [u] = await r.migrador.db
    .insert(usuario)
    .values({ nombre: 'Ana Admin', email: 'ana@prueba.invalid', username: 'ana', rol: 'admin', organizacionId: orgId, organizacionTipo: 'interna' })
    .returning({ id: usuario.id });
  admin = (await cargarActorPorId(r.app.db, u!.id))!;
  const config = cargarConfig({ NODE_ENV: 'test', APP_URL: 'http://localhost:3000' });
  deps = { db: r.app.db, auth: crearAuth({ db: r.app.db, config }), config };
}, 240_000);

afterAll(async () => {
  await r?.detener();
});

describe('contrasenas con el rol app (no duenio)', () => {
  it('crear cuenta, entrar, restablecer y cambiar la propia clave funcionan sin permisos de duenio', async () => {
    const ctx = { db: r.app.db, actor: admin };
    const nueva = await crearCuenta(ctx, { nombre: 'Área Real', usuario: 'area-real', organizacionId: orgId, rol: 'solicitante', area: 'Consumibles' });

    const a = await iniciarSesion(deps, { usuario: 'area-real', clave: nueva.claveTemporal, headers: new Headers() });
    expect(a.ok).toBe(true);
    expect((await iniciarSesion(deps, { usuario: 'area-real', clave: 'una-clave-equivocada', headers: new Headers() })).ok).toBe(false);

    const reset = await restablecerClave(ctx, { usuarioId: nueva.id });
    expect(reset.sesionesCerradas).toBeGreaterThanOrEqual(1); // el rol app puede borrar sesiones
    expect((await iniciarSesion(deps, { usuario: 'area-real', clave: nueva.claveTemporal, headers: new Headers() })).ok).toBe(false);
    const b = await iniciarSesion(deps, { usuario: 'area-real', clave: reset.claveTemporal, headers: new Headers() });
    expect(b.ok).toBe(true);

    const yo = await cargarActorPorId(r.app.db, nueva.id);
    const [s] = await r.app.db.select({ id: session.id }).from(session).where(eq(session.userId, nueva.id)).limit(1);
    const cambio = await cambiarMiClave({ db: r.app.db, actor: { ...yo!, sesionId: s!.id } }, { actual: reset.claveTemporal, nueva: 'clave-nueva-2026', repetir: 'clave-nueva-2026' });
    expect(cambio.otrasSesionesCerradas).toBeGreaterThanOrEqual(0);
    expect((await iniciarSesion(deps, { usuario: 'area-real', clave: 'clave-nueva-2026', headers: new Headers() })).ok).toBe(true);

    const [cred] = await r.migrador.db.select().from(account).where(eq(account.userId, nueva.id));
    expect(cred?.password).toBeTruthy();
    expect(cred?.password).not.toContain('clave-nueva-2026');
  });

  it('el rol app no puede borrar cuentas ni credenciales (solo se desactivan)', async () => {
    const intento = async (sentencia: string) => {
      try {
        await r.app.db.execute(sentencia as never);
        return 'OK';
      } catch (e) {
        return String((e as { cause?: { code?: string }; code?: string }).cause?.code ?? (e as { code?: string }).code ?? e);
      }
    };
    expect(await intento('delete from "account"')).toBe('42501');
    expect(await intento('delete from "usuario"')).toBe('42501');
  });
});
