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
  await latte.getByRole("button", { name: "Editar Latte" }).click();
  const edit = page.getByRole("dialog", { name: "Editar producto" });
  await edit.getByLabel("Precio de Latte", { exact: true }).fill("70");
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(edit).toBeHidden();
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

test("[E] Quitar un grupo de un producto sobrevive a una recarga sin red", async ({
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
  await page
    .getByRole("listitem", { name: "Latte", exact: true })
    .getByRole("button", { name: "Editar Latte" })
    .click();
  const edit = page.getByRole("dialog", { name: "Editar producto" });
  await edit.getByRole("button", { name: "Quitar Shot de sabor" }).click();
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(edit).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await signIn(page, PIN.barra);
  await page.getByRole("link", { name: "Venta", exact: true }).click();
  await menu(page)
    .getByRole("button", { name: /^Latte\s*\$/ })
    .click();
  const sale = page.getByRole("dialog", { name: "Latte" });
  await expect(
    sale.getByRole("radiogroup", { name: "Tipo de leche" }),
  ).toBeVisible();
  await expect(sale.getByRole("group", { name: "Shot de sabor" })).toHaveCount(
    0,
  );
});
