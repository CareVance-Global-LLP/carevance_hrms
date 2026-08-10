import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
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
