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

test("[E] Un grupo nuevo asignado a un producto sobrevive a una recarga sin red", async ({
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
  await page.getByRole("tab", { name: "Modificadores" }).click();
  await page.getByRole("button", { name: "Nuevo grupo" }).click();
  const create = page.getByRole("dialog", { name: "Nuevo grupo" });
  await create.getByLabel("Nombre", { exact: true }).fill("Sabor");
  await create.getByLabel("Mínimo").fill("1");
  await create.getByLabel("Máximo").fill("1");
  await create.getByLabel("Nombre de la opción 1").fill("Mermelada de fresa");
  await create.getByRole("button", { name: "Guardar grupo" }).click();
  await expect(
    page.getByRole("region", { name: "Sabor", exact: true }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Productos" }).click();
  await page
    .getByRole("listitem", { name: "Croissant Dulce" })
    .getByRole("button", { name: "Editar Croissant Dulce" })
    .click();
  const edit = page.getByRole("dialog", { name: "Editar producto" });
  await edit.getByLabel("Agregar grupo").selectOption("Sabor");
  await edit.getByRole("button", { name: "Agregar", exact: true }).click();
  await edit.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(edit).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await signIn(page, PIN.barra);
  await page.getByRole("link", { name: "Venta", exact: true }).click();
  await menu(page)
    .getByRole("button", { name: /^Croissant Dulce\s*\$/ })
    .click();
  await expect(
    page
      .getByRole("radiogroup", { name: "Sabor", exact: true })
      .getByRole("radio", { name: "Mermelada de fresa" }),
  ).toBeVisible();
});
