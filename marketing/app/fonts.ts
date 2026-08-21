import { Manrope, Space_Grotesk } from 'next/font/google';

/**
 * Both faces are the product's own (frontend/src/index.css loads them from the
 * Google CDN). Here they are SELF-HOSTED: next/font downloads the files at build
 * time and serves them from our origin, which removes a render-blocking request
 * to a third party and, with `display: swap`, removes the invisible-text pause
 * that would otherwise sit right on top of the LCP measurement.
 *
 * Latin only. The site is English-language; shipping the full unicode range
 * would roughly triple the font payload for glyphs no page uses.
 */

export const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
  fallback: ['system-ui', 'arial'],
  adjustFontFallback: true,
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
  fallback: ['system-ui', 'arial'],
  adjustFontFallback: true,
});
