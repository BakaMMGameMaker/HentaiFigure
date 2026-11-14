import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'mobile-dist',
    emptyOutDir: true,
    target: 'chrome100',
    rollupOptions: {
      input: path.resolve(__dirname, 'index.mobile.html'),
    },
  },
  server: {
    port: 5200,
    strictPort: true,
  },
});
