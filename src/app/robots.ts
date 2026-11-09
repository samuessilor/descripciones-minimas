import type { MetadataRoute } from 'next';

/** La plataforma es privada: se bloquea todo (13.3). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}
