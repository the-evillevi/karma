import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["pos-operations-server-v126.spec.ts"],
  outputDir: ".playwright-output",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: "line",
  use: {
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
