import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Multi-page app: the POS (root) and the kitchen Comanda screen are separate
// HTML entry points, mirroring the original two-file design. They share state
// through localStorage ('karma-pos-v1'), so keeping them as distinct documents
// preserves the cross-tab sync behavior.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        comanda: resolve(__dirname, 'comanda.html'),
        offlineDemo: resolve(__dirname, 'offline-demo.html'),
      },
    },
  },
});
