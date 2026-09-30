import { chromium, test, expect } from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("production service worker boots the cached POS, Comanda and offline demo after browser restart", async () => {
  const profile = await mkdtemp(join(tmpdir(), "karma-pwa-"));
  const workerPath = resolve("dist/sw.js");
  let originalWorker;
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
    const privateMessage =
      "private-customer@example.test secret-service-key-do-not-render";
    await page.evaluate((message) => {
      window.dispatchEvent(
        new ErrorEvent("error", { message, error: new Error(message) }),
      );
    }, privateMessage);
    await expect(page.getByRole("alert")).toContainText(
      "Una operación no terminó correctamente",
    );
    await expect(page.locator("body")).not.toContainText(privateMessage);
    await page.getByRole("button", { name: "Entendido" }).click();
    await page.reload({ waitUntil: "networkidle" }); // prompt activation: second load is controlled by the installed shell
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Marcela", exact: false })
      .first()
      .click();
    for (let index = 0; index < 4; index += 1)
      await page.getByRole("button", { name: "1", exact: true }).click();
    await page
      .getByRole("button", { name: "Usuarios y configuración" })
      .click();
    await page
      .getByRole("button", { name: "Sofía Delgado", exact: true })
      .click();
    await expect(page.getByText("Editar usuario")).toBeVisible();
    originalWorker = await readFile(workerPath);
    await writeFile(
      workerPath,
      `${originalWorker}\n// update-check-${Date.now()}`,
    );
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(page.getByTestId("pwa-update-control")).toBeVisible();
    await expect(
      page.getByLabel("Confirmo que guardé o revisé el trabajo visible"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Actualizar ahora" }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Cerrar editor de usuario" })
      .click();
    const confirmUpdate = page.getByLabel(
      "Confirmo que guardé o revisé el trabajo visible",
    );
    await expect(confirmUpdate).toBeVisible();
    await confirmUpdate.check();
    await page.getByRole("button", { name: "Actualizar ahora" }).click();
    await expect(
      page.getByRole("button", { name: "+ Nueva venta" }),
    ).toBeVisible();
    await page.evaluate(() => localStorage.removeItem("karma-pos-v1"));
    await writeFile(workerPath, originalWorker);
    originalWorker = undefined;
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
    if (originalWorker) await writeFile(workerPath, originalWorker);
    await rm(profile, { recursive: true, force: true });
  }
});
