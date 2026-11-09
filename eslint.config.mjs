import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Capas (SPEC 12.3), impuestas con `no-restricted-imports`:
 *   dominio  -> PURO: no importa de db, server, app, componentes ni Next.
 *   server   -> importa de dominio y db.
 *   app y componentes -> solo llaman a server/acciones y server/politicas (via el contexto); jamas a `@/db`.
 */
const sinDb = {
  group: ['@/db', '@/db/*'],
  message: 'Las paginas y componentes no acceden a la base: usa server/politicas o server/acciones.',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', '.next-*/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts', 'drizzle/**']),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['src/dominio/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/db', '@/db/*', '@/server', '@/server/*', '@/app', '@/app/*', '@/componentes', '@/componentes/*'], message: 'dominio/ es PURO: no importa de db, server ni de la interfaz.' },
            { group: ['next', 'next/*', 'react', 'react-dom'], message: 'dominio/ es PURO: sin Next ni React.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/componentes/**/*.{ts,tsx}'],
    ignores: ['src/app/api/dev/**', 'src/app/api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [sinDb] }],
    },
  },
  {
    files: ['src/db/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app', '@/app/*', '@/componentes', '@/componentes/*'], message: 'db/ no importa de la interfaz.' },
            { group: ['next', 'next/*'], message: 'db/ no depende de Next.' },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'scripts/**/*.mts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]);
