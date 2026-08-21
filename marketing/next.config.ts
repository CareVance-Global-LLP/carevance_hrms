import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const nextConfig: NextConfig = {
  /*
   * This app lives inside the product monorepo, which has its own lockfile, and
   * D:\ happens to have one too. Left to infer, Turbopack picks the wrong root
   * and resolves modules from outside the marketing app. Pin it.
   */
  turbopack: {
    root: dirname(fileURLToPath(import.meta.url)),
  },

  images: {
    // Screens are rendered as components rather than captured (see
    // components/product/), so the only raster assets are OG images.
    formats: ['image/avif', 'image/webp'],
  },

  // A payload this small does not need the extra CPU, but the header costs
  // nothing and the pricing page's slider markup compresses well.
  compress: true,

  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
      // No Cache-Control override for /_next/static/* — Next already serves it
      // immutable, and setting our own breaks asset revalidation in dev.
    ];
  },
};

export default nextConfig;
