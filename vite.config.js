import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// index.html is the app (src/app). The kitchen view is its `#/cocina` route.
// prototype.html and prototype-comanda.html keep the original prototype
// runnable as a visual and behavioural reference; it is not extended.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
