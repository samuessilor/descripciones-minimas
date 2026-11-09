import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integracion',
          include: ['tests/integracion/**/*.test.ts'],
          environment: 'node',
          // El modo con correo (outbox) sigue soportado y probado; el modo basico (por defecto en la app) tiene su propio archivo.
          env: { AVISOS_POR_CORREO: 'true' },
          // Cada archivo levanta su propia instancia PGlite en memoria (D-30).
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db-real',
          include: ['tests/db-real/**/*.test.ts'],
          environment: 'node',
          // Prueba el outbox de correo en Postgres real: necesita el modo con correo encendido, como 'integracion'.
          env: { AVISOS_POR_CORREO: 'true' },
          testTimeout: 60_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
