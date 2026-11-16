import { expect, test } from "@playwright/test";
import { PIN, addProduct, signIn } from "./helpers.ts";

test.use({ viewport: { width: 390, height: 844 } });

test("la orden y el cobro son visibles en teléfono", async ({ page }) => {
  await page.goto("/");
  await signIn(page, PIN.barra);
  await addProduct(page, "Coca Cola");
  const access = page.getByRole("button", { name: /^Ver orden/ });
  await expect(access).toBeVisible();
  await access.click();
  const sheet = page.getByRole("dialog", { name: "Orden actual" });
  await expect(sheet.getByTestId("order-total")).toHaveText("$25.00");
  await expect(
    sheet.getByRole("button", { name: "Cobrar · $25.00" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
