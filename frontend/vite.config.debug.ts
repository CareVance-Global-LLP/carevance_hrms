import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Debug-only config: mocks /api/** so the isolated org-tree harness needs no backend/auth.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mock-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.includes('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ data: [] }));
            return;
          }
          next();
        });
      },
    },
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5192 },
});
