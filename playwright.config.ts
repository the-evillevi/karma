import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the production build in a real browser, so they cover
// what unit tests cannot: IndexedDB persistence, reloads and real layout.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "tablet",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 820 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
