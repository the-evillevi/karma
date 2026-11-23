import { expect, test } from "@playwright/test";
import { PIN, addProduct, order, signIn } from "./helpers.ts";

test("la estación conserva la orden en captura al recargar", async ({
  page,
}) => {
  await page.goto("/");
  await signIn(page, PIN.barra);
  await addProduct(page, "Coca Cola");
  await addProduct(page, "Latte");
  const dialog = page.getByRole("dialog", { name: "Latte" });
  await dialog.getByRole("checkbox", { name: "Amareto +$10.00" }).click();
  await dialog.getByRole("button", { name: "Agregar · $75.00" }).click();
  await expect(order(page).getByTestId("order-total")).toHaveText("$100.00");

  await page.reload();
  await signIn(page, PIN.barra);
  await expect(order(page).getByTestId("order-total")).toHaveText("$100.00");
  await expect(order(page).getByText("Entera · Amareto")).toBeVisible();
});
