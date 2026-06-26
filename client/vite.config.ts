import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Dev: proxy /api to the API server so the client is same-origin (no CORS /
// cookie headaches). Build output is served by the API in prod.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use shared TS source directly so the client never needs a prebuilt shared.
      '@orlanda/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
