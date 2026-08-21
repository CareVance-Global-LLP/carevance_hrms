import type { MetadataRoute } from 'next';
import { SITE, ALL_ROUTES } from '@/lib/site';

/**
 * Generated from the same route list the navigation and footer read, so a page
 * cannot end up linked but unlisted (or listed but non-existent).
 *
 * Priorities reflect what we would actually want ranked: the free tools are the
 * long-term SEO asset, pricing is the highest-intent commercial page, and the
 * placeholder pages are deliberately down-weighted rather than omitted — they
 * exist and resolve, they are just not finished.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const priorityFor = (href: string, placeholder?: boolean): number => {
    if (href === '/') return 1;
    if (placeholder) return 0.3;
    if (href === '/pricing') return 0.9;
    if (href.startsWith('/tools')) return 0.8;
    if (href.startsWith('/product')) return 0.8;
    if (href === '/security' || href === '/why-carevance') return 0.7;
    if (href.startsWith('/legal')) return 0.3;
    return 0.5;
  };

  return ALL_ROUTES.map((route) => ({
    url: new URL(route.href, SITE.url).toString(),
    lastModified: now,
    changeFrequency: route.href.startsWith('/tools') ? 'monthly' : 'weekly',
    priority: priorityFor(route.href, route.placeholder),
  }));
}
