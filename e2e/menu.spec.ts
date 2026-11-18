import { expect, test } from "@playwright/test";
import { PIN, menu, signIn } from "./helpers.ts";

test("[A] Los cambios del menú sobreviven a una recarga sin red", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
  await signIn(page, PIN.admin);

  await page.getByRole("link", { name: "Menú" }).click();
  const latte = page.getByRole("listitem", { name: "Latte", exact: true });
  await latte.getByRole("button", { name: "Cambiar precio de Latte" }).click();
  await page.getByLabel("Precio de Latte", { exact: true }).fill("70");
  await page.getByRole("button", { name: "Guardar precio" }).click();
  await expect(latte.getByText("$70.00")).toBeVisible();
  const croissant = page.getByRole("listitem", { name: "Croissant Dulce" });
  await croissant.getByRole("switch", { name: "Disponible" }).click();
  await expect(croissant.getByText("Agotado")).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await signIn(page, PIN.barra);
  await page.getByRole("link", { name: "Venta", exact: true }).click();
  await expect(
    menu(page).getByRole("button", { name: /^Latte\s*\$/ }),
  ).toContainText("$70.00");
  await expect(
    menu(page).getByRole("button", { name: /^Croissant Dulce\s*\$/ }),
  ).toBeDisabled();
});
