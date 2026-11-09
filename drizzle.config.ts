import { defineConfig } from 'drizzle-kit';

// Solo se usa para GENERAR migraciones (no necesita conexion). Aplicar: `npm run db:migrate`.
// Nunca `drizzle-kit push` en produccion (12.1).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/esquema/index.ts',
  out: './drizzle',
});
