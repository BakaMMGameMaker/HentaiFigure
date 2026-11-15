import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// 版本号只在 package.json 里维护，构建时注入，手机端不再抄第二份。
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'));

export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(String(pkg.version || '0.0.0')),
  },
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
