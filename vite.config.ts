import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Q1: Vite + Vitest config in one file. Importing `defineConfig` from
// `vitest/config` (rather than `vite`) extends the type to include `test`,
// per Vitest v4's recommended pattern.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
});
