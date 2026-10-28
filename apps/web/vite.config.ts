/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@clientflow/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // Same-origin API in development: cookies stay first-party and CORS stays closed (ADR-005).
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: false },
      '/health': { target: API_TARGET, changeOrigin: false },
    },
  },
  preview: { host: 'localhost', port: 4173, strictPort: true },
  build: {
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Each icon used to be its own 1 KB chunk: one shared icon chunk saves dozens of round
        // trips on slow mobile networks (NFR-03, R38).
        // A broader "shared app code" group was tried: the dashboard reached 85, but the group was
        // preloaded on the sign-in page too and its score fell from 91-94 to 87-90 (M12 report).
        codeSplitting: { groups: [{ name: 'icons', test: /node_modules[\\/]lucide-react/ }] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.tsx'],
    css: false,
  },
});
