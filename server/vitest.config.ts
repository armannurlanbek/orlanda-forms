import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the shared package to its TS source so tests need no prebuild.
      '@orlanda/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
});
