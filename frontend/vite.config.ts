import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

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

export default defineConfig({
  plugins: [react(), restartOnTailwindConfigChange()],
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
