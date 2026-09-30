import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "offline-sync.spec.js",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:5173/offline-demo.html",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173/offline-demo.html",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
