import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'preview.spec.js',
  outputDir: '.preview-playwright-output',
  timeout: 30_000,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4190/karma/',
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'pnpm preview:pwa --base /karma/ --host 127.0.0.1 --port 4190 --strictPort',
    url: 'http://127.0.0.1:4190/karma/',
    reuseExistingServer: false,
  },
});
