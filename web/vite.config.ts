import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_TARGET = 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API_TARGET,
      '/photos': API_TARGET,
      '/ws': { target: API_TARGET, ws: true },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    proxy: {
      '/api': API_TARGET,
      '/photos': API_TARGET,
      '/ws': { target: API_TARGET, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Fixed zone so date formatting and day boundaries are deterministic.
    env: { TZ: 'Asia/Dhaka' },
    css: false,
  },
});
