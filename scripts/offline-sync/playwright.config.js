import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "offline-sync.spec.js",
    "access-control-v118.spec.js",
    "pos-access-v118.spec.js",
  ],
  outputDir: ".playwright-output",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4179/offline-demo.html",
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179/offline-demo.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
