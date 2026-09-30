import { mergeConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import baseConfig from "./vite.config.js";

// Keep the existing three-entry Vite configuration as the source of truth.
// This production-only config adds a precached shell without changing dev mode.
export default mergeConfig(baseConfig, {
  base: process.env.KARMA_BASE_PATH || "/",
  plugins: [
    {
      name: "karma-demo-preview-notice",
      transformIndexHtml(html) {
        if (process.env.KARMA_PREVIEW_BUILD !== "1") return html;
        return html.replace(
          /(<body[^>]*>)/,
          `$1
          <style>:root{--karma-viewport-height:calc(100vh - 40px)}.karma-preview-notice{height:40px;position:sticky;top:0;z-index:40;background:#836953;color:#faf9f5;display:flex;align-items:center;justify-content:center;padding:0 8px;font:500 12px/1.2 Arial,sans-serif}</style>
          <aside class="karma-preview-notice" aria-label="Entorno de demostración">Demo · Datos de prueba · Sin cobros reales</aside>`,
        );
      },
    },
    VitePWA({
      // Keep an update waiting for an explicit, safe reload by the operator.
      registerType: "prompt",
      injectRegister: "auto",
      manifest: {
        name: "Karma POS",
        short_name: "Karma POS",
        description: "Punto de venta Karma",
        lang: "es-MX",
        display: "standalone",
        background_color: "#f0eee6",
        theme_color: "#836953",
        icons: [
          {
            src: `${process.env.KARMA_BASE_PATH || "/"}pwa-icon.svg`,
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
        start_url: process.env.KARMA_BASE_PATH || "/",
        scope: process.env.KARMA_BASE_PATH || "/",
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,svg,ico,png,webmanifest}"],
        navigateFallback: `${process.env.KARMA_BASE_PATH || "/"}index.html`,
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false,
      },
    }),
  ],
});
