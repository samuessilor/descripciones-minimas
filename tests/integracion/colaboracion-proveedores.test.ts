/**
 * H3 · Proveedores de correo contra DOBLES LOCALES que hablan el mismo protocolo (SPEC 14, P-04):
 *  - Resend: servidor HTTP que imita `POST /emails` con `Idempotency-Key` (la misma clave con el mismo cuerpo repite
 *    la respuesta sin enviar otra vez; con otro cuerpo, 409), 503 y 429.
 *  - SMTP: servidor minimo (EHLO / MAIL / RCPT / DATA) con modo "rechaza al destinatario".
 *
 * NO SE VERIFICO CONTRA RESEND NI CONTRA UN SMTP REAL (sin credenciales): los dobles prueban que el codigo manda lo
 * correcto y reacciona bien a las respuestas documentadas, no que la cuenta real funcione.
 */
import { createHash } from 'node:crypto';
import { createServer as crearServidorHttp, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as crearServidorTcp, type Server as ServidorTcp, type Socket } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entregaCorreo } from '@/db/esquema';
import type { Conexion } from '@/db/conexion';
import { despachar } from '@/server/correo/despachar';
import { encolarCorreo } from '@/server/correo/outbox';
import { crearMailerResend, crearMailerSmtp } from '@/server/correo/proveedores';
import { renderizarAviso } from '@/server/correo/plantillas';
import { nuevaBd } from './ayudas';

// ---- Doble de Resend ---------------------------------------------------------------------------------------------

type ModoResend = 'ok' | 'caido' | 'limite';

class ResendDoble {
  modo: ModoResend = 'ok';
  /** Correos DISTINTOS aceptados (una repeticion idempotente no cuenta). */
  aceptados: Array<{ clave: string | null; cuerpo: Record<string, unknown>; auth: string | undefined }> = [];
  peticiones = 0;
  private porClave = new Map<string, { hash: string; id: string }>();
  servidor!: Server;
  url = '';

  async iniciar(): Promise<void> {
    this.servidor = crearServidorHttp((req, res) => void this.atender(req, res));
    await new Promise<void>((ok) => this.servidor.listen(0, '127.0.0.1', ok));
    const { port } = this.servidor.address() as { port: number };
    this.url = `http://127.0.0.1:${port}`;
  }

  async detener(): Promise<void> {
    await new Promise<void>((ok) => this.servidor.close(() => ok()));
  }

  private async atender(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.peticiones += 1;
    const trozos: Buffer[] = [];
    for await (const t of req) trozos.push(t as Buffer);
    const texto = Buffer.concat(trozos).toString('utf8');
    const responder = (estado: number, cuerpo: unknown) => {
      res.writeHead(estado, { 'content-type': 'application/json' });
      res.end(JSON.stringify(cuerpo));
    };
    if (req.method !== 'POST' || req.url !== '/emails') return responder(404, { name: 'not_found', message: 'Ruta no encontrada', statusCode: 404 });
    if (this.modo === 'caido') return responder(503, { name: 'application_error', message: 'Servicio no disponible', statusCode: 503 });
    if (this.modo === 'limite') return responder(429, { name: 'rate_limit_exceeded', message: 'Demasiadas solicitudes', statusCode: 429 });
    const cuerpo = JSON.parse(texto) as Record<string, unknown>;
    const clave = (req.headers['idempotency-key'] as string | undefined) ?? null;
    const hash = createHash('sha256').update(texto).digest('hex');
    if (clave) {
      const previo = this.porClave.get(clave);
      if (previo) {
        if (previo.hash !== hash) {
          return responder(409, { name: 'invalid_idempotent_request', message: 'La misma clave con otro cuerpo', statusCode: 409 });
        }
        return responder(200, { id: previo.id }); // repeticion: misma respuesta, SIN enviar otra vez
      }
    }
    const id = `msg_${this.aceptados.length + 1}`;
    if (clave) this.porClave.set(clave, { hash, id });
    this.aceptados.push({ clave, cuerpo, auth: req.headers.authorization });
    return responder(200, { id });
  }
}

// ---- Doble de SMTP ---------------------------------------------------------------------------------------------------

function decodificarQp(s: string): string {
  const sinSaltos = s.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < sinSaltos.length; i++) {
    const c = sinSaltos[i]!;
    if (c === '=' && /^[0-9A-F]{2}$/i.test(sinSaltos.slice(i + 1, i + 3))) {
      bytes.push(Number.parseInt(sinSaltos.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(c, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

class SmtpDoble {
  rechazarDestinatario = false;
  mensajes: Array<{ para: string; crudo: string }> = [];
  servidor!: ServidorTcp;
  puerto = 0;

  async iniciar(): Promise<void> {
    this.servidor = crearServidorTcp((s) => this.atender(s));
    await new Promise<void>((ok) => this.servidor.listen(0, '127.0.0.1', ok));
    this.puerto = (this.servidor.address() as { port: number }).port;
  }

  async detener(): Promise<void> {
    await new Promise<void>((ok) => this.servidor.close(() => ok()));
  }

  private atender(s: Socket): void {
    s.setEncoding('utf8');
    let enDatos = false;
    let datos = '';
    let para = '';
    let resto = '';
    s.write('220 doble.local ESMTP\r\n');
    s.on('data', (trozo: string) => {
      if (enDatos) {
        datos += trozo;
        if (datos.includes('\r\n.\r\n')) {
          enDatos = false;
          this.mensajes.push({ para, crudo: datos.replace(/\r\n\.\r\n$/, '') });
          datos = '';
          s.write('250 2.0.0 Aceptado\r\n');
        }
        return;
      }
      resto += trozo;
      let i: number;
      while ((i = resto.indexOf('\r\n')) >= 0) {
        const linea = resto.slice(0, i);
        resto = resto.slice(i + 2);
        const cmd = linea.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) s.write('250-doble.local\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('MAIL FROM')) s.write('250 2.1.0 Ok\r\n');
        else if (cmd.startsWith('RCPT TO')) {
          para = /<([^>]+)>/.exec(linea)?.[1] ?? '';
          s.write(this.rechazarDestinatario ? '550 5.1.1 Usuario desconocido\r\n' : '250 2.1.5 Ok\r\n');
        } else if (cmd.startsWith('DATA')) {
          enDatos = true;
          s.write('354 Adelante\r\n');
        } else if (cmd.startsWith('RSET')) s.write('250 Ok\r\n');
        else if (cmd.startsWith('QUIT')) {
          s.write('221 Adios\r\n');
          s.end();
        } else s.write('250 Ok\r\n');
      }
    });
    s.on('error', () => undefined);
  }
}

// ---- Pruebas -----------------------------------------------------------------------------------------------------

let c: Conexion;
const resend = new ResendDoble();
const smtp = new SmtpDoble();
const T0 = new Date('2026-10-21T15:00:00.000Z');

beforeAll(async () => {
  c = await nuevaBd();
  await resend.iniciar();
  await smtp.iniciar();
  process.env.RESEND_BASE_URL = resend.url;
});
afterAll(async () => {
  delete process.env.RESEND_BASE_URL;
  await resend.detener();
  await smtp.detener();
  await c.cerrar();
});

let n = 0;
async function encolar(para: string): Promise<string> {
  n += 1;
  const { id } = await encolarCorreo(c.db, {
    destinatario: para,
    plantilla: 'pendiente',
    claveIdempotencia: `prov:${n}:${Date.now()}`,
    contenido: renderizarAviso('pendiente', {
      nombre: 'Brian',
      quien: 'Edward',
      enlace: 'http://localhost:3000/referencias/22222222-3333-4444-8555-666666666666',
      contacto: 'el administrador',
      pedido: 'clasificar',
    }),
    proximoIntento: T0,
  });
  return id;
}

describe('Resend (doble fiel: POST /emails con Idempotency-Key)', () => {
  it('envia con la clave de idempotencia, el remitente, el asunto y el cuerpo guardados', async () => {
    resend.modo = 'ok';
    const antes = resend.aceptados.length;
    const mailer = crearMailerResend('re_clave_de_prueba', 'Descripciones mínimas <avisos@desarrollo.invalid>');
    await mailer.enviar({ para: 'brian@x.invalid', asunto: 'Tienes una descripción mínima pendiente', texto: 'hola', html: '<p>hola</p>', claveIdempotencia: 'asig:1:inicial' });
    expect(resend.aceptados).toHaveLength(antes + 1);
    const m = resend.aceptados[antes]!;
    expect(m.clave).toBe('asig:1:inicial');
    expect(m.auth).toBe('Bearer re_clave_de_prueba');
    expect(m.cuerpo).toMatchObject({ from: 'Descripciones mínimas <avisos@desarrollo.invalid>', to: ['brian@x.invalid'], subject: 'Tienes una descripción mínima pendiente', text: 'hola', html: '<p>hola</p>' });
  });

  it('la MISMA clave con el MISMO cuerpo no envia dos veces (un reintento tras morir la funcion)', async () => {
    resend.modo = 'ok';
    const antes = resend.aceptados.length;
    const mailer = crearMailerResend('re_clave_de_prueba', 'Avisos <avisos@desarrollo.invalid>');
    const msg = { para: 'a@x.invalid', asunto: 'Asunto', texto: 't', html: '<p>t</p>', claveIdempotencia: 'asig:2:inicial' };
    await mailer.enviar(msg);
    await mailer.enviar(msg);
    await mailer.enviar(msg);
    expect(resend.aceptados).toHaveLength(antes + 1);
  });

  it('la misma clave con OTRO cuerpo es 409: por eso el cuerpo de cada fila es inmutable', async () => {
    const mailer = crearMailerResend('re_clave_de_prueba', 'Avisos <avisos@desarrollo.invalid>');
    await mailer.enviar({ para: 'a@x.invalid', asunto: 'Uno', texto: 't', html: '<p>t</p>', claveIdempotencia: 'asig:3:inicial' });
    await expect(
      mailer.enviar({ para: 'a@x.invalid', asunto: 'Otro asunto', texto: 't', html: '<p>t</p>', claveIdempotencia: 'asig:3:inicial' }),
    ).rejects.toThrow(/HTTP 409.*invalid_idempotent_request/);
  });

  it('cae el proveedor (503) y limite (429): lanza con el estado HTTP para que el despachador reintente', async () => {
    const mailer = crearMailerResend('re_clave_de_prueba', 'Avisos <avisos@desarrollo.invalid>');
    resend.modo = 'caido';
    await expect(mailer.enviar({ para: 'a@x.invalid', asunto: 'A', texto: 't', html: '<p>t</p>', claveIdempotencia: 'k1' })).rejects.toThrow(/HTTP 503/);
    resend.modo = 'limite';
    await expect(mailer.enviar({ para: 'a@x.invalid', asunto: 'A', texto: 't', html: '<p>t</p>', claveIdempotencia: 'k2' })).rejects.toThrow(/HTTP 429/);
    resend.modo = 'ok';
  });

  it('de punta a punta con el despachador: cae -> fallido -> vuelve -> enviado, y el proveedor recibe UN solo correo', async () => {
    const id = await encolar('brian@x.invalid');
    const mailer = crearMailerResend('re_clave_de_prueba', 'Avisos <avisos@desarrollo.invalid>');
    const antes = resend.aceptados.length;

    resend.modo = 'caido';
    const r1 = await despachar({ db: c.db, mailer, ahora: T0, ids: [id] });
    expect(r1.fallidos).toBe(1);
    const [f1] = await c.db.select().from(entregaCorreo).where(eq(entregaCorreo.id, id));
    expect(f1?.estado).toBe('fallido');
    expect(f1?.ultimoError).toContain('503');

    resend.modo = 'ok';
    const r2 = await despachar({ db: c.db, mailer, ahora: new Date(T0.getTime() + 6 * 60_000), ids: [id] });
    expect(r2.enviados).toBe(1);
    const [f2] = await c.db.select().from(entregaCorreo).where(eq(entregaCorreo.id, id));
    expect(f2?.estado).toBe('enviado');
    expect(f2?.intentos).toBe(2);
    expect(resend.aceptados).toHaveLength(antes + 1);
    expect(resend.aceptados[antes]?.clave).toBe(f2?.claveIdempotencia);
  });
});

describe('SMTP (doble: EHLO / MAIL / RCPT / DATA)', () => {
  it('entrega al destinatario con el enlace, el texto plano alterno y el HTML', async () => {
    smtp.rechazarDestinatario = false;
    const antes = smtp.mensajes.length;
    const mailer = crearMailerSmtp(`smtp://127.0.0.1:${smtp.puerto}`, 'Descripciones mínimas <avisos@desarrollo.invalid>');
    const contenido = renderizarAviso('pendiente', { nombre: 'Brian', quien: 'Edward', enlace: 'http://localhost:3000/referencias/aaaa', contacto: 'el administrador', pedido: 'clasificar' });
    await mailer.enviar({ para: 'brian@x.invalid', asunto: contenido.asunto, texto: contenido.texto, html: contenido.html, claveIdempotencia: 'asig:9:inicial' });
    expect(smtp.mensajes).toHaveLength(antes + 1);
    const m = smtp.mensajes[antes]!;
    expect(m.para).toBe('brian@x.invalid');
    expect(m.crudo).toContain('X-Entity-Ref-ID: asig:9:inicial');
    expect(m.crudo).toContain('multipart/alternative');
    const cuerpo = decodificarQp(m.crudo);
    expect(cuerpo).toContain('http://localhost:3000/referencias/aaaa');
    expect(cuerpo).toContain('Abrir la referencia');
  });

  it('un destinatario rechazado (550) es un fallo que el despachador reintenta', async () => {
    smtp.rechazarDestinatario = true;
    const id = await encolar('inexistente@x.invalid');
    const mailer = crearMailerSmtp(`smtp://127.0.0.1:${smtp.puerto}`, 'Avisos <avisos@desarrollo.invalid>');
    const r = await despachar({ db: c.db, mailer, ahora: T0, ids: [id] });
    expect(r.fallidos).toBe(1);
    const [f] = await c.db.select().from(entregaCorreo).where(eq(entregaCorreo.id, id));
    expect(f?.estado).toBe('fallido');
    expect(f?.ultimoError).toMatch(/550|rechaz|Usuario desconocido|Recipient/i);
    smtp.rechazarDestinatario = false;
  });

  it('un servidor que no existe es un fallo (no un cuelgue)', async () => {
    const id = await encolar('brian@x.invalid');
    const mailer = crearMailerSmtp('smtp://127.0.0.1:1', 'Avisos <avisos@desarrollo.invalid>');
    const r = await despachar({ db: c.db, mailer, ahora: T0, ids: [id], tiempoMaxEnvioMs: 8000 });
    expect(r.fallidos).toBe(1);
  });
});
