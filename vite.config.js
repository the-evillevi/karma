import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

// Multi-page app: the POS (root) and the kitchen Comanda screen are separate
// HTML entry points, mirroring the original two-file design. They share state
// through localStorage ('karma-pos-v1'), so keeping them as distinct documents
// preserves the cross-tab sync behavior.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        comanda: resolve(__dirname, 'comanda.html'),
        components: resolve(__dirname, 'components-demo.html'),
      },
    },
  },
});
