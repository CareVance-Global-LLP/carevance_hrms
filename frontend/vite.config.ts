import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { BRAND, productLabel } from './src/config/brand'

/**
 * Restart the dev server when the Tailwind config changes.
 *
 * PostCSS reads tailwind.config.js exactly once, at boot. src/styles/theme.css
 * is an ordinary source file and hot-reloads. So editing both — or pulling a
 * commit that touches both — leaves a running server with the NEW token layer
 * and the OLD palette, and the two halves disagree about what a colour means:
 *
 *   .bg-white   remapped by theme.css   -> flips dark
 *   bg-slate-50 remapped by the config  -> stays literal #f8fafc, i.e. white
 *   text-slate-900 remapped by the config -> stays literal near-black
 *
 * which renders a white page with black cards and black-on-black text. Watching
 * the file turns a silent half-applied theme into a two-second restart.
 */
function restartOnTailwindConfigChange(): Plugin {
  const watched = path.resolve(__dirname, 'tailwind.config.js')
  return {
    name: 'carevance:restart-on-tailwind-config-change',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(watched)
      server.watcher.on('change', (file) => {
        if (path.resolve(file) !== watched) return
        server.config.logger.info('tailwind.config.js changed — restarting so PostCSS re-reads it')
        void server.restart()
      })
    },
  }
}

/**
 * Feed index.html from src/config/brand.ts.
 *
 * The document head is the one branded surface a React component cannot reach:
 * the title, the favicon and the link-preview tags are read before the app
 * boots. Tokenising them here keeps them on the same single source as the rest
 * of the app, so un-branding stays one edit rather than two.
 *
 * With the brand off, the image tags are REMOVED rather than pointed at an
 * empty string -- a `<link rel="icon" href="">` re-requests the page itself in
 * some browsers, and an empty og:image renders as a broken card.
 */
function brandIndexHtml(): Plugin {
  return {
    name: 'brand:index-html',
    transformIndexHtml(html) {
      if (!BRAND.enabled) {
        /*
         * Removing the icon tags is NOT enough, and this was a real bug.
         *
         * With no `<link rel="icon">` at all, every browser falls back to
         * requesting `/favicon.ico` at the site root on its own. That file is
         * still the vendor's 78 KB mark, so an un-branded build went out with
         * the brand sitting in the browser tab — the one place a viewer looks
         * without being asked to.
         *
         * `href="data:,"` is an explicit, empty icon. It satisfies the browser,
         * so the default request never happens, and it renders as the blank
         * page glyph rather than a broken image.
         */
        const dropped = ['%BRAND_LOGO_MARK%', '%BRAND_LOGO_FULL%']
        html = html
          .split(/\r?\n/)
          .filter((line) => !dropped.some((token) => line.includes(token)))
          .join('\n')
          .replaceAll('%BRAND_FAVICON%', 'data:,')
      }

      return html
        .replaceAll('%BRAND_PRODUCT_NAME%', productLabel)
        .replaceAll('%BRAND_DESCRIPTION%', BRAND.enabled
          ? `${BRAND.productName} helps teams manage attendance, reports, onboarding, monitoring, payroll workflows, and day-to-day workforce operations from one connected workspace.`
          : 'Attendance, reports, onboarding, monitoring and payroll workflows in one connected workspace.')
        .replaceAll('%BRAND_FAVICON%', '/favicon.ico?v=brand-1')
        .replaceAll('%BRAND_LOGO_MARK%', `${BRAND.logoMark}?v=brand-1`)
        .replaceAll('%BRAND_LOGO_FULL%', `${BRAND.logoFull}?v=brand-1`)
    },
  }
}

export default defineConfig({
  plugins: [react(), restartOnTailwindConfigChange(), brandIndexHtml()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Listen on every interface, not just loopback. Without this Vite binds to
    // ::1 only, so a phone or a second laptop on the same network cannot open
    // the app at all — which makes testing the mobile client impossible even
    // though the mobile client itself works.
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (id.includes('react-router')) {
            return 'router-vendor';
          }

          if (id.includes('@tanstack')) {
            return 'query-vendor';
          }

          if (id.includes('framer-motion')) {
            return 'motion-vendor';
          }

          if (id.includes('lucide-react')) {
            return 'icons-vendor';
          }

          if (id.includes('date-fns')) {
            return 'date-vendor';
          }
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    globals: false,
    // Without an explicit include, vitest's default glob also matched
    // tests/smoke/*.spec.ts — those are Playwright specs that import
    // @playwright/test, so vitest collected them and failed four files on
    // every run for reasons that had nothing to do with the code.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
