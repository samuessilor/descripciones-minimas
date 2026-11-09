import type { NextConfig } from 'next';

// Igual que `cargarConfig`: en Vercel, sin APP_URL se usa la direccion del despliegue.
const hostVercel =
  (process.env.VERCEL_ENV === 'production' ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL) || process.env.VERCEL_URL;
const appUrl = process.env.APP_URL || (hostVercel ? `https://${hostVercel}` : 'http://localhost:3000');
const hostApp = (() => {
  try {
    return new URL(appUrl).host;
  } catch {
    return 'localhost:3000';
  }
})();

/** `localhost:3000` solo se acepta como origen de Server Actions cuando la app misma corre en local. */
const esLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(hostApp);
const origenesPermitidos = esLocal ? [...new Set([hostApp, 'localhost:3000'])] : [hostApp];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Next genera archivos de reglas opcionales en la raiz al correr `next dev`; se desactivan para que
  // el repositorio contenga solo el producto (SPEC 12.3).
  agentRules: false,
  // Para correr varios servidores de desarrollo sobre el mismo codigo (cada uno con su carpeta de compilacion).
  // Sin la variable, es la `.next` de siempre.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Runtime Node (no Edge). Estos paquetes cargan binarios o WASM y no deben empaquetarse.
  serverExternalPackages: ['@electric-sql/pglite', 'pg', 'sharp', 'exceljs', 'nodemailer'],
  experimental: {
    // CSRF (RV-20): Server Actions verifican `Origin`. En 16.4.2 la clave va dentro de `experimental`
    // (en la raiz de NextConfig no compila). El rechazo de peticiones SIN Origin lo hace `proxy.ts`.
    serverActions: {
      allowedOrigins: origenesPermitidos,
    },
  },
};

export default config;
