// Spec: Linear EVL-126, slice [B]. Test names are the scenario titles.
import { expect, test } from "@playwright/test";
import { PIN, addProduct, order, signIn } from "./helpers.ts";

test("[B] La app abre en modo avión", async ({ page, context }) => {
  // Dado la app se abrió al menos una vez con conexión, cuando la abro en
  // modo avión, entonces carga la pantalla de venta con el catálogo y los
  // usuarios autorizados
  await page.goto("/");
  await expect(page.getByText("Captura tu PIN para entrar")).toBeVisible();
  // The first visit installs the service worker that caches the app shell.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await signIn(page, PIN.barra);
  await addProduct(page, "Coca Cola");
  await expect(order(page).getByTestId("order-total")).toHaveText("$25.00");

  // A whole sale works with no network.
  await order(page).getByRole("button", { name: "Cobrar · $25.00" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar A-0001" });
  await checkout.getByRole("radio", { name: "Transferencia" }).click();
  await checkout.getByRole("button", { name: "Registrar pago" }).click();
  await expect(
    page.getByRole("article", { name: "Ticket A-0001" }),
  ).toBeVisible();
});
