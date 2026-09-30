import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("production service worker boots the cached POS, Comanda and offline demo after browser restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pwa-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4189/", { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      if (!("serviceWorker" in navigator))
        throw new Error("service worker unsupported");
      await navigator.serviceWorker.ready;
      const names = await caches.keys();
      if (!names.some((name) => name.includes("workbox-precache")))
        throw new Error("precache missing");
    });
    await expect(page.locator("body")).toContainText("Karma");
    await page.reload({ waitUntil: "networkidle" }); // prompt activation: second load is controlled by the installed shell
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
    });
    await context.setOffline(true);
    for (const [route, marker] of [
      ["/", "¿Quién abre la estación?"],
      ["/comanda.html", "Comanda"],
      ["/offline-demo.html", "Sincronización offline"],
    ]) {
      const offlinePage = await context.newPage();
      const pageErrors = [];
      offlinePage.on("pageerror", (error) => pageErrors.push(error.name));
      await offlinePage.goto(`http://127.0.0.1:4189${route}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(offlinePage.locator("body")).toContainText(marker);
      expect(pageErrors).toEqual([]);
      await offlinePage.close();
    }
  } finally {
    if (context) await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
