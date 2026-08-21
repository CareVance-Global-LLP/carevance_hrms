import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * Everything is crawlable, including by AI answer engines.
 *
 * That is a deliberate position rather than an oversight. Two of the ten
 * competitors researched return almost nothing to a text crawler because their
 * marketing sites render client-side — which is a real liability now that a
 * meaningful share of software discovery starts with a model rather than a
 * search box. This site server-renders its whole argument and publishes
 * /llms.txt precisely so that it can be read and quoted correctly.
 *
 * The only disallow is /api/, which holds nothing a crawler should index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
    ],
    sitemap: new URL('/sitemap.xml', SITE.url).toString(),
    host: SITE.url,
  };
}
