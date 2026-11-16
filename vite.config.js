import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { VitePWA } from "vite-plugin-pwa";

// index.html is the app (src/app). The kitchen view is its `#/cocina` route.
// prototype.html and prototype-comanda.html keep the original prototype
// runnable as a visual and behavioural reference; it is not extended.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // App shell for offline use (EVL-126 [B]): after one online visit the
    // service worker serves the app, including the bundled catalog and users.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Karma POS",
        short_name: "Karma",
        description: "Punto de venta de Karma",
        lang: "es-MX",
        display: "standalone",
        start_url: "/",
        theme_color: "#f0eee6",
        background_color: "#f0eee6",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg}"],
        navigateFallback: "/index.html",
      },
    }),
  ],
  test: {
    include: ["src/**/*.test.{ts,tsx,js,jsx}"],
    passWithNoTests: true,
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
  server: {
    fs: { deny: [".env", ".env.*", "*.{crt,pem}"] },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        prototype: resolve(__dirname, "prototype.html"),
        prototypeComanda: resolve(__dirname, "prototype-comanda.html"),
      },
    },
  },
});
