import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "pos-journal.spec.js",
  outputDir: ".pos-journal-playwright-output",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "pnpm dev --host 127.0.0.1 --port 4190 --strictPort",
    url: "http://127.0.0.1:4190/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
