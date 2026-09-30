import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'pos-responsive.spec.js',
  outputDir: '.playwright-output',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4180/',
    browserName: 'chromium',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
