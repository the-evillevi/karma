import { expect, test } from "@playwright/test";
import { PIN, addProduct, order, signIn } from "./helpers.ts";

test("[B] La app abre en modo avión", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByText("Captura tu PIN para entrar")).toBeVisible();
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

  await order(page).getByRole("button", { name: "Cobrar · $25.00" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar A-0001" });
  await checkout.getByRole("radio", { name: "Transferencia" }).click();
  await checkout.getByRole("button", { name: "Registrar pago" }).click();
  await expect(
    page.getByRole("article", { name: "Ticket A-0001" }),
  ).toBeVisible();
});
