import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "pos-operations-journal.spec.js",
  outputDir: ".pos-operations-journal-playwright-output",
  timeout: 45_000,
  expect: { timeout: 12_000 },
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
    command: "pnpm dev --host 127.0.0.1 --port 4191 --strictPort",
    url: "http://127.0.0.1:4191/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
