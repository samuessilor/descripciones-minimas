import localFont from 'next/font/local';

/**
 * Fuentes LOCALES (11.5, RV-25): `next/font/local` con archivos woff2 versionados en `src/fuentes/`
 * (licencia OFL incluida), de modo que el build no necesita red ni Google Fonts.
 */
export const manrope = localFont({
  src: '../fuentes/manrope-latin-wght-normal.woff2',
  variable: '--fuente-titulos',
  weight: '200 800',
  display: 'swap',
});

export const sourceSans = localFont({
  src: '../fuentes/source-sans-3-latin-wght-normal.woff2',
  variable: '--fuente-ui',
  weight: '200 900',
  display: 'swap',
});
